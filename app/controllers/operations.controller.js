/**
 * Controller otimizado usando o StorageService de baixo nível
 */

const uuid = require("uuid");
const jwt = require('jsonwebtoken');
const { getInstance } = require('../services/storage.service');

const tokenSecret = process.env.SECRET;
const storage = getInstance({ writeDelay: 50 }); // Batch writes a cada 50ms

function generateToken() {
  return jwt.sign(
    { dateTime: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) },
    tokenSecret,
    { expiresIn: '24h' }
  );
}

exports.registerAndConnect = async (req, res) => {
  try {
    let generatedHash = uuid.v4();
    
    // Garante que o hash é único
    let attempts = 0;
    while (await storage.hasInstance(generatedHash)) {
      generatedHash = uuid.v4();
      
      // Segurança contra loop infinito (improvável)
      if (++attempts > 10) {
        return res.status(500).json({
          message: "Erro ao gerar instância única"
        });
      }
    }
    
    // Registra a instância
    await storage.registerInstance(generatedHash);
    
    const token = generateToken();
    
    return res.status(200).json({
      message: "Registrado e conectado com sucesso",
      hash: generatedHash,
      token: token
    });
  } catch (error) {
    console.error('Erro registerAndConnect:', error);
    return res.status(500).json({
      message: "Erro ao registrar e conectar instância"
    });
  }
};

exports.setEntry = async (req, res) => {
  try {
    let { value, key, instance } = req.body;
    
    if (!instance || value === undefined || !key) {
      return res.status(400).json({
        message: "Campos obrigatórios faltando",
      });
    }
    
    // Valida UUID
    if (!storage.isValidUUID(instance)) {
      return res.status(400).json({
        message: "Formato de instância inválido",
      });
    }
    
    // Valida se instância existe
    if (!await storage.hasInstance(instance)) {
      return res.status(400).json({
        message: "Instância inválida",
      });
    }
    
    // Se value vier como string JSON, desserializa; se for string simples, mantém como está
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch (err) {
        // mantém a string original
      }
    }

    // Define entrada (operação em memória + batch write)
    await storage.setEntry(instance, key, value);
    
    return res.status(201).json({
      status: "Criado/Atualizado",
    });
  } catch (error) {
    console.error('Erro setEntry:', error);
    return res.status(500).json({
      message: "Erro interno do servidor"
    });
  }
};

exports.readAllEntries = async (req, res) => {
  try {
    let { instance } = req.params;
    let { isRoot } = req.query;
    
    if (!instance) {
      return res.status(400).json({
        message: "Campos obrigatórios faltando",
      });
    }
    
    // Processa isRoot
    if (isRoot != undefined && isRoot != null) {
      isRoot = Number(isRoot);
      
      if (isRoot !== 0 && isRoot !== 1) {
        return res.status(400).json({
          message: "Valor de isRoot inválido. Deve ser 0 ou 1.",
        });
      }
    } else {
      isRoot = 0;
    }
    
    // Valida UUID
    if (!storage.isValidUUID(instance)) {
      return res.status(400).json({
        message: "Formato de instância inválido",
      });
    }
    
    // Valida se instância existe
    if (!await storage.hasInstance(instance)) {
      return res.status(400).json({
        message: "Instância inválida",
      });
    }
    
    // Modo root: retorna todos dados
    if (isRoot === 1) {
      const allData = await storage.getAllInstancesData();
      return res.status(200).json(allData);
    }
    
    // Modo normal: retorna apenas instância solicitada
    const data = await storage.getAllEntries(instance);
    
    return res.status(200).json(data);
  } catch (error) {
    console.error('Erro readAllEntries:', error);
    return res.status(500).json({
      message: "Erro interno do servidor"
    });
  }
};

exports.getEntry = async (req, res) => {
  try {
    const { instance, key } = req.body;
    
    if (!instance || !key) {
      return res.status(400).json({
        message: "Campos obrigatórios faltando",
      });
    }
    
    // Valida UUID
    if (!storage.isValidUUID(instance)) {
      return res.status(400).json({
        message: "Formato de instância inválido",
      });
    }
    
    // Valida se instância existe
    if (!await storage.hasInstance(instance)) {
      return res.status(400).json({
        message: "Instância inválida",
      });
    }
    
    // Busca entrada
    const value = await storage.getEntry(instance, key);
    
    if (value === undefined) {
      return res.status(404).json({
        message: "Chave não encontrada",
      });
    }
    
    return res.status(200).json({
      key,
      value,
    });
  } catch (error) {
    console.error('Error in getEntry:', error);
    return res.status(500).json({
      message: "Erro interno do servidor"
    });
  }
};

// Lista todas instâncias registradas
exports.listInstances = async (req, res) => {
  try {
    const instances = await storage.listInstances();
    
    return res.status(200).json({
      total: instances.length,
      instances: instances
    });
  } catch (error) {
    console.error('Erro listInstances:', error);
    return res.status(500).json({
      message: "Erro interno do servidor"
    });
  }
};

// Endpoint adicional para forçar flush (útil para debugging/testes) (salvar no disco imediatamente)
exports.flush = async (req, res) => {
  try {
    await storage.flush();
    return res.status(200).json({
      message: "Todos os dados foram salvos no disco"
    });
  } catch (error) {
    console.error('Erro flush:', error);
    return res.status(500).json({
      message: "Erro interno do servidor"
    });
  }
};

// Graceful shutdown - importante para garantir que dados sejam salvos
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, flushing data...');
  try {
    await storage.flush();
    await storage.destroy();
    console.log('Data flushed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Erro durante shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, flushing data...');
  try {
    await storage.flush();
    await storage.destroy();
    console.log('Data flushed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Erro durante shutdown:', error);
    process.exit(1);
  }
});
