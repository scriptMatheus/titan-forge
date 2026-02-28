const util = require("util");
const multer = require("multer");
const path = require("path");
const fs = require('fs')


const { s3uploadFile, s3GetSignedUrl } = require("../services/s3Client.service");
const maxSize = 10 * 1024 * 1024; // 10MB

let nomeArquivoNovoFinal = "";
let storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'app/assets/temp');
    },
    filename: (req, file, cb) => {
        // mudar nome do arquivo
        let nomeArquivo = file.originalname;
        let extensao = nomeArquivo.split('.').pop();
        let nomeArquivoNovo = nomeArquivo.split('.').shift();
        nomeArquivoNovo = Date.now() + '.' + extensao;
        nomeArquivoNovoFinal = nomeArquivoNovo;
        cb(null, nomeArquivoNovo);
        // cb(null, file.originalname);
    },
});

let uploadFile = multer({
    storage: storage,
    limits: { fileSize: maxSize },
}).single("file");




const isUpload = async (req, res) => {
    uploadFile(req, res, (err) => {
        if (err) {

            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(500).send({
                    message: "File size cannot be larger than 2MB!",
                });
            }
            return res.status(500).send({
                message: "Erro ao enviar arquivo",
                error: err
            });
        } else {

            console.log('😀 -----: ', req.file);
            const filePath = path.join('app/assets/temp', nomeArquivoNovoFinal);

            console.log('😀 -----: ', filePath);


            const url = s3uploadFile(nomeArquivoNovoFinal, filePath, req.file.mimetype);
            
         
            url.then(data => {

                fs.unlinkSync(filePath);
                const urlPublica = s3GetSignedUrl(nomeArquivoNovoFinal);

                urlPublica.then(data => {

                return res.status(200).send({
                    message: "Arquivo enviado com sucesso",
                    nomeArquivo: nomeArquivoNovoFinal,
                    url: data
                });

                })

            })

        }
    });
};




// retorna nome arquivo 



let uploadFileMiddleware = util.promisify(uploadFile);

module.exports = { uploadFileMiddleware, isUpload };

