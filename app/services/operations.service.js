const fsPromises = require('fs').promises;
const path = require('path');

class OperationsService {
  constructor(options = {}) {
    this.baseDir = options.baseDir || './app/assets';
    this.writeDelay = options.writeDelay || 100;
    this.opsCache = new Map();       // instance -> ops array
    this.writePending = new Map();   // instance -> timeout
    this.syncInProgress = new Set();
  }

  /**
   * Carrega operações de uma instância no cache
   */
  async loadInstanceOps(instance) {
    if (this.opsCache.has(instance)) {
      return this.opsCache.get(instance);
    }

    const opsFilePath = path.join(this.baseDir, `ops-${instance}.json`);

    try {
      const buffer = await fsPromises.readFile(opsFilePath);
      const ops = JSON.parse(buffer.toString('utf8'));
      this.opsCache.set(instance, ops);
      return ops;
    } catch (err) {
      if (err.code === 'ENOENT') {
        const ops = [];
        this.opsCache.set(instance, ops);
        return ops;
      }
      throw err;
    }
  }

  /**
   * Registra uma operação no arquivo ops da instância
   * @param {string} instance - UUID da instância
   * @param {object} op - Objeto de operação (type, + campos específicos)
   */
  async appendOp(instance, op) {
    const ops = await this.loadInstanceOps(instance);
    ops.push({
      ...op,
      recordedAt: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    });
    this.opsCache.set(instance, ops);
    this.scheduleSyncInstance(instance);
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
   * Sincroniza ops de uma instância para disco
   */
  async syncInstance(instance) {
    if (this.syncInProgress.has(instance)) {
      this.scheduleSyncInstance(instance);
      return;
    }

    this.syncInProgress.add(instance);

    try {
      if (this.opsCache.has(instance)) {
        const opsFilePath = path.join(this.baseDir, `ops-${instance}.json`);
        const ops = this.opsCache.get(instance);
        const buffer = Buffer.from(JSON.stringify(ops), 'utf8');
        await fsPromises.writeFile(opsFilePath, buffer);
      }
    } finally {
      this.syncInProgress.delete(instance);
    }
  }

  /**
   * Remove todas as ops de uma instância da memória e do disco.
   */
  async purgeInstance(instance) {
    if (this.writePending.has(instance)) {
      clearTimeout(this.writePending.get(instance));
      this.writePending.delete(instance);
    }
    this.opsCache.delete(instance);
    const opsFile = path.join(this.baseDir, `ops-${instance}.json`);
    await fsPromises.unlink(opsFile).catch(() => {});
  }

  /**
   * Força sincronização imediata de todas as ops em cache
   */
  async flush() {
    for (const timer of this.writePending.values()) {
      clearTimeout(timer);
    }
    this.writePending.clear();

    const promises = [];
    for (const instance of this.opsCache.keys()) {
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
    instance = new OperationsService(options);
  }
  return instance;
}

module.exports = {
  OperationsService,
  getInstance,
  _resetInstance: () => { instance = null; },
};
