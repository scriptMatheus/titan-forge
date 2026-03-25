const fsPromises = require('fs').promises;
const path = require('path');

class DatabaseService {
  constructor(options = {}) {
    this.baseDir = options.baseDir || './app/assets';
    this.writeDelay = options.writeDelay || 100;
    this.recordsCache = new Map(); // `${instance}::${modelName}` -> records array
    this.writePending = new Map(); // cacheKey -> timeout
    this.syncInProgress = new Set();
    this.idIndex = new Map(); // `${instance}::${_id}` -> { modelName, record }
  }

  _cacheKey(instance, modelName) {
    return `${instance}::${modelName}`;
  }

  _filePath(instance, modelName) {
    return path.join(this.baseDir, `db-${instance}-${modelName}.json`);
  }

  /**
   * Carrega registros de um modelo no cache
   */
  async loadRecords(instance, modelName) {
    const key = this._cacheKey(instance, modelName);
    if (this.recordsCache.has(key)) return this.recordsCache.get(key);

    try {
      const buffer = await fsPromises.readFile(this._filePath(instance, modelName));
      const records = JSON.parse(buffer.toString('utf8'));
      this.recordsCache.set(key, records);
      for (const record of records) {
        this.idIndex.set(`${instance}::${record._id}`, { modelName, record });
      }
      return records;
    } catch (err) {
      if (err.code === 'ENOENT') {
        const records = [];
        this.recordsCache.set(key, records);
        return records;
      }
      throw err;
    }
  }

  /**
   * Retorna todos os registros de todos os modelos da instância
   * { modelName: [records...], ... }
   */
  async getAllRecords(instance, modelNames) {
    const result = {};
    for (const modelName of modelNames) {
      result[modelName] = await this.loadRecords(instance, modelName);
    }
    return result;
  }

  /**
   * Busca um registro pelo _id em O(1) via índice em memória.
   * Garante que todos os modelos estejam carregados antes de consultar.
   * @returns {{ record, modelName } | null}
   */
  async getRecordById(instance, id, modelNames) {
    await Promise.all(modelNames.map(m => this.loadRecords(instance, m)));
    return this.idIndex.get(`${instance}::${id}`) ?? null;
  }

  /**
   * @returns {object} registro inserido (com _id e _createdAt)
   */
  async addRecord(instance, modelName, data) {
    const records = await this.loadRecords(instance, modelName);

    const record = {
      _id: require('uuid').v4(),
      ...data,
      _createdAt: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    };

    records.push(record);

    const key = this._cacheKey(instance, modelName);
    this.recordsCache.set(key, records);
    this.idIndex.set(`${instance}::${record._id}`, { modelName, record });
    this.scheduleSyncInstance(key, instance, modelName);

    return record;
  }

  /**
   * Remove um registro pelo _id e atualiza o índice em memória.
   * @returns {boolean} true se encontrado e removido, false se não existia
   */
  async deleteRecord(instance, modelName, id) {
    const records = await this.loadRecords(instance, modelName);
    const idx = records.findIndex(r => r._id === id);
    if (idx === -1) return false;

    records.splice(idx, 1);

    const key = this._cacheKey(instance, modelName);
    this.recordsCache.set(key, records);
    this.idIndex.delete(`${instance}::${id}`);
    this.scheduleSyncInstance(key, instance, modelName);

    return true;
  }

  /**
   * Remove todos os registros de todos os modelos de uma instância da memória e do disco.
   * @param {string} instance
   * @param {string[]} modelNames
   */
  async purgeInstance(instance, modelNames) {
    for (const modelName of modelNames) {
      const key = this._cacheKey(instance, modelName);
      if (this.writePending.has(key)) {
        clearTimeout(this.writePending.get(key));
        this.writePending.delete(key);
      }
      // limpa índice para os registros deste modelo
      const records = this.recordsCache.get(key) || [];
      for (const r of records) {
        this.idIndex.delete(`${instance}::${r._id}`);
      }
      this.recordsCache.delete(key);
      await fsPromises.unlink(this._filePath(instance, modelName)).catch(() => {});
    }
  }

  /**
   * Agenda escrita em batch (debounce)
   */
  scheduleSyncInstance(key, instance, modelName) {
    if (this.writePending.has(key)) clearTimeout(this.writePending.get(key));

    const timer = setTimeout(() => {
      this.syncInstance(key, instance, modelName);
      this.writePending.delete(key);
    }, this.writeDelay);

    this.writePending.set(key, timer);
  }

  /**
   * Sincroniza registros de um modelo para disco
   */
  async syncInstance(key, instance, modelName) {
    if (this.syncInProgress.has(key)) {
      this.scheduleSyncInstance(key, instance, modelName);
      return;
    }

    this.syncInProgress.add(key);

    try {
      if (this.recordsCache.has(key)) {
        const records = this.recordsCache.get(key);
        const buffer = Buffer.from(JSON.stringify(records), 'utf8');
        await fsPromises.writeFile(this._filePath(instance, modelName), buffer);
      }
    } finally {
      this.syncInProgress.delete(key);
    }
  }

  /**
   * Força sincronização imediata de todos os registros em cache
   */
  async flush() {
    for (const timer of this.writePending.values()) clearTimeout(timer);
    this.writePending.clear();

    const promises = [];
    for (const key of this.recordsCache.keys()) {
      const [instance, modelName] = key.split('::');
      promises.push(this.syncInstance(key, instance, modelName));
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
    instance = new DatabaseService(options);
  }
  return instance;
}

module.exports = {
  DatabaseService,
  getInstance,
  _resetInstance: () => { instance = null; },
};
