// ---------------------------------------------------------------------------------
// REQUIRED PREAMBLE
// ---------------------------------------------------------------------------------
const { APIModule, APIMethod, apiUtils, db, config } = require('../APIServer.js');
var apiModule = new APIModule();

const { v4 : getUUID } = require('uuid');

// ---------------------------------------------------------------------------------
// API-METHODS
// ---------------------------------------------------------------------------------

apiModule.addMethod(new APIMethod({
    path : '/session/request_login_token',
    parameters : [],
    requireSession : false,
    requireNoSession : true,
    requiredPermissions : [],
    transaction : true,
    handler : async ({ parms, request, response, session }) => {
        let token = await createToken(request);
        return apiUtils.success({ token : token });
    }
}));

apiModule.addMethod(new APIMethod({
    path : '/session/check_session',
    parameters : [
        { key : 'token', type : 'uuid' }
    ],
    requireSession : false,
    requireNoSession : true,
    requiredPermissions : [],
    transaction : true,
    handler : async ({ parms, request, response, session }) => {
        let sessionResult = await db.query('SELECT * FROM '+config.db.auth_database+'.api_sessions WHERE session_token=?', parms.token);
        if(sessionResult === null) {
            return apiUtils.error('MySQL-Error while loading the session.');
        }

        if(sessionResult.length === 0) {
            // If no session was found, we issue a login-token immediately so the client can spare
            // a call to /session/request_login_token
            let newToken = await createToken(request);
            return apiUtils.success({ session_valid : false, token : newToken });
        }

        let loadedSession = sessionResult[0];
        loadedSession = await apiUtils.getSession(loadedSession.session_id);
        let allowedEndpoints = await apiUtils.getAllowedEndpoints(loadedSession);
        return apiUtils.success({ session_valid : true, session : loadedSession, allowed_endpoints : allowedEndpoints });
    }
}));

apiModule.addMethod(new APIMethod({
    path : '/session/login',
    parameters : [
        { key : 'username', type : 'string' },
        { key : 'password_hash', type : 'sha256' }
    ],
    requireSession : false,
    requireNoSession : true,
    requiredPermissions : [],
    transaction : true,
    handler : async ({ parms, request, response, session }) => {
        // Check if the user exists
        let userResult = await db.query('SELECT * FROM '+config.db.auth_database+'.api_view_users WHERE login_name=? LIMIT 0,1', parms.username);
        if(userResult === null || userResult === undefined) {
            return apiUtils.error('MySQL-Error while looking for the user')
        }
        if(userResult.length !== 1) {
            return apiUtils.error('User not found');
        }
        let user = userResult[0];

        // Check if the user account is activated
        if(!user.active) {
            return apiUtils.error('User account not activated');
        }

        // load the login-token previously issued to the client
        let ip = request.ip;
        let userAgent = (request.headers['user-agent'] !== undefined ? request.headers['user-agent'] : 'NO USER AGENT');
        if(userAgent.length > 200) {
            userAgent = userAgent.substr(0, 200);
        }
        let loginTokenResult = await db.query('SELECT * FROM '+config.db.auth_database+'.api_login_tokens WHERE ip=? AND user_agent=? LIMIT 0,1', ip, userAgent);
        if(loginTokenResult === null) {
            return apiUtils.error('MySQL-Error while loading the login-token');
        }
        if(loginTokenResult.length !== 1) {
            return apiUtils.error('No valid login-token found for your client');
        }
        let loginToken = loginTokenResult[0]['login_token'];

        // Verify credentials
        if(apiUtils.sha256(user.password_hash, loginToken).toLowerCase() !== parms.password_hash.toLowerCase()) {
            return apiUtils.error('Wrong password');
        }

        // Delete all issued login-tokens for this client
        await db.query('DELETE FROM '+config.db.auth_database+'.api_login_tokens WHERE ip=? AND user_agent=?', ip, userAgent);

        // Create the new session
        let newSession = await apiUtils.createSession(user.user_id, ip, userAgent);
        if(newSession === null) {
            return apiUtils.error('An Error occured when creating the session');
        }

        // record login in user account
        await db.query('UPDATE '+config.db.auth_database+'.api_users SET last_login=NOW() WHERE user_id=?', user.user_id);

        return apiUtils.successSession({ session : newSession }, newSession);
    }
}));

apiModule.addMethod(new APIMethod({
    path : '/session/logout',
    parameters : [],
    requireSession : true,
    requireNoSession : false,
    requiredPermissions : [],
    transaction : true,
    handler : async ({ parms, request, response, session }) => {
        // Delete session from database
        if(!await apiUtils.deleteSession(session.session_id)) {
            return apiUtils.error('MySQL-Error while deleting the session');
        }

        // pass empty session back, so subsequent calls (in a multicall) are logged out
        return apiUtils.successSession(null, null);
    }
}));

apiModule.addMethod(new APIMethod({
    path : '/session/logout_others',
    parameters : [],
    requireSession : true,
    requireNoSession : false,
    requiredPermissions : [],
    transaction : true,
    handler : async ({ parms, request, response, session }) => {
        // get other sessions
        let sqlGetOthers = 'SELECT * FROM '+config.db.auth_database+'.api_sessions WHERE user_id=? AND session_id!=?';
        let otherSessions = await db.query(sqlGetOthers, session.user_id, session.session_id);

        // remove all other sessions
        for(let otherSession of otherSessions) {
            if(!await apiUtils.deleteSession(otherSession.session_id)) {
                return apiUtils.error('Error deleting one of the sessions');
            }
        }

        return apiUtils.success();
    }
}));

apiModule.addMethod(new APIMethod({
    path : '/session/keep_alive',
    parameters : [],
    requireSession : true,
    requireNoSession : false,
    requiredPermissions : [],
    transaction : true,
    handler : async ({ parms, request, response, session }) => {
        if(!await db.query('UPDATE '+config.db.auth_database+'.api_sessions SET expiration_date=DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE session_id=?', session.session_id)) {
            return apiUtils.error('MySQL-Error when updating the session expiration date');
        } else {
            let expirationDate = await db.query('SELECT expiration_date FROM '+config.db.auth_database+' WHERE session_id=?', session.session_id)[0].expiration_date;
            return apiUtils.success({ expires : expirationDate });
        }
    }
}));

// ---------------------------------------------------------------------------------
// HELPER FUNCTIONS
// ---------------------------------------------------------------------------------
/**
 * Creates a login-token for the client of the request
 * @param {Object} request 
 * @returns {string} newly created login-token
 */
async function createToken(request) {
    // Bind token to the client by recording its IP and hostname
    let ip = request.ip;
    let userAgent = (request.headers['user-agent'] !== undefined ? request.headers['user-agent'] : 'NO USER AGENT');
    if(userAgent.length > 200) {
        userAgent = userAgent.substr(0, 200);
    }

    // generate token
    let token = getUUID();

    // Delete all previously issued tokens of the client
    await db.query('DELETE FROM '+config.db.auth_database+'.api_login_tokens WHERE ip=? AND user_agent=?', ip, userAgent);
    
    // Store new token for 1 hour
    let result = await db.query(
        'INSERT INTO '+config.db.auth_database+'.api_login_tokens (expiration_date, ip, user_agent, login_token) VALUES(DATE_ADD(NOW(), INTERVAL 1 HOUR), ?, ?, ?);',
        ip, userAgent, token
    );

    return token;
}

// ---------------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------------
module.exports = apiModule;