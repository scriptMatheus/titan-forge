const { getInstance: getStorageService } = require('../services/storage.service');
const { getInstance: getModelService } = require('../services/model.service');
const { getInstance: getDatabaseService } = require('../services/database.service');
const { getInstance: getOpsService } = require('../services/operations.service');

const storage = getStorageService({ writeDelay: 50 });
const modelService = getModelService({ writeDelay: 50 });
const databaseService = getDatabaseService({ writeDelay: 50 });

// Validadores por tipo de campo
const typeValidators = {
  varchar:  (v) => typeof v === 'string',
  number:   (v) => typeof v === 'number' && !isNaN(v),
  boolean:  (v) => typeof v === 'boolean',
  object:   (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  datebr:   (v) => typeof v === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(v),
  dateus:   (v) => typeof v === 'string' && (/^\d{2}\/\d{2}\/\d{4}$/.test(v) || /^\d{4}-\d{2}-\d{2}$/.test(v)),
  uuid:     (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v),
};

const typeLabels = {
  varchar: 'string',
  number:  'number',
  boolean: 'boolean',
  object:  'object (não nulo)',
  datebr:  'string DD/MM/YYYY',
  dateus:  'string MM/DD/YYYY ou YYYY-MM-DD',
  uuid:    'UUID v4 válido (string)',
};

exports.listAllData = async (req, res) => {
  try {
    const { instance } = req.params;

    if (!storage.isValidUUID(instance)) {
      return res.status(400).json({ message: "Formato de instância inválido" });
    }

    if (!await storage.hasInstance(instance)) {
      return res.status(400).json({ message: "Instância inválida" });
    }

    const allModels = await modelService.getAllModels(instance);
    const modelNames = Object.keys(allModels);
    const data = await databaseService.getAllRecords(instance, modelNames);

    return res.status(200).json(data);
  } catch (error) {
    console.error('Erro listAllData:', error);
    return res.status(500).json({ message: "Erro interno do servidor" });
  }
};

exports.listDataFromUniqueId = async (req, res) => {
  try {
    const { instance, id } = req.params;

    if (!storage.isValidUUID(instance)) {
      return res.status(400).json({ message: "Formato de instância inválido" });
    }

    if (!await storage.hasInstance(instance)) {
      return res.status(400).json({ message: "Instância inválida" });
    }

    if (!id || typeof id !== 'string') {
        return res.status(400).json({ message: "ID obrigatório e deve ser string" });
    }

    const allModels = await modelService.getAllModels(instance);
    const modelNames = Object.keys(allModels);
    const result = await databaseService.getRecordById(instance, id, modelNames);

    if (!result) {
      return res.status(500).json({ message: `Registro com _id '${id}' não encontrado` });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Erro listDataFromUniqueId:', error);
    return res.status(500).json({ message: "Erro interno do servidor" });
  }
};

// ── BENCHMARK ────────────────────────────────────────────────────────────────

function _stats(label, timings) {
  const total = timings.reduce((a, v) => a + v, 0);
  return {
    label,
    total_ops:        timings.length,
    execution_time_ms: total,
  };
}

/**
 * GET /titan-forge/benchmark/database?n=1000
 *
 * Simula exatamente as mesmas etapas do performance.test.js.
 * O parâmetro `n` é o total de operações distribuídas proporcionalmente:
 *   - 40% escritas de entry (setEntry)
 *   - 40% escritas de database (setDataOnModel)
 *   - 10% leituras por id (getRecordById / getEntry)
 *   - 10% leituras em massa (listAllData / getAllEntries)
 * Modelo e instância temporários são destruídos ao final.
 */
exports.benchmarkDatabase = async (req, res) => {
  const { v4: uuidv4 } = require('uuid');
  const totalN = Math.min(Math.max(parseInt(req.query.n) || 200, 10), 500000);

  // distribuição proporcional
  const nEntryWrite  = Math.round(totalN * 0.40);
  const nDbWrite     = Math.round(totalN * 0.40);
  const nReadById   = Math.round(totalN * 0.10);
  const nListAll     = Math.max(1, Math.round(totalN * 0.10));

  const benchInstance = uuidv4();
  await storage.initialize();
  await storage.registerInstance(benchInstance);

  const dbModels = {
    benchuser:    { username: 'varchar', age: 'number', active: 'boolean', createdAt: 'datebr', profileId: 'uuid', meta: 'object' },
    benchproduct: { name: 'varchar', price: 'number', available: 'boolean', listedAt: 'dateus', sku: 'uuid', details: 'object' },
    benchorder:   { ref: 'varchar', total: 'number', paid: 'boolean', orderDate: 'datebr', dueDate: 'dateus', orderId: 'uuid' },
  };
  const allModelNames = Object.keys(dbModels);

  for (const [modelName, fields] of Object.entries(dbModels)) {
    await modelService.createModel(benchInstance, modelName, fields);
  }

  const steps = [];
  const insertedDbIds  = [];   // { id, modelName }
  const insertedKeys   = [];   // string
  const grandTotal     = { ops: 0, ms: 0 };
  const tBench         = Date.now();

  function record(stepStats) {
    steps.push(stepStats);
    grandTotal.ops += stepStats.total_ops;
    grandTotal.ms  += stepStats.total_ms;
  }

  // ── 1. setEntry ──────────────────────────────────────────────────────────
  {
    const timings = [];
    for (let i = 0; i < nEntryWrite; i++) {
      const key = `bench_key_${i}`;
      const t0 = Date.now();
      await storage.setEntry(benchInstance, key, { n: i, label: `val_${i}` });
      timings.push(Date.now() - t0);
      insertedKeys.push(key);
    }
    record(_stats('setEntry (key-value write)', timings));
  }

  // ── 2. setDataOnModel (database write) ───────────────────────────────────
  const perModel = Math.max(1, Math.floor(nDbWrite / allModelNames.length));
  for (const modelName of allModelNames) {
    const timings = [];
    for (let i = 0; i < perModel; i++) {
      let data;
      if (modelName === 'benchuser') {
        data = { username: `user_${i}`, age: 20 + (i % 60), active: i % 2 === 0, createdAt: '01/01/2026', profileId: uuidv4(), meta: { rank: i } };
      } else if (modelName === 'benchproduct') {
        data = { name: `prod_${i}`, price: i * 1.5, available: i % 3 !== 0, listedAt: '2026-01-01', sku: uuidv4(), details: { weight: i * 0.1 } };
      } else {
        data = { ref: `ORD-${i}`, total: i * 9.99, paid: i % 4 !== 0, orderDate: '24/03/2026', dueDate: '2026-04-24', orderId: uuidv4() };
      }
      const t0 = Date.now();
      const r = await databaseService.addRecord(benchInstance, modelName, data);
      timings.push(Date.now() - t0);
      insertedDbIds.push({ id: r._id, modelName });
    }
    record(_stats(`setDataOnModel [${modelName}] (db write)`, timings));
  }

  // ── 3. getEntry (key-value read by key) ───────────────────────────────────
  {
    const timings = [];
    const keysToRead = insertedKeys.slice(0, Math.min(nReadById, insertedKeys.length));
    for (const key of keysToRead) {
      const t0 = Date.now();
      await storage.getEntry(benchInstance, key);
      timings.push(Date.now() - t0);
    }
    record(_stats('getEntry (key-value read)', timings));
  }

  // ── 4. getRecordById (database read by _id) ───────────────────────────────
  {
    const timings = [];
    const idsToRead = insertedDbIds.slice(0, Math.min(nReadById, insertedDbIds.length));
    for (const { id } of idsToRead) {
      const t0 = Date.now();
      await databaseService.getRecordById(benchInstance, id, allModelNames);
      timings.push(Date.now() - t0);
    }
    record(_stats('getRecordById (db read by _id)', timings));
  }

  // ── 5. getAllEntries (key-value list all) ─────────────────────────────────
  {
    const timings = [];
    for (let i = 0; i < nListAll; i++) {
      const t0 = Date.now();
      await storage.getAllEntries(benchInstance);
      timings.push(Date.now() - t0);
    }
    record(_stats('getAllEntries (key-value list all)', timings));
  }

  // ── 6. getAllRecords (database list all) ──────────────────────────────────
  {
    const timings = [];
    for (let i = 0; i < nListAll; i++) {
      const t0 = Date.now();
      await databaseService.getAllRecords(benchInstance, allModelNames);
      timings.push(Date.now() - t0);
    }
    record(_stats('getAllRecords (db list all)', timings));
  }

  // ── 7. cleanup ────────────────────────────────────────────────────────────
  await Promise.all([
    storage.purgeInstance(benchInstance),
    modelService.purgeInstance(benchInstance),
    getOpsService().purgeInstance(benchInstance),
    databaseService.purgeInstance(benchInstance, allModelNames),
  ]);

  const elapsed = Date.now() - tBench;

  return res.status(200).json({
    overview: {
      requested_n:   totalN,
      total_ops:     grandTotal.ops,
      total_time_ms: elapsed,
      distribution: {
        entry_writes:    nEntryWrite,
        db_writes:       nDbWrite,
        reads_by_id:     nReadById,
        list_all_calls:  nListAll,
      },
    },
    steps,
  });
};

exports.setDataOnModel = async (req, res) => {
  try {
    const { instance } = req.params;
    let { modelName, data } = req.body;

    // ── campos obrigatórios ──────────────────────────────────────────────────
    if (!instance || !modelName || !data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({
        message: "Campos obrigatórios faltando: instance (param), modelName, data (objeto)",
      });
    }

    // ── valida UUID da instância ─────────────────────────────────────────────
    if (!storage.isValidUUID(instance)) {
      return res.status(400).json({ message: "Formato de instância inválido" });
    }

    if (!await storage.hasInstance(instance)) {
      return res.status(400).json({ message: "Instância inválida" });
    }

    // ── valida e normaliza modelName ─────────────────────────────────────────
    modelName = modelName.trim().toLowerCase();

    if (!/^[a-z0-9]+$/.test(modelName)) {
      return res.status(400).json({
        message: "Nome do modelo inválido. Deve conter apenas letras e números.",
      });
    }

    // ── verifica se o modelo existe ──────────────────────────────────────────
    const allModels = await modelService.getAllModels(instance);
    if (!allModels[modelName]) {
      return res.status(404).json({
        message: `Modelo '${modelName}' não encontrado para esta instância`,
      });
    }

    const modelFields = allModels[modelName]; // { fieldName: fieldType, ... }

    // ── rejeita campos extras não definidos no modelo ────────────────────────
    const extraFields = Object.keys(data).filter(k => !(k in modelFields));
    if (extraFields.length > 0) {
      return res.status(400).json({
        message: `Campos não definidos no modelo: ${extraFields.join(', ')}`,
      });
    }

    // ── processa e valida cada campo do modelo ───────────────────────────────
    const processedData = {};

    for (const [fieldName, fieldType] of Object.entries(modelFields)) {
      const normalizedType = fieldType.trim().toLowerCase();

      // campo opcional: ignora se não enviado
      if (!(fieldName in data) || data[fieldName] === undefined || data[fieldName] === null) {
        continue;
      }

      const value = data[fieldName];
      const validator = typeValidators[normalizedType];

      if (!validator || !validator(value)) {
        return res.status(400).json({
          message: `Valor inválido para o campo '${fieldName}'. Tipo esperado: ${typeLabels[normalizedType] || fieldType}. Recebido: ${typeof value}`,
        });
      }

      processedData[fieldName] = value;
    }

    // ── persiste o registro ──────────────────────────────────────────────────
    const record = await databaseService.addRecord(instance, modelName, processedData);

    // registra a operação
    await getOpsService().appendOp(instance, { type: 'setDataOnModel', modelName, recordId: record._id });

    return res.status(201).json({
      status: "Inserido",
      record,
    });
  } catch (error) {
    console.error('Erro setDataOnModel:', error);
    return res.status(500).json({ message: "Erro interno do servidor" });
  }
};
