// ---------------------------------------------------------------------------------
// IMPORTS
// ---------------------------------------------------------------------------------
// Dependencies
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const qs = require('querystring');

// Import other Modules
const config = require('./APIConfig.js');
const db = require('./APIDatabase.js');
const { ERROR_CODES } = require('./APIConstants.js');

// ---------------------------------------------------------------------------------
// APIUtils CLASS
// ---------------------------------------------------------------------------------
/**
 * This class holds some utility methods to be used by the API-server
 */
class APIUtils {
    /**
     * Creates a new instance of APIUtils
     */
    constructor() {}

    /**
     * Calculates the SHA256 hash of the given strings.
     * All arguments passed will be concatenated and then a single hash will be returned.
     * @param  {...string} values Strings calculate the SHA256 hash of
     * @returns {string} SHA256 hash of the strings passed
     */
    sha256(...values) {
        let value = values.join('');
        return crypto.createHash('sha256').update(value).digest('hex');
    }

    // ---------------------------------------------------------------------------------
    // SESSION UTILS
    // ---------------------------------------------------------------------------------
    // TODO: verify, should this be part of the utils?

    /**
     * Checks whether a session for a given token exists and retrieves the sesion data if so.
     * @async
     * @param {string} sessionToken token to load the session for
     * @returns {Object|null} Session-Object if it exists, or null otherwise
     */
    async establishSession(sessionToken) {
        // check whether a session with the given token exists
        let sesResult = await db.query('SELECT * FROM '+config.db.auth_database+'.api_sessions WHERE session_token=?', sessionToken)
        if(sesResult === null || sesResult.length === 0) {
            return null;
        }

        // load details of the found session
        let session = await this.getSession(sesResult[0].session_id);
        if(session === null) {
            return null;
        }

        // record last action of the session
        await db.query('UPDATE '+config.db.auth_database+'.api_sessions SET last_action=NOW(), expiration_date=DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE session_id=?', session.session_id)
        
        return session;
    }

    /**
     * Loads details of the session with the given id
     * @async
     * @param {integer} sessionID ID of the session to load
     * @returns {Object|null} Session-Object if it exists, or null otherwise
     */
    async getSession(sessionID) {
        // load session data
        let sqlSes = "\
            SELECT s.session_id,\
                s.user_id,\
                s.session_token AS token,\
                s.start_date,\
                s.expiration_date,\
                u.admin\
            FROM "+config.db.auth_database+".api_sessions s\
            LEFT JOIN "+config.db.auth_database+".api_view_users u\
                ON s.user_id = u.user_id\
            WHERE s.session_id = ?\
            LIMIT 0,1";
        let sesResult = await db.query(sqlSes, sessionID);
        // check whether the session exists
        if(sesResult === null || sesResult.length === 0) {
            return null;
        }

        let session = sesResult[0];

        // TODO: verify whether this statement is required
        session.admin = (session.admin === 1 ? true : false);

        return session;
    }

    async tryExecuteMethod(method, parms, session, request, response, methods) {
        // verify whether the method can be executed (parameters / permissions)
        let executionVerification = await method.canBeExecuted(parms, session);
        let methodResponse = null;
        if(!executionVerification.passed) {
            methodResponse = this.error(executionVerification.reason, executionVerification.errorCode);
        } else {
            // execute the method
            await method.execute({
                parms : parms,
                session : session,
                request : request,
                response : response,
                methods : methods
            }).then((methodResult) => {
                methodResponse = methodResult;
            }).catch((errorCode) => {
                console.log('Error executing a method', err);
                methodResponse = this.error('An Error occured while executing the requested method.', errorCode);
            });
        }
        
        return methodResponse;
    }

