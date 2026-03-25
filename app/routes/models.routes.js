const { verificaToken } = require("../middlewares/authentication.js");
let BASE_URL = process.env.BASE_URL;

module.exports = app => {
    const models = require('../controllers/models.controller.js');

    app.route(BASE_URL + 'setModel/:instance')
        .post(verificaToken, models.createModel);

    app.route(BASE_URL + 'getAllModels/:instance')
        .get(verificaToken, models.getAllModels);
};
