class APIConfig {
    constructor() {
    }
    set(config) {
        Object.keys(config).forEach((key) => {
            this[key] = config[key];
        });
    }
}

module.exports = new APIConfig();