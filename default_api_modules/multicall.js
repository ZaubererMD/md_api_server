// ---------------------------------------------------------------------------------
// REQUIRED PREAMBLE
// ---------------------------------------------------------------------------------
const { APIModule, APIMethod, apiUtils, db, config } = require('../APIServer.js');
var apiModule = new APIModule();

// ---------------------------------------------------------------------------------
// API-METHODS
// ---------------------------------------------------------------------------------
apiModule.addMethod(new APIMethod({
    path : '/multicall',
    parameters : [
        { key : 'content', type : 'json', optional : false }
    ],
    requireSession : false,
    requireNoSession : false,
    requiredPermissions : [],
    transaction : false,
    handler : async ({ parms, session, request, response, methods }) => {
        if(parms.content.calls === undefined || parms.content.calls === null || !Array.isArray(parms.content.calls)) {
            return apiUtils.error('No calls transmitted for the multicall.');
        }

        let responses = [];
        for(let call of parms.content.calls) {

            let method = methods.find((method) => {
                return method.path === call.method;
            });
            if(method !== undefined && method !== null) {
                try {
                    let callResponse = await apiUtils.tryExecuteMethod(method, call, session, request, response, methods);
                    responses.push(apiUtils.makeClientResponse(callResponse));

                    // If the call changed anything about the session status (login/logout) propagate the change for the subsequent call
                    if(callResponse.session !== undefined && callResponse.session !== null) {
                        session = callResponse.session;
                    }

                    // If the call has a breaking-flag and the success-flag is false, then we do not continue executing the other calls
                    if(call.breaking !== undefined && call.breaking === true && callResponse.success === false) {
                        break;
                    }
                } catch(e) {
                    responses.push(apiUtils.error('An Error occured while executing a requested multicall-method', ERROR_CODES.MULTICALL_ERROR));
                    if(call.breaking) {
                        break;
                    }
                }
            }
        }

        return apiUtils.success({ responses : responses });
    }
}));

// ---------------------------------------------------------------------------------
// HELPER FUNCTIONS
// ---------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------------
module.exports = apiModule;