// doc for pdf file
const uuid = require("uuid");
const fs = require("fs");
const jwt = require('jsonwebtoken')
const tokenSecret = process.env.SECRET;

function generateToken() {

    //data BR
    return jwt.sign({ dateTime: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) }, tokenSecret, { expiresIn: '24h' })
}

exports.registerAndConnect = async (req, res) => {
  // const { value, key } = req.query;

  //gera um UUID
  let generatedHash = uuid.v4();

  //cria diretório e arquivo instances.log
  const dir = "./app/assets";
  const filePath = "./app/assets/instances.log";

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }

  //não existe arquivo, então cria um novo, caso contrário, mantém o existente e inclui o novo conteúdo
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, generatedHash + "\n", "utf8");

  //já existe, só adiciona o novo hash (nova instância) no final do arquivo
  }else {

    //verifica se o hash gerado já existe no arquivo, caso exista, gera um novo hash até que seja único
    let fileContent = fs.readFileSync(filePath, "utf8");
    let instances = fileContent.split("\n").filter(line => line.trim() !== ""); // Remove linhas vazias

    while (instances.includes(generatedHash)) {
      generatedHash = uuid.v4();
    }

    fs.appendFileSync(filePath, generatedHash + "\n", "utf8");
  }

  const token = generateToken();

  return res.status(200).json({
    message: "Registered and connected",
    hash: generatedHash,
    token: token
  });

};

exports.setEntry = async (req, res) => {
  const { value, key, instance } = req.body;

  if (!instance || value == undefined || !key) {
    return res.status(400).json({
      message: "Missing required fields",
    });
  }

  //valida se instance existe no arquivo instances.log
  const filePath = "./app/assets/instances.log";
  const fileContent = fs.readFileSync(filePath, "utf8");
  const instances = fileContent.split("\n").filter(line => line.trim() !== ""); // Remove linhas vazias

  if (!instances.includes(instance)) {
    return res.status(400).json({
      message: "Invalid instance",
    });
  }

  //valida se o arquivo data.json existe, caso contrário, cria um novo
  const dataFilePath = "./app/assets/data-" + instance + ".json";

  if (!fs.existsSync(dataFilePath)) {
    fs.writeFileSync(dataFilePath, JSON.stringify({}), "utf8");
  }

  //lê o conteúdo atual do arquivo
  const dataFileContent = fs.readFileSync(dataFilePath, "utf8");
  var data = JSON.parse(dataFileContent);

  //atualiza o conteúdo do arquivo com a nova entrada
  data[key] = value;

  //escreve o conteúdo atualizado de volta no arquivo
  fs.writeFileSync(dataFilePath, JSON.stringify(data), "utf8");

  //verifica se arquivo de operações executadas já existe, caso contrário, cria um novo
  const opsFilePath = "./app/assets/ops-" + instance + ".json";

  if (!fs.existsSync(opsFilePath)) {
    fs.writeFileSync(opsFilePath, JSON.stringify([]), "utf8");
  }

  //lê o conteúdo atual do arquivo de operações executadas
  const opsFileContent = fs.readFileSync(opsFilePath, "utf8");
  var opsData = JSON.parse(opsFileContent);

  //adiciona a nova operação executada no array
  opsData.push({ key, value });

  //escreve o conteúdo atualizado de volta no arquivo de operações executadas
  fs.writeFileSync(opsFilePath, JSON.stringify(opsData), "utf8");

  return res.status(201).json({
    status: "Created/Updated",
  });

};

exports.readAllEntries = async (req, res) => {
  let { instance } = req.params;
  let { isRoot } = req.query;

  if (!instance) {
    return res.status(400).json({
      message: "Missing required fields",
    });
  }

  if (isRoot != undefined && isRoot != null) {
    isRoot = Number(isRoot);

    if (isRoot !== 0 && isRoot !== 1) {
      return res.status(400).json({
        message: "Invalid isRoot value. Must be 0 or 1.",
      });
    }

  }else{
    isRoot = 0;
  }

  //verifica se instance é um uuid válido
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(instance)) {
    return res.status(400).json({
      message: "Invalid instance format",
    });
  }

  //valida se instance existe no arquivo instances.log
  const filePath = "./app/assets/instances.log";
  const fileContent = fs.readFileSync(filePath, "utf8");
  const instances = fileContent.split("\n").filter(line => line.trim() !== ""); // Remove linhas vazias

  if (!instances.includes(instance)) {
    return res.status(400).json({
      message: "Invalid instance",
    });
  }

  //lê o conteúdo do arquivo data.json correspondente à instância
  const dataFilePath = "./app/assets/data-" + instance + ".json";

  if (!fs.existsSync(dataFilePath)) {
    return res.status(404).json({
      message: "Data not found for the given instance",
    });
  }

  //lê o conteúdo do arquivo data.json (instância informada)
  const dataFileContent = fs.readFileSync(dataFilePath, "utf8");
  var data = JSON.parse(dataFileContent);

  if (isRoot == 1) {

    //le todos arquivos que começam com data- e retorna um objeto com os dados de todas as instâncias
    const allData = {};
    const files = fs.readdirSync("./app/assets");

    files.forEach(file => {
      if (file.startsWith("data-") && file.endsWith(".json")) {
        const instanceName = file.slice(5, -5); // Extrai o nome da instância do nome do arquivo
        const fileContent = fs.readFileSync("./app/assets/" + file, "utf8");
        allData[instanceName] = JSON.parse(fileContent);
      }
    });

    //retorna conteúdo de todas instâncias (somente para root)
    return res.status(200).json(allData);


    //retorna somente da instância informada
  }else{
    return res.status(200).json(data);

  }

};

exports.getEntry = async (req, res) => {
  const { instance, key } = req.body;

  if (!instance || !key) {
    return res.status(400).json({
      message: "Missing required fields",
    });
  }

  //verifica se instance é um uuid válido
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(instance)) {
    return res.status(400).json({
      message: "Invalid instance format",
    });
  }

  //valida se instance existe no arquivo instances.log
  const filePath = "./app/assets/instances.log";
  const fileContent = fs.readFileSync(filePath, "utf8");
  const instances = fileContent.split("\n").filter(line => line.trim() !== ""); // Remove linhas vazias

  if (!instances.includes(instance)) {
    return res.status(400).json({
      message: "Invalid instance",
    });
  }

  //lê o conteúdo do arquivo data.json correspondente à instância
  const dataFilePath = "./app/assets/data-" + instance + ".json";

  //fallback do arquivo de dados não-criado para evitar erros de leitura, caso a instância seja válida mas o arquivo de dados ainda não exista
  if (!fs.existsSync(dataFilePath)) {

    //cria arquivo e retorna vazio, caso não exista
    fs.writeFileSync(dataFilePath, JSON.stringify({}), "utf8");

    return res.status(200).json({
      key,
      value: null,
    });

  }

  //lê o conteúdo do arquivo data.json (instância informada)
  const dataFileContent = fs.readFileSync(dataFilePath, "utf8");
  const data = JSON.parse(dataFileContent);

  //verifica se a chave existe
  if (!(key in data)) {
    return res.status(404).json({
      message: "Key not found",
    });
  }

  return res.status(200).json({
    key,
    value: data[key],
  });
};