    // ---------------------------------------------------------------------------------
    // PERMISSIONS
    // ---------------------------------------------------------------------------------
    /**
     * Retrieves all permissions the user with the given id has
     * @async
     * @param {integer} userID ID of the user to get the permissions of
     * @returns {string[]|null} Array of strings representing the permissions of the user, or null if an invalid userId was provided
     */
    async getUserPermissions(userID) {
        if(userID === undefined || userID === null) {
            return null;
        }

        let userPermissions = [];
        // load all permissions of the user from the database
        let permissions = await db.query('SELECT * FROM '+config.db.auth_database+'.api_user_permissions WHERE user_id=?', userID);
        for(let permission of permissions) {
            // avoid duplicates
            if(!userPermissions.includes(permission.permission_key)) {
                userPermissions.push(permission.permission_key);
                // recursively get permission-children
                let decendants = await this.getPermissionDecendants(permission.permission_key);
                for(let decendant of decendants) {
                    // avoid duplicates again
                    if(!userPermissions.includes(decendant)) {
                        userPermissions.push(decendant);
                    }
                }
            }
        }

        return userPermissions;
    }
    /**
     * Recursively gets all child-permissions of the given permission
     * @async
     * @param {string} permission permission to load the decendants of
     * @returns {string[]} Array containing all permissions that are a decendant of the given permission
     */
    async getPermissionDecendants(permission) {
        let result = [];
        // load all children of this permission from the database
        let children = await db.query('SELECT * FROM '+config.db.auth_database+'.api_permissions WHERE parent_key=?', permission);
        for(let child of children) {
            // avoid duplicates
            if(!result.includes(child.permission_key)) {
                result.push(child.permission_key);
                // recursively get the decendants of the permission
                let decendants = await this.getPermissionDecendants(child.permission_key);
                for(let decendant of decendants) {
                    // avoid duplicates again
                    if(!result.includes(decendant)) {
                        result.push(decendant);
                    }
                }
            }
        }
        return result;
    }

    /**
     * @typedef {Object} VerificationResult
     * @property {boolean} passed true of the verification was positive, false otherwise
     * @property {string} [reason] reason why a verification has failed, only set when passed is false
     * @property {string} [errorCode] constant from ERROR_CODES that specifies why a verification has failed
     */
    /**
     * Checks whether a user (identified by its session) is allowed to execute an API-method
     * @async
     * @param {Object|null} session session of the user (might be null for unauthenticated calls)
     * @param {APIMethod} method API-method to check the permissions for
     * @returns {VerificationResult} Object representing whether the user is allowed to execute the method
     */
    async allowedToExecuteMethod(session, method) {
        // Is the user logged in?
        if(session !== null) {
            // If there is a session, check whether this is a method for logged out users only
            if(method.requireNoSession) {
                return {
                    passed : false,
                    reason : 'This method is only available to clients that are not logged in',
                    errorCode : ERROR_CODES.PERMISSION_SESSION
                };
            }
            // check whether the user has all required permissions to run the method
            if(!(await this.userHasPermissions(session.user_id, method.requiredPermissions))) {
                return {
                    passed : false,
                    reason : 'You do not have the necessary permissions to call this method',
                    errorCode : ERROR_CODES.PERMISSION_MISSING
                };
            }
        } else if(method.requireSession) {
            // User is not logged in, but a session is required
            return {
                passed : false,
                reason : 'This method is only available to authenticated users',
                errorCode : ERROR_CODES.PERMISSION_NO_SESSION
            };
        }
        // Everything is ok
        return {
            passed : true
        };
    }

    /**
     * Checks whether a user has the permissions required for a certain API-method
     * @async
     * @param {integer} userID ID of the user to check
     * @param {APIMethod} method API-method of which to check the permissions
     * @returns {boolean} true if the user has all necessary permissions, false otherwise
     */
    async userHasPermissionsForMethod(userID, method) {
        return await this.userHasPermissions(userID, method.requiredPermissions);
    }

    /**
     * Checks whether a user has all of the given permissions
     * @async
     * @param {integer} userID ID of the user to check
     * @param {string[]|null} permissions Array of permissions to check, if this is null the method will always return true
     * @returns true if the user has all given permissions, false otherwise
     */
    async userHasPermissions(userID, permissions) {
        if(permissions === undefined || permissions === null || permissions.length === 0) {
            return true; // No permissions needed
        }
        if(userID === undefined || userID === null) {
            return false; // No user ID
        }

        // get the users permissions
        let userPermissions = await this.getUserPermissions(userID);

        // for each permission required by the method, check if the user has it
        for(let permission of permissions) {
            if(!userPermissions.includes(permission)) {
                return false;
            }
        }

        // the user has all required permissions
        return true;
    }

