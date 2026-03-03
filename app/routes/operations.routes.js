const { verificaToken } = require("../middlewares/authentication.js");
let BASE_URL = process.env.BASE_URL;

module.exports = app => {

    const ops = require('../controllers/operations.controller.js');

    app.route(BASE_URL + 'setEntry')
        .post(verificaToken, ops.setEntry);

    app.route(BASE_URL + 'readAllEntries/:instance')
        .get(verificaToken, ops.readAllEntries);

    app.route(BASE_URL + 'getEntry')
        .post(verificaToken, ops.getEntry);

    app.route(BASE_URL + 'listInstances')
        .get(verificaToken, ops.listInstances);

    app.route(BASE_URL + 'registerAndConnect')
        .get(ops.registerAndConnect);

    app.route(BASE_URL + 'flush')
        .post(verificaToken, ops.flush);

    app.route(BASE_URL + 'setModel/:instance')
        .post(verificaToken, ops.createModel);

    app.route(BASE_URL + 'getAllModels/:instance')
        .get(verificaToken, ops.getAllModels);
}