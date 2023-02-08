// ---------------------------------------------------------------------------------
// IMPORTS
// ---------------------------------------------------------------------------------
const apiUtils = require('./APIUtils.js');
const { ERROR_CODES } = require('./APIConstants.js');
const db = require('./APIDatabase.js');

// ---------------------------------------------------------------------------------
// APIMethod CLASS
// ---------------------------------------------------------------------------------
/**
 * This class represents a method a user can call.
 * It encapsulates all requirements for the method and verifies them.
 */
class APIMethod {
    /**
     * @typedef {Object} MethodHandlerParms
     * @property {any[]} parms Parameters passed by the user
     * @property {Object|null} session Session-Object of an authenticated user, or null if the request is unauthenticated
     * @property {Object} request
     * @property {Object} response
     * @property {APIMethod[]} methods
     */
    /**
     * @typedef {Object} APIMethodProperties
     * @property {string} path The path under which the method can be called, must start with a "/"
     * @property {function(MethodHandlerParms): void} handler The async callback that is executed when a user calls this method
     * @property {APIParameter[]} [parameters=[]] Array of Parameters this method takes and their type-definitions
     * @property {boolean} [requireSession=true] If set to true this method can only be called by authenticated users
     * @property {boolean} [requireNoSession=false] If set to true this method can only be called by unauthenticated users
     * @property {string[]} [requiredPermissions=[]] Array of required permissions a user must have to be allowed to execute this method
     * @property {boolean} [transaction=true] If true the whole execution of the method will be wrapped in a mysql-transaction,
     * can be set to false for methods that only retrieve data but change nothing
     */
    /**
     * Creates a new API-Method
     * @param {APIMethodProperties} properties The properties of the method to create 
     */
    constructor({
        path,
        handler,
        parameters = [],
        requireSession = true,
        requireNoSession = false,
        requiredPermissions = [],
        transaction = true
    }) {
        this.path = path;
        this.handler = handler;
        this.parameters = parameters;
        this.requireSession = requireSession;
        this.requireNoSession = requireNoSession;
        this.requiredPermissions = requiredPermissions;
        this.transaction = transaction;
    }

    /**
     * Checks whether this method cann be executed given the parameters and user of the call
     * @async
     * @param {Object} parms Object having all parameters passed by the user as properties
     * @param {Object|null} session Session-Object of the authenticated user, or null if this call is unauthenticated
     * @returns {boolean} true, if the call can be executed, false otherwise
     */
    async canBeExecuted(parms, session) {
        // check all parameters
        for(let parm of this.parameters) {
            let parmCheck = apiUtils.checkParameter(parm, parms);
            if(!parmCheck.passed) {
                return parmCheck;
            }
            // set parsed value
            if(parmCheck.newValue !== undefined) {
                parms[parm.key] = parmCheck.newValue;
            }
        }

        // Is the user allowed to execute this method?
        let permissionCheck = await apiUtils.allowedToExecuteMethod(session, this);
        if(!permissionCheck.passed) {
            return permissionCheck;
        }

        return {
            passed : true
        };
    }
    
    /**
     * Executes an API-method in a Promise.
     * Also handles a potential database transaction that is required by the method.
     * @param {MethodHandlerParms} methodHandlerParms 
     * @returns {Promise} A Promise that will resolve to an API-Response if the execution was successful,
     * or reject with an API-Response if not.
     */
    execute({ parms, request, response, session, methods }) {
        return new Promise(async (resolve, reject) => {
            let methodResult = null;
            let transactionStarted = false;
            try {

                // start a database transaction if the method requires it
                if(this.transaction === true) {
                    await db.startTransaction();
                    transactionStarted = true;
                }

                // Execute API-Method
                methodResult = await this.handler({
                    parms : parms,
                    request : request,
                    response : response,
                    session : session,
                    methods : methods
                });

                // If a database-transaction was started, commit or rollback depending on the result
                if(this.transaction === true && transactionStarted) {
                    if(methodResult.success) {
                        await db.commit();
                    } else {
                        await db.rollback();
                    }
                }

                // Return the results
                if(methodResult.data === undefined || methodResult.data === null) {
                    delete methodResult.data;
                }
                resolve(methodResult);

            } catch(e) {
                // catch errors occuring inside the API-method to prevent the API from crashing
                console.trace(e);
                if(this.transaction === true && transactionStarted) {
                    await db.rollback();
                }
                reject(ERROR_CODES.METHOD_ERROR);
            }
        });
    }
}

module.exports = APIMethod;