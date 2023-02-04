# md_api_server
Node.js module to create JSON-RPC APIs

- Supports HTTP/1.1 and HTTPS via SPDY and HTTP/2
- Public methods as well as methods that are only available to registered users
- Permission-Management to control which user can call which use which methods
- Automatic checking and sanitizing of passed parameters
- Accepts parameters being passed via GET or POST, with POST-body content-types `application/json` or `application/x-www-form-urlencoded`
- Multicall-method to perform multiple calls in one rountrip

## Getting started

### Prerequisites
This project depends on the following npm-packages:
- Core modules:
  - url
  - querystring
  - http
  - fs
  - crypto
- npm modules:
  - [express](https://www.npmjs.com/package/express)
  - [compression](https://www.npmjs.com/package/compression)
  - [spdy](https://www.npmjs.com/package/spdy)
  - [mysql](https://www.npmjs.com/package/mysql)
  - [uuid](https://www.npmjs.com/package/uuid)

Install all dependencies that are no core modules via the following command:
```sh
npm install express compression spdy mysql uuid
``` 

### Installation
This package is not available on npm as of now, but you can easily include it in your projects as a git submodule.
```sh
git submodule add git@github.com:ZaubererMD/md_api_server.git
```

Note: I am very likely to change the name of this repository soon and the URL of the repo will probably change as well, since I don't really believe anybody besides me will be using it by that point. If you somehow found this repository and use it, please let me know so I can inform you of such a change beforehands.

## Usage
## Instantiate API-Server
To set up an API-Server, you just need to create a new object of the class `APIServer` with a valid configuration and call the `start()` method:
```js
const { APIServer } = require('./md_api_server/APIServer.js');
var apiServer = new APIServer(config);
apiServer.start();
```
The Server will automatically connect to the configured MySQL-Instance, so make sure it is running before starting the server.

## Configuration
The `config` object passed when instantiating the `APIServer` object must follow the following blueprint:
```js
const config = {
  http : {
    port : 3000
  },
  https : {
    port : 3001,
    cert : 'server.cert',
    key : 'server.key'
  },
  db : {
    host : 'DB_HOST',
    user : 'DB_USER',
    password : 'DB_PASSWORD',
    auth_database : 'DB_NAME'
  }
};
```
You can leave the `http` and `https` properties empty. If so, the corresponding server will not be started and your API will only be available via HTTP (if you leave out HTTPS) or vice versa.

The `db`-configuration is required to run the server.

## Adding API-methods
Of course you do not just want run the server with the default methods (session-management and multicall), but add your own functionality. For this you have to create `APIModules` that contain `APIMethod`s. I recommend creating a source file for each `APIModule`. A blueprint for an empty `APIModule` file can be found at [module.js.example](module.js.example).

When using the [module.js.example](module.js.example) blueprint all required imports and exports are already included and a new `APIModule` is instantiated at the top of the file. You can then add your own `APIMethod`s as follows:

```js
apiModule.addMethod(new APIMethod({
  path : '/test',
  parameters : [],
  requireSession : false,
  requiredPermissions : [],
  transaction : false,
  handler : async ({ parms, session }) => {
    return apiUtils.success({ foo : 'bar' });
  }
}));
```
This example method will be available under `/test`, have no required parameters, does not require the user to be logged in or have any special permissions and it will also not be wrapped in a database transaction. It will return a static JSON-object `{ foo : 'bar' }`.

The parameters of new `APIMethod`s are explained in more detailed in the JSDOC comments in [APIMethod.js](APIMethod.js). The use of method-parameters is also documented there.

Your methods will probably contain more involved logic than just a static return. If you ever run into any errors use `return apiUtils.error(MSG);` instead of `return apiUtils.success(DATA);`.

More examples of methods that include usage of parameters and the database can be found in the default methods of the session management in [session.js](default_api_modules/session.js).

## User-Management
Users and their permissions are stored in the database. This section is a TODO.

## Session-Management
TODO: Explain how the login-flow works.

## Response-Syntax
The APi responds with a JSON-Object that has the following properties:
- {boolean} success: Flag indicating whether the method-execution was successful. An unsuccessful execution could be the result of an internal error, missing or wrong parameters, or the result of internal logic of the method.
- {string} [msg]: Only passed if success is false. A human-readable explanation of what went wrong.
- {string} [code]: Only passed if success is false, but not always. It is a constant from `ERROR_CODES` in [APIConstants.js](APIConstants.js) that allows the application to react to certain errors autoamtically (like prompting the user to login again when an invalid session is detected).
- {any} [data]: Is returned if success is true. Might also be null. The data returned by the `APIMethod` in `return apiUtils.success(DATA);`.

## Multicall
TODO: Explain what this is

## Clients
Since the API is available via HTTP and responds with JSON, development of clients in different languages is relatively easy. Currently the following Client-implementations exist:
- JavaScript: not on GitHub yet
- bash: [md_api_client_sh](https://github.com/ZaubererMD/md_api_client_sh)

# TODO:
- create a procedure to automatically end old sessions
- add code to automatically create the database, or at least an sql-file that contains the statements to do it
- Explain User- and Session-Management in the Readme

## License

This code is freely distributable under the terms of the [MIT license](LICENSE).
