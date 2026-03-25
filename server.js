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
      error: "Proibido"
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
      error: "Proibido"
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
require('./app/routes/models.routes.js')(app);
require('./app/routes/database.routes.js')(app);

app.get('*', limiterApiRequestsInvalid, function (req, res, next) {

    res.status(404).json({ message: 'Caminho não encontrado ❌' });

});
  
// start server only if this file is run directly
if (require.main === module) {
    const { getInstance } = require('./app/services/storage.service');
    const { getInstance: getModelService } = require('./app/services/model.service');
    const { getInstance: getOpsService } = require('./app/services/operations.service');
    const { getInstance: getDatabaseService } = require('./app/services/database.service');

    (async () => {
        // Limpa arquivos de dados e registro de instâncias se COMPLETELY_CLEAN_START=1
        if (Number(process.env.COMPLETELY_CLEAN_START) === 1) {
            const baseDir = './app/assets';
            const instancesFile = path.join(baseDir, 'instances.log');

            const files = await fs.promises.readdir(baseDir);
            const targetFiles = files.filter(file => /^(data|ops|models|db)-.*\.json$/.test(file));
            await Promise.all(targetFiles.map(file => fs.promises.unlink(path.join(baseDir, file))));

            try {
                await fs.promises.unlink(instancesFile);
            } catch (err) {
                if (err.code !== 'ENOENT') throw err;
            }

            console.log('⚠️ Start completamente limpo: arquivos de dados e registro de instâncias removidos.');
        } else {
            console.log('✅ Start normal: mantendo arquivos de dados e registro de instâncias existentes.');
        }

    const server = app.listen(process.env.PORT || 3131, () => {
        console.log('Servidor iniciado na porta 👉', process.env.PORT, BASE_URL);
    });

    const shutdown = async (signal) => {
        console.log(`\nRecebido ${signal}. Iniciando encerramento gracioso...`);

        server.close(async () => {
            console.log('Servidor encerrado.');

            //destrói o serviço de armazenamento para garantir que todos os arquivos sejam fechados corretamente
            try {
                const storage = getInstance();
                await storage.destroy();
                console.log('Serviço de armazenamento limpo e fechado.');
            } catch (err) {
                console.error('Erro durante a limpeza do serviço de armazenamento:', err);
            }

            //destrói o serviço de modelos para garantir que todos os arquivos sejam fechados corretamente
            try {
                const modelService = getModelService();
                await modelService.destroy();
                console.log('Serviço de modelos limpo e fechado.');
            } catch (err) {
                console.error('Erro durante a limpeza do serviço de modelos:', err);
            }

            //destrói o serviço de operações para garantir que todos os arquivos sejam fechados corretamente
            try {
                const opsService = getOpsService();
                await opsService.destroy();
                console.log('Serviço de operações limpo e fechado.');
            } catch (err) {
                console.error('Erro durante a limpeza do serviço de operações:', err);
            }

            //destrói o serviço de banco de dados
            try {
                const dbService = getDatabaseService();
                await dbService.destroy();
                console.log('Serviço de banco de dados limpo e fechado.');
            } catch (err) {
                console.error('Erro durante a limpeza do serviço de banco de dados:', err);
            }

            console.log('Encerramento gracioso concluído.');
            process.exit(0);
        });

        // Forçar saída se o encerramento demorar muito
        setTimeout(() => {
            console.error('Tempo limite de encerramento excedido. Forçando saída.');
            process.exit(1);
        }, 10000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    })();
}

module.exports = app;



