// ---------------------------------------------------------------------------------
// IMPORTS
// ---------------------------------------------------------------------------------
// Dependencies
const express = require('express');
const compression = require('compression');
const url = require('url');
const qs = require('querystring');
const http = require('http');
const spdy = require('spdy');
const fs = require('fs');
const cors = require('cors');

// Import other Modules
const APIModule = require('./APIModule.js');
const APIMethod = require('./APIMethod.js');
const { ERROR_CODES } = require('./APIConstants.js');

// API-specific Singleton objects
const db = require('./APIDatabase.js');
const apiUtils = require('./APIUtils.js');
const config = require('./APIConfig.js');

// ---------------------------------------------------------------------------------
// APIServer CLASS
// ---------------------------------------------------------------------------------
/**
 * Class for managing an MD-API-Server
 */
class APIServer {
    /**
     * Creates a new instance of an MD-API-Server
     * @param {Object} newConfig Configuration properties of the API Instance
     * @param {Object} newConfig.db MySQL-Database Configuration
     * @param {string} newConfig.db.host Host the MySQL instance runs on
     * @param {string} newConfig.db.user Username to use for MySQL-authentication
     * @param {string} newConfig.db.password Password to use for MySQL-authentication
     * @param {string} newConfig.db.auth_database Database that contains the the authorization tables
     * @param {Object} [newConfig.http] HTTP-Server configuration, if this is left out no HTTP server will be started
     * @param {integer} newConfig.http.port Port to run the HTTP server on
     * @param {Object} [newConfig.https] HTTPS-Server configuration, if this is left out no HTTPS server will be started
     * @param {integer} newConfig.https.port Port to run the HTTPS server on
     * @param {string} newConfig.https.cert path to SSL certificate
     * @param {string} newConfig.https.key path to SSL keyfile
     */
    constructor(newConfig) {
        config.set(newConfig);

        this.serverHTTP = null;
        this.serverHTTPS = null;
        this.app = null;

        this.methods = [];
        this.modules = [];

        // add the default modules
        this.addModule(require('./default_api_modules/multicall.js'));
        this.addModule(require('./default_api_modules/session.js'));
    }

    /**
     * Adds a new method to the API-server
     * @param {APIMethod} method the method to add
     */
    addMethod(method) {
        this.methods.push(method);
    }
    /**
     * Adds new methods to the API-server
     * @param {APIMethod[]} methods the methods to add
     */
    addMethods(methods) {
        methods.forEach((method) => {
            this.addMethod(method);
        });
    }

    /**
     * Adds a new module to the API-server
     * @param {APIModule} module the module to add
     */
    addModule(module) {
        this.modules.push(module);
        this.addMethods(module.methods);
    }
    /**
     * Adds new modules to the API-server
     * @param {APIModule[]} modules the modules to add
     */
    addModules(modules) {
        modules.forEach((module) => {
            this.addModule(module);
        });
    }

