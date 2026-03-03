/**
 * Serviço de storage otimizado de baixo nível
 * - Operações assíncronas
 * - Cache em memória
 * - Batch writes
 * - File descriptors reutilizados
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

class StorageService {
  constructor(options = {}) {
    // allow override via options or environment variable (useful for tests)
    this.baseDir = options.baseDir || './app/assets';
    this.instancesFile = path.join(this.baseDir, 'instances.log');
    
    // Cache em memória
    this.instancesCache = new Set();
    this.dataCache = new Map(); // instance -> data object
    this.opsCache = new Map();  // instance -> operations array
    
    // Controle de escritas em batch
    this.writePending = new Map(); // instance -> timeout
    this.writeDelay = options.writeDelay || 100; // ms
    
    // File descriptors abertos (pool)
    this.fdPool = new Map();
    
    // Flags de sincronização
    this.syncInProgress = new Set();
    
    this.initialized = false;
  }

  /**
   * Inicializa o serviço - carrega instâncias em memória
   */
  async initialize() {
    if (this.initialized) return;
    
    try {
      // Cria diretório se não existir
      await fsPromises.mkdir(this.baseDir, { recursive: true });
      
      // Carrega instâncias existentes
      try {
        const buffer = await fsPromises.readFile(this.instancesFile);
        const content = buffer.toString('utf8');
        const instances = content.split('\n').filter(line => line.trim() !== '');
        instances.forEach(inst => this.instancesCache.add(inst));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        // Arquivo não existe, será criado no primeiro uso
      }
      
      this.initialized = true;
    } catch (error) {
      console.error('Erro ao inicializar StorageService:', error);
      throw error;
    }
  }

  /**
   * Verifica se instância é válida (UUID v4)
   */
  isValidUUID(uuid) {
    const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return regex.test(uuid);
  }

  /**
   * Registra nova instância
   */
  async registerInstance(instance) {
    await this.initialize();
    
    // Verifica se já existe
    if (this.instancesCache.has(instance)) {
      return false; // Já existe
    }
    
    // Adiciona ao cache
    this.instancesCache.add(instance);
    
    // Escreve no arquivo (append usando low-level)
    const buffer = Buffer.from(instance + '\n', 'utf8');
    await fsPromises.appendFile(this.instancesFile, buffer);
    
    return true;
  }

  /**
   * Verifica se instância existe
   */
  async hasInstance(instance) {
    await this.initialize();
    return this.instancesCache.has(instance);
  }

  /**
   * Carrega dados de uma instância no cache
   */
  async loadInstanceData(instance) {
    if (this.dataCache.has(instance)) {
      return this.dataCache.get(instance);
    }
    
    const dataFilePath = path.join(this.baseDir, `data-${instance}.json`);
    
    try {
      // Usa Buffer para leitura mais rápida
      const buffer = await fsPromises.readFile(dataFilePath);
      const data = JSON.parse(buffer.toString('utf8'));
      this.dataCache.set(instance, data);
      return data;
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Arquivo não existe, cria objeto vazio
        const data = {};
        this.dataCache.set(instance, data);
        return data;
      }
      throw err;
    }
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
        const models = [];
        this.modelsCache.set(instance, models);
        return models;
      }
      throw err;
    }
  }

      /**
   * Define/atualiza um model
   */
  async createModel(instance, name, fields ) {
    await this.initialize();
    
    // Carrega dados no cache se necessário
    const models = await this.loadInstanceModels(instance);
    
    // Atualiza em memória
    models[name] = fields;
    this.modelsCache.set(instance, models);
    
    // Agenda escrita em batch
    this.scheduleSyncInstance(instance);
    
    return true;
  }

  /**
   * Lê um modelo
   */
  async getModel(instance, name) {
    await this.initialize();
    
    const models = await this.loadInstanceModels(instance);
    return models[name];
  }
  
  /**
   * Agenda escrita em batch (debounce)
   */
  scheduleSyncInstance(instance) {
    // Cancela timer anterior se existir
    if (this.writePending.has(instance)) {
      clearTimeout(this.writePending.get(instance));
    }
    
    // Agenda nova escrita
    const timer = setTimeout(() => {
      this.syncInstance(instance);
      this.writePending.delete(instance);
    }, this.writeDelay);
    
    this.writePending.set(instance, timer);
  }

  /**
   * Sincroniza dados de uma instância para disco
   */
  async syncInstance(instance) {
    if (this.syncInProgress.has(instance)) {
      // Já está sincronizando, agenda para depois
      this.scheduleSyncInstance(instance);
      return;
    }
    
    this.syncInProgress.add(instance);
    
    try {
      const dataFilePath = path.join(this.baseDir, `data-${instance}.json`);
      const opsFilePath = path.join(this.baseDir, `ops-${instance}.json`);
      
      // Escreve em paralelo (quando possível)
      const promises = [];
      
      if (this.dataCache.has(instance)) {
        const data = this.dataCache.get(instance);
        const jsonString = JSON.stringify(data);
        const buffer = Buffer.from(jsonString, 'utf8');
        promises.push(fsPromises.writeFile(dataFilePath, buffer));
      }
      
      if (this.opsCache.has(instance)) {
        const ops = this.opsCache.get(instance);
        const jsonString = JSON.stringify(ops);
        const buffer = Buffer.from(jsonString, 'utf8');
        promises.push(fsPromises.writeFile(opsFilePath, buffer));
      }
      
      await Promise.all(promises);
    } finally {
      this.syncInProgress.delete(instance);
    }
  }

  /**
   * Define/atualiza uma entrada
   */
  async setEntry(instance, key, value) {
    await this.initialize();
    
    // Carrega dados no cache se necessário
    const data = await this.loadInstanceData(instance);
    const ops = await this.loadInstanceOps(instance);
    
    // Atualiza em memória
    data[key] = value;
    ops.push({ key, value, updatedAt: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) });
    
    // Agenda escrita em batch
    this.scheduleSyncInstance(instance);
    
    return true;
  }

  /**
   * Lê uma entrada
   */
  async getEntry(instance, key) {
    await this.initialize();
    
    const data = await this.loadInstanceData(instance);
    return data[key];
  }

  /**
   * Lê todos dados de uma instância
   */
  async getAllEntries(instance) {
    await this.initialize();
    
    const data = await this.loadInstanceData(instance);
    return { ...data }; // Retorna cópia para evitar mutações
  }

  /**
   * Lê todas instâncias (root)
   */
  async getAllInstancesData() {
    await this.initialize();
    
    const result = {};
    
    // Para cada instância no cache
    for (const instance of this.instancesCache) {
      result[instance] = await this.getAllEntries(instance);
    }
    
    return result;
  }

  /**
   * Lista todas instâncias
   */
  async listInstances() {
    await this.initialize();
    return Array.from(this.instancesCache);
  }

  /**
   * Força sincronização imediata de todas instâncias
   */
  async flush() {
    // Cancela todos timers pendentes
    for (const timer of this.writePending.values()) {
      clearTimeout(timer);
    }
    this.writePending.clear();
    
    // Sincroniza todas instâncias em paralelo
    const promises = [];
    for (const instance of this.dataCache.keys()) {
      promises.push(this.syncInstance(instance));
    }
    
    await Promise.all(promises);
  }

  /**
   * Limpa cache de uma instância específica
   */
  clearCache(instance) {
    this.dataCache.delete(instance);
    this.opsCache.delete(instance);
  }

  /**
   * Limpa todo cache
   */
  clearAllCache() {
    this.dataCache.clear();
    this.opsCache.clear();
  }

  /**
   * Destroi o serviço - fecha conexões e sincroniza
   */
  async destroy() {
    await this.flush();
    
    // Fecha file descriptors
    for (const [path, fd] of this.fdPool) {
      try {
        await fsPromises.close(fd);
      } catch (err) {
        console.error(`Erro ao fechar fd para ${path}:`, err);
      }
    }
    this.fdPool.clear();
  }
}

// Singleton instance
let instance = null;

function getInstance(options) {
  if (!instance) {
    instance = new StorageService(options);
  }
  return instance;
}

module.exports = {
  StorageService,
  getInstance,
  // helper for tests to reset the singleton
  _resetInstance: () => { instance = null; }
};
