const { verificaToken } = require("../middlewares/authentication.js");
let BASE_URL = process.env.BASE_URL;

module.exports = app => {
    const db = require('../controllers/database.controller.js');

    app.route(BASE_URL + 'setDataOnModel/:instance')
        .post(verificaToken, db.setDataOnModel);

    app.route(BASE_URL + 'listAllData/:instance')
        .get(verificaToken, db.listAllData);

    app.route(BASE_URL + 'listDataFromUniqueId/:instance/:id')
        .get(verificaToken, db.listDataFromUniqueId);

    app.route(BASE_URL + 'benchmark/database')
        .get(verificaToken, db.benchmarkDatabase);
};
