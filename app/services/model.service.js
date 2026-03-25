const fsPromises = require('fs').promises;
const path = require('path');
const { getInstance: getOpsService } = require('./operations.service');

class ModelService {
  constructor(options = {}) {
    this.baseDir = options.baseDir || './app/assets';
    this.writeDelay = options.writeDelay || 100;
    this.modelsCache = new Map(); // instance -> models object
    this.writePending = new Map(); // instance -> timeout
    this.syncInProgress = new Set();
  }

  /**
   * Carrega modelos de uma instância no cache
   */
  async loadInstanceModels(instance) {
    if (this.modelsCache.has(instance)) {
      return this.modelsCache.get(instance);
    }

    const modelsFilePath = path.join(this.baseDir, `models-${instance}.json`);

    try {
      const buffer = await fsPromises.readFile(modelsFilePath);
      const models = JSON.parse(buffer.toString('utf8'));
      this.modelsCache.set(instance, models);
      return models;
    } catch (err) {
      if (err.code === 'ENOENT') {
        const models = {};
        this.modelsCache.set(instance, models);
        return models;
      }
      throw err;
    }
  }

  /**
   * Agenda escrita em batch (debounce)
   */
  scheduleSyncInstance(instance) {
    if (this.writePending.has(instance)) {
      clearTimeout(this.writePending.get(instance));
    }

    const timer = setTimeout(() => {
      this.syncInstance(instance);
      this.writePending.delete(instance);
    }, this.writeDelay);

    this.writePending.set(instance, timer);
  }

  /**
   * Sincroniza modelos de uma instância para disco
   */
  async syncInstance(instance) {
    if (this.syncInProgress.has(instance)) {
      this.scheduleSyncInstance(instance);
      return;
    }

    this.syncInProgress.add(instance);

    try {
      if (this.modelsCache.has(instance)) {
        const modelsFilePath = path.join(this.baseDir, `models-${instance}.json`);
        const models = this.modelsCache.get(instance);
        const buffer = Buffer.from(JSON.stringify(models), 'utf8');
        await fsPromises.writeFile(modelsFilePath, buffer);
      }
    } finally {
      this.syncInProgress.delete(instance);
    }
  }

  /**
   * Cria/atualiza um modelo
   */
  async createModel(instance, name, fields) {
    const models = await this.loadInstanceModels(instance);
    models[name] = fields;
    this.modelsCache.set(instance, models);
    this.scheduleSyncInstance(instance);

    // Registra operação no serviço de ops
    await getOpsService().appendOp(instance, { type: 'setModel', modelName: name, fields });

    return true;
  }

  /**
   * Lê um modelo pelo nome
   */
  async getModel(instance, name) {
    const models = await this.loadInstanceModels(instance);
    return models[name];
  }

  /**
   * Retorna todos os modelos de uma instância
   */
  async getAllModels(instance) {
    const models = await this.loadInstanceModels(instance);
    return { ...models };
  }

  /**
   * Remove todos os dados de modelos de uma instância da memória e do disco.
   */
  async purgeInstance(instance) {
    if (this.writePending.has(instance)) {
      clearTimeout(this.writePending.get(instance));
      this.writePending.delete(instance);
    }
    this.modelsCache.delete(instance);
    const modelsFile = path.join(this.baseDir, `models-${instance}.json`);
    await fsPromises.unlink(modelsFile).catch(() => {});
  }

  /**
   * Força sincronização imediata de todos os modelos em cache
   */
  async flush() {
    for (const timer of this.writePending.values()) {
      clearTimeout(timer);
    }
    this.writePending.clear();

    const promises = [];
    for (const instance of this.modelsCache.keys()) {
      promises.push(this.syncInstance(instance));
    }
    await Promise.all(promises);
  }

  /**
   * Destroi o serviço - faz flush final
   */
  async destroy() {
    await this.flush();
  }
}

let instance = null;

function getInstance(options) {
  if (!instance) {
    instance = new ModelService(options);
  }
  return instance;
}

module.exports = {
  ModelService,
  getInstance,
  _resetInstance: () => { instance = null; },
};