    // ---------------------------------------------------------------------------------
    // PARAMETER VERIFICATION
    // ---------------------------------------------------------------------------------
    /**
     * @typedef {Object} APIParameter
     * @property {string} key name of the parameter
     * @property {string} [type] type of the parameter. This is optional, but it is highly recommended to set this
     * @property {boolean} [optional=false] flag to determine whether this parameter must be passed (optional=false) or not
     * @property {any} [default] default-value to use if optional=true and the parameter was not passed
     * @property {any[]} [interpretAsNull] values that will be converted into null if they are passed
     * @property {number} [min] minimum allowed value for number-type parameters (int, float)
     * @property {number} [max] maximum allowed value for number-type parameters (int, float)
     * @property {number} [minLength] minimum allowed length for string-type parameters
     * @property {number} [maxLength] maximum allowed value for string-type parameters
     * @property {any[]} [allowed_values] Array of allowed values for this parameter, everything else will be rejected
     */
    /**
     * Checks whether a given parameters requirements are fulfilled by the parameters passed by a user
     * @param {APIParameter} parm The parameter definition to check against
     * @param {Object} parms Object containing all parameters passed by the user as properties
     * @returns {VerificationResult} Object representing whether the parameters requirements are fulfilled
     */
    checkParameter(parm, parms) {
        // Check if the parameter exists
        if(!(parm.key in parms) || parms[parm.key] === undefined || parms[parm.key] === null) {
            // If it does not exist, check whether the parameter is optional
            if(parm.optional) {
                let newValue = null;
                if(parm.default !== undefined) {
                    newValue = parm.default;
                }
                return {
                    passed : true,
                    newValue : newValue
                };
            } else {
                return {
                    passed : false,
                    reason : 'Required parameter ' + parm.key + ' is missing.',
                    errorCode : ERROR_CODES.PARAM_MISSING
                };
            }
        }

        // Check if the parameter has the correct type
        if('type' in parm) {
            let typeCheckPassed = false;
            let newValue = parms[parm.key];

            // cast passed value into a string and trim it
            newValue = String(newValue); // TODO look into options to take correctly typed values instead of casting here
            newValue = newValue.trim();

            // check the parameter depending on the required type
            switch(parm.type) {
                case 'int':
                case 'integer':
                    if(newValue.match(/^([0-9]+)$/) !== null) {
                        typeCheckPassed = true;
                        newValue = parseInt(newValue);
                    }
                    break;
                case 'float':
                case 'double':
                    if(newValue.match(/^[-]?[0-9]+(\.[0-9]+)?$/) !== null) {
                        typeCheckPassed = true;
                        newValue = Number(newValue);
                    }
                    break;
                case 'datetime':
                    if(newValue.match(/^(\d{4})-(0\d|1[1-2])-([0-2][1-9]|10|20|3[0-1]) ([0-1][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])$/) !== null) {
                        typeCheckPassed = true;
                    }
                    break;
                case 'date':
                    if(newValue.match(/^(\d{4})-(0\d|1[1-2])-([0-2][1-9]|10|20|3[0-1])$/) !== null) {
                        typeCheckPassed = true;
                    }
                    break;
                case 'boolean':
                case 'bool':
                    if([1, true, 'true', '1'].includes(newValue)) {
                        typeCheckPassed = true;
                        newValue = true;
                    } else if([0, false, 'false', '0'].includes(newValue)) {
                        typeCheckPassed = true;
                        newValue = false;
                    }
                    break;
                case 'char':
                    if(newValue.length === 1) {
                        typeCheckPassed = true;
                    }
                    break;
                case 'string':
                    if(newValue.length > 0) {
                        typeCheckPassed = true;
                    }
                    break;
                case 'sha256':
                    if(newValue.match(/^[A-Fa-f0-9]{64}$/) !== null) {
                        typeCheckPassed = true;
                    }
                    break;
                case 'uuid': // RFC4122 UUID v4
                    if(newValue.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i) !== null) {
                        typeCheckPassed = true;
                    }
                    break;
                case 'json':
                    try {
                        let obj = JSON.parse(newValue);
                        typeCheckPassed = true;
                        newValue = obj;
                    } catch(e) {
                        // Not valid JSON
                    }
                    break;
            }

            // If the value was not changed by the typecheck just use the one passed
            if(newValue === null) {
                newValue = parms[parm.key];
            }

            // check if the value passed in the parameter should be treated as null
            if('interpretAsNull' in parm && parm.interpretAsNull.includes(newValue)) {
                return {
                    passed : true,
                    newValue : null
                };
            } else {
                // deny wrongly typed parameters
                if(!typeCheckPassed) {
                    return {
                        passed : false,
                        reason : 'Parameter ' + parm.key + ' has the wrong type, expected ' + parm.type + '.',
                        errorCode : ERROR_CODES.PARAM_TYPE
                    };
                }
                // deny values that are not in the range of allowed values
                if('min' in parm && newValue < parm.min) {
                    return {
                        passed : false,
                        reason : 'Parameter ' + parm.key + ' is too small, the minimum value is ' + parm.min + '.',
                        errorCode : ERROR_CODES.PARAM_RANGE
                    };
                }
                if('max' in parm && newValue > parm.max) {
                    return {
                        passed : false,
                        reason : 'Parameter ' + parm.key + ' is too big, the maximum value is ' + parm.max + '.',
                        errorCode : ERROR_CODES.PARAM_RANGE
                    };
                }
                if('maxLength' in parm && newValue.length > parm.maxLength) {
                    return {
                        passed : false,
                        reason : 'Parameter ' + parm.key + ' is too long, the maximum length is ' + parm.maxLength + '.',
                        errorCode : ERROR_CODES.PARAM_RANGE
                    };
                }
                if('minLength' in parm && newValue.length < parm.minLength) {
                    return {
                        passed : false,
                        reason : 'Parameter ' + parm.key + ' is too short, the minimum length is ' + parm.minLength + '.',
                        errorCode : ERROR_CODES.PARAM_RANGE
                    };
                }
                if('allowedValues' in parm && !parm.allowedValues.includes(newValue)) {
                    return {
                        passed : false,
                        reason : 'Parameter '+parm.key+' has an invalid value.',
                        errorCode : ERROR_CODES.PARAM_RANGE
                    };
                }

                // if all checks pass then the value is ok
                return {
                    passed : true,
                    newValue : newValue
                };
            }
        }
    }

    // ---------------------------------------------------------------------------------
    // RESULT WRAPPERS
    // ---------------------------------------------------------------------------------
    /**
     * @typedef {Object} APIResponse
     * @property {boolean} success true, if the execution of the method was successful
     * @property {any} [data] data returned by the method, if any
     * @property {string} [msg] message explaining what went wrong, if anything went wront
     * @property {string} [code] an error Code constant from ERROR_CODES, explaining the type of the error
     * @property {Object} [session] is set if the execution of a method changes anything about the current session, only relevant for multicalls
     * @property {string} [token] a login-token the user could use to log in, may be issued by /session/check_session to allow the client to spare a call
     */
    /**
     * Wraps data into a successful API-Response
     * @param {any} [data=null] data to wrap
     * @returns {APIResponse} Object representing a successful API-Response
     */
    success(data = null) {
        return {
            success : true,
            data : data
        };
    }
    /**
     * Wraps data into a successful API-Response and provides information about a changed session in case of a multicall
     * @param {any} [data=null] data to wrap
     * @param {Object|null} [session=null] new session object to be used for subsequent calls in a multicall
     * @returns {APIResponse} Object representing a successful API-Response
     */
    successSession(data = null, session = null) {
        return {
            success : true,
            data : data,
            session : session
        };
    }

    /**
     * Wraps error-information into an unsuccessful API-Response
     * @param {string} msg human-readable error message
     * @param {string} [code=null] error-code constant from ERROR_CODES explaining the type of error
     * @param {string} [token=null] a login-token the user could use to log in, may be issued by /session/check_session to allow the client to spare a call
     * @returns {APIResponse} Object representing an unsuccessful API-Response
     */
    error(msg, code = null, token = null) {
        let result = {
            success : false,
            msg : msg
        };
        if(code !== null) {
            result.code = code;
        }
        if(token !== null) {
            result.token = token;
        }
        return result;
    }

    /**
     * Removes empty properties from API-Responses
     * @param {APIResponse} response the API-Response to prepare to be sent to the client
     * @returns {APIResponse} the cleaned API-Response
     */
    makeClientResponse(response) {
        ['data', 'msg', 'code', 'token'].forEach((key) => {
            if(response[key] === undefined || response[key] === null) {
                delete response[key];
            }
        });
        return response;
    }
};

module.exports = new APIUtils();