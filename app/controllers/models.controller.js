const { getInstance: getStorageService } = require('../services/storage.service');
const { getInstance: getModelService } = require('../services/model.service');

const storage = getStorageService({ writeDelay: 50 });
const modelService = getModelService({ writeDelay: 50 });

exports.createModel = async (req, res) => {
  try {
    let { instance } = req.params;
    let { fields, modelName } = req.body;

    if (!instance || !fields || typeof fields !== 'object' || !modelName) {
      return res.status(400).json({
        message: "Campos obrigatórios faltando ou fields não é um objeto",
      });
    }

    modelName = modelName.trim().toLowerCase();

    if (!/^[a-z0-9]+$/.test(modelName)) {
      return res.status(400).json({
        message: "Nome do modelo inválido. Deve conter apenas letras e números.",
      });
    }

    if (typeof fields === 'string') {
      try {
        fields = JSON.parse(fields);
      } catch (err) {
        // mantém a string original
      }
    }

    if (!storage.isValidUUID(instance)) {
      return res.status(400).json({
        message: "Formato de instância inválido",
      });
    }

    if (!await storage.hasInstance(instance)) {
      return res.status(400).json({
        message: "Instância inválida",
      });
    }

    let accetableTypes = ['varchar', 'number', 'boolean', 'object', 'datebr', 'dateus', 'uuid'];

    //fields deve ser um objeto, percorra os atributos dele
    for (const [fieldName, fieldType] of Object.entries(fields)) {
      if (typeof fieldName !== 'string' || typeof fieldType !== 'string') {
        return res.status(400).json({
          message: "Todos os nomes de campos e tipos devem ser strings",
        });
      }

      if (!/^[a-z0-9]+$/.test(fieldName.trim().toLowerCase()) || !/^[a-z0-9]+$/.test(fieldType.trim().toLowerCase())) {
        return res.status(400).json({
          message: "Nomes de campos e tipos inválidos. Devem conter apenas letras e números.",
        });
      }

      //valide aqui
      if (!accetableTypes.includes(fieldType.trim().toLowerCase())) {
        return res.status(400).json({
          message: `Tipo de campo inválido. informado -> ${fieldType} / Tipos aceitos -> varchar, number, boolean, object, dateBR, dateUS, uuid`,
        });
      }
    }

    await modelService.createModel(instance, modelName, fields);

    return res.status(201).json({
      status: "Criado/Atualizado",
    });
  } catch (error) {
    console.error('Erro createModel:', error);
    return res.status(500).json({
      message: "Erro interno do servidor"
    });
  }
};

exports.getAllModels = async (req, res) => {
  try {
    let { instance } = req.params;

    if (!instance) {
      return res.status(400).json({
        message: "Campos obrigatórios faltando",
      });
    }

    if (!storage.isValidUUID(instance)) {
      return res.status(400).json({
        message: "Formato de instância inválido",
      });
    }

    if (!await storage.hasInstance(instance)) {
      return res.status(400).json({
        message: "Instância inválida",
      });
    }

    const models = await modelService.getAllModels(instance);

    return res.status(200).json(models);
  } catch (error) {
    console.error('Erro getAllModels:', error);
    return res.status(500).json({
      message: "Erro interno do servidor"
    });
  }
};
