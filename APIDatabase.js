// ---------------------------------------------------------------------------------
// IMPORTS
// ---------------------------------------------------------------------------------
const mysql = require('mysql');
const config = require('./APIConfig.js');

// ---------------------------------------------------------------------------------
// APIDatabase CLASS
// ---------------------------------------------------------------------------------
/**
 * This class is a wrapper around the mysql class to promisify certain actions
 * and to add automatic casting of certain mysql-field-types into js types
 */
class APIDatabase {
    /**
     * Creates a new APIDatabase instance.
     * The config will be loaded from the singleton APIConfig object exported from APIConfig.js.
     * Make sure to call set(config) on the APIConfig-object beforehand.
     */
    constructor() {
        this.connection = null;

        // Timezone-Offset for automatic casting of date-related fields
        this.tzoffset = (new Date()).getTimezoneOffset() * 60000;
    }

    // ---------------------------------------------------------------------------------
    // CONNECTION
    // ---------------------------------------------------------------------------------
    /**
     * Connect to the database
     * @returns {Promise} Promise that will resolve when the connection is established
     */
    connect() {
        return new Promise((resolve, reject) => {
            if(this.connection === null) {
                console.log('Connecting to MySQL');
                this.connection = mysql.createConnection({
                    host : config.db.host,
                    user : config.db.user,
                    password : config.db.password,
                    database : config.db.auth_database
                });
                this.connection.connect((err) => {
                    if(err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Disconnect from the database
     * @returns {Promise} Promise that will resolve when the connection is closed
     */
    disconnect() {
        return new Promise((resolve, reject) => {
            if(this.connection !== null) {
                console.log('Closing MySQL-Connection');
                this.connection.end((err) => {
                    if(err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });
    }

    // ---------------------------------------------------------------------------------
    // QUERY
    // ---------------------------------------------------------------------------------
    /**
     * Execute an SQL-Query
     * @param {string} sql SQL-Statement to run
     * @param  {...any} values Parameters for prepared statements
     * @returns {Promise} A Promise that will resolve to an Array containing one object for each row returned by the query,
     * or be rejected if a mysql-error occured.
     */
    query(sql, ...values) {
        return new Promise((resolve, reject) => {
            try {
                this.connection.query(sql, values, (error, rows, fields) => {
                    if(error) {
                        console.log('MySQL-Error', error);
                        reject();
                    } else {
                        // Auto-sanitize certain datatypes
                        if(Array.isArray(rows)) {
                            for(let row of rows) {
                                for(let field of fields) {
                                    if(row[field.name] !== null) {
                                        switch(field.type) {
                                            case 1: // tinyint
                                                row[field.name] = (row[field.name] === 1 ? true : false);
                                                break;
                                            case 10: // date
                                                row[field.name] = (new Date(row[field.name] - this.tzoffset)).toISOString().slice(0, 10);
                                                break;
                                            case 12: // datetime
                                                row[field.name] = (new Date(row[field.name] - this.tzoffset)).toISOString().slice(0, 19).replace('T', ' ');
                                                break;
                                        }
                                    }
                                }
                            }
                        }
                        resolve(rows);
                    }
                });
            } catch(err) {
                console.log('MySQL-Error', err);
                reject();
            }
        });
    }

    // ---------------------------------------------------------------------------------
    // TRANSACTIONS
    // ---------------------------------------------------------------------------------
    /**
     * Starts a Transaction
     * @returns {Promise} Promise that is resolved when a transaction has been started
     */
    startTransaction() {
        return new Promise((resolve, reject) => {
            this.connection.beginTransaction((err) => {
                if(err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
    /**
     * Commits a Transaction
     * @returns {Promise} Promise that is resolved when a transaction has been committed
     */
    commit() {
        return new Promise((resolve, reject) => {
            this.connection.commit((err) => {
                if(err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
    /**
     * Rolls back a Transaction
     * @returns {Promise} Promise that is resolved when a transaction has been rolled back
     */
    rollback() {
        return new Promise((resolve, reject) => {
            this.connection.rollback((err) => {
                if(err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
};

module.exports = new APIDatabase();