    /**
     * Starts the API-server
     */
    start() {
        // Connect to the database
        db.connect()
        .then(() => {
            // ---------------------------------------------------------------------------------
            // INITIALIZE API
            // ---------------------------------------------------------------------------------
            this.app = express();

            // Set md_api_server in the x-powered-by header
            this.app.set('x-powered-by', false);
            this.app.use((req, res, next) => {
                res.header('x-powered-by', 'md_api_server');
                next();
            });

            // Allow CORS for all methods
            this.app.use((req, res, next) => {
                res.header('Access-Control-Allow-Origin', '*');
                res.header('Access-Control-Allow-Headers', 'Content-Length, Authorization, Origin, X-Requested-With, Content-Type, Accept');
                res.header('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
                next();
            });

            // Create HTTP-Handlers for all registered methods
            for(let method of this.methods) {
                this.createMethodHandler(method);
            }

            // Compress the response
            this.app.use(compression());

            // Default-Response when no matching method is found
            this.app.use((request, response) => {
                let res = apiUtils.error('Unknown API-method', ERROR_CODES.METHOD_UNKNOWN);
                response.json(res);
            });

            // Launch HTTP Server
            if(config.http !== undefined && config.http !== null && config.http.port !== undefined && config.http.port !== null) {
                this.serverHTTP = http.createServer(this.app);
                this.serverHTTP.listen(config.http.port);
                console.log('HTTP-Server running on port', config.http.port);
            }

            // Launch HTTPS Server
            if(config.https !== undefined && config.https !== null && config.https.port !== undefined && config.https.port !== null) {
                this.serverHTTPS = spdy.createServer({
                    key : fs.readFileSync(config.https.key),
                    cert : fs.readFileSync(config.https.cert)
                }, this.app);
                this.serverHTTPS.listen(config.https.port);
                console.log('HTTPS-Server running on port', config.https.port);
            }

        })
        .catch((err) => {
            console.log(err);
            console.log('Error initializing the server, shutting down');
            process.exit();
        });

        // Register a handler to close all connections on SIGINT
        process.on('SIGINT', () => {
            this.close()
            .then(() => {
                process.exit();
            }).catch((e) => {
                console.log(e);
                process.exit();
            });
        });
    }

    /**
     * Creates a handler for the given API-Method and registers it with express
     * @param {APIMethod} method Method to create the handler for
     */
    createMethodHandler(method) {
        let handler = (request, response) => {
           this.methodHandlerWrapper(request, response, method);
        };

        this.app.get(method.path, handler);
        this.app.post(method.path, handler);
    }

    /**
     * Wrapper around all API-methods that collects parameters from the request,
     * establishes a session if a session-token was given,
     * verifies whether the method can be executed with the given session and parameters
     * and executes it if so.
     * @param {Object} request 
     * @param {Object} response 
     * @param {APIMethod} method 
     */
    methodHandlerWrapper(request, response, method) {
        // Retrieve Parameters passed via GET
        let url_parts = null;
        let parms = null;
        try {
            url_parts = url.parse(request.url, true);
            parms = url_parts.query;
        } catch(err) {
            console.log('Error at start of request', err);
            response.json(apiUtils.error('JS Error at start of request.', ERROR_CODES.HANDLER_ERROR));
            response.end();
        }
        
        // Retrieve Parameters from the body (POST)
        let body = '';
        request.on('data', (data) => {
            try {
                body += data;

                // Too much POST data, kill the connection!
                // 1e6 === 1 * Math.pow(10, 6) === 1 * 1000000 ~~~ 1MB
                if (body.length > 1e6) {
                    console.log('Connection was destroyed, post body was too large!');
                    request.connection.destroy();
                }
                return;
            } catch(err) {
                console.log('Error reading the request body', err);
                response.json(apiUtils.error('JS error at reading request body.', ERROR_CODES.HANDLER_ERROR));
                response.end();
            }
        });
        request.on('end', async () => {
            try {

                // Parse body parms depending on content-type
                let bodyParms = {};
                if(request.headers['content-type'] === 'application/json') {
                    bodyParms = JSON.parse(body);
                } else if(request.headers['content-type'] === 'application/x-www-form-urlencoded') {
                    bodyParms = qs.parse(body);
                }

                // merge GET- and POST-parmameters into one object
                parms = {...parms, ...bodyParms};

                let session = null;
                // if a token was transmitted, try to load the corresponding session
                if(parms.token !== undefined && parms.token !== null) {
                    if(parms.token.length === 36) { // length of uuid
                        session = await apiUtils.establishSession(parms.token);
                    }
                }

                let methodResponse = await apiUtils.tryExecuteMethod(method, parms, session, request, response, this.methods);
                response.json(apiUtils.makeClientResponse(methodResponse));
                response.end();
                
            } catch(err) {
                console.log('Error handling a request', err);
                response.json(apiUtils.makeClientResponse(apiUtils.error('An Error occured while handling your request.', ERROR_CODES.HANDLER_ERROR)));
                response.end();
            }
        });
    }

    // ---------------------------------------------------------------------------------
    // SERVER TERMINATION
    // ---------------------------------------------------------------------------------

    /**
     * Closes all servers and connections
     * @returns Promise that will resolve when everything is closed
     */
    close() {
        return this.closeHTTPServer()
        .then(() => {
            return this.closeHTTPSServer();
        }).then(() => {
            return db.disconnect();
        }).catch((e) => {
            console.log(e);
        });
    }

    /**
     * Promisifies the close-method of the HTTP-Server, but also checks whether it is running
     * in the first place. If it is not running the promise is resolved immediately.
     * @returns Promise that is resolved when the HTTP Server is closed
     */
    closeHTTPServer() {
        return new Promise((resolve, reject) => {
            if(this.serverHTTP === null) {
                resolve();
            } else {
                console.log('Closing HTTP Server');
                this.serverHTTP.close((err) => {
                    if(err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            }
        });
    }

    /**
     * Promisifies the close-method of the HTTPS-Server, but also checks whether it is running
     * in the first place. If it is not running the promise is resolved immediately.
     * @returns Promise that is resolved when the HTTPS Server is closed
     */
    closeHTTPSServer() {
        return new Promise((resolve, reject) => {
            if(this.serverHTTPS === null) {
                resolve();
            } else {
                console.log('Closing HTTPS Server');
                this.serverHTTPS.close((err) => {
                    if(err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            }
        });
    }
}

// ---------------------------------------------------------------------------------
// EXPORT CLASSES AND SINGLETON OBJECTS
// ---------------------------------------------------------------------------------
module.exports = {
    APIServer : APIServer,
    APIModule : APIModule,
    APIMethod : APIMethod,
    apiUtils : apiUtils,
    db : db,
    config : config
};