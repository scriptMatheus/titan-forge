require('dotenv').config();

const express = require("express");
const bodyParser = require("body-parser");
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const createError = require('http-errors');

const { limiterApiRequests, limiterApiRequestsInvalid } = require('./app/middlewares/rateLimit.js');
const  {noSqlInjection}  = require('./app/middlewares/nosqlinjection.js');
const blockedOrigins = require('./app/middlewares/blockedOrigins.json'); // blocked terms in user-agent or origin

let BASE_URL = process.env.BASE_URL || '/titan-forge/';
global.__basedir = __dirname;

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(morgan('combined'));

// Middleware para verificar se a URL contém /titan-forge/
app.use((req, res, next) => {
  const url = req.url;

  // Verifica se a URL contém /titan-forge/
  if (!url.includes('/titan-forge/')) {
    console.log(`Requisição bloqueada. 🚫 URL não contém a url-base correta: ${url}`);
    return res.status(500).json({ 
      message: "Acesso negado",
      error: "Forbidden"
    });
  }
  
  next();
});

app.use(bodyParser.json({limit: '50mb'}));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use(compression());
app.use(express.json());

// Middleware para bloquear requisições de origens suspeitas
app.use((req, res, next) => {
  const origin = req.header("Origin") || '';
  const userAgent = req.header("User-Agent") || '';
  
  // Verifica se user-agent ou origin contém algum termo bloqueado
  const isBlocked = blockedOrigins.some(blockedTerm => 
    userAgent.toLowerCase().includes(blockedTerm.toLowerCase())
  );
  
  if (isBlocked) {
    console.log(`Requisição bloqueada. 🚫 User-Agent: ${userAgent} | Origin: ${origin}`);
    return res.status(500).json({ 
      message: "Acesso negado",
      error: "Forbidden"
    });
  }
  
  next();
});

app.use(noSqlInjection);
var corsOptionsDelegate = function (req, callback) {
    var corsOptions;
    // if (allowlist.indexOf(req.header('Origin')) !== -1) {
        corsOptions = { origin: true }; // reflect (enable) the requested origin in the CORS response
    // } else {
    //     corsOptions = { origin: false } // disable CORS for this request
    // }
    callback(null, corsOptions)
} 


//verificar se diretorios obrigatorios existem
const fs = require('fs');
const path = require('path');
const dir1 = path.join("./app", '/assets/s3temp');
const dir2 = path.join("./app", '/assets/tempDocx');
const dir3 = path.join("./app", '/assets/tempPdf');

if (!fs.existsSync(dir1)) {
    fs.mkdirSync(dir1);
}

if (!fs.existsSync(dir2)) {
    fs.mkdirSync(dir2);
}
if (!fs.existsSync(dir3)) {
    fs.mkdirSync(dir3);
}

// CORS support
app.use(function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
  });
  
app.use(cors(corsOptionsDelegate));
app.use(BASE_URL, limiterApiRequests);
app.get(BASE_URL, (req, res) => {
    res.send('Você está no Titan Forge 🪨');
}
);
require('./app/routes/operations.routes.js')(app);

app.get('*', limiterApiRequestsInvalid, function (req, res, next) {

    res.status(404).json({ message: 'Caminho não encontrado ❌' });

});
  
app.listen(process.env.PORT || 3131, () => {
    console.log('Server started on port 👉',process.env.PORT, BASE_URL);
}
);


