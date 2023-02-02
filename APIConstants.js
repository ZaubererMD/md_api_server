// ---------------------------------------------------------------------------------
// CONSTANTS TO BE SHARED BETWEEN SERVERS AND CLIENTS
// ---------------------------------------------------------------------------------
const ERROR_CODES = {
    PERMISSION_MISSING : 'PERMISSION_MISSING',
    PERMISSION_SESSION : 'PERMISSION_SESSION',
    PERMISSION_NO_SESSION : 'PERMISSION_NO_SESSION',
    PARAM_MISSING : 'PARAM_MISSING',
    PARAM_TYPE : 'PARAM_TYPE',
    PARAM_RANGE : 'PARAM_RANGE',
    HANDLER_ERROR : 'HANDLER_ERROR',
    METHOD_ERROR : 'METHOD_ERROR',
    METHOD_UNKNOWN : 'METHOD_UNKNOWN',
    MULTICALL_ERROR : 'MULTICALL_ERROR'
};

module.exports = { ERROR_CODES : ERROR_CODES };