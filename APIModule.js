class APIModule {
    constructor() {
        this.methods = [];
    }

    addMethod(method) {
        this.methods.push(method);
    }
    addMethods(methods) {
        methods.forEach((method) => {
            this.addMethod(method);
        });
    }
}

module.exports = APIModule;