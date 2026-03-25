/**
 * PERFORMANCE TEST SUITE
 *
 * Mede tempo de resposta (p50, p95, p99, max) e throughput para cada endpoint.
 * Todos os testes são sequenciais (jest --runInBand) para isolar latências.
 *
 * Thresholds:
 *   - operações de escrita simples:  p95 < 200ms
 *   - operações de leitura simples:  p95 < 100ms
 *   - leitura em massa (listAllData): p95 < 300ms
 */

const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

process.env.SECRET = process.env.SECRET || 'testsecret';
process.env.BASE_URL = process.env.BASE_URL || '/titan-forge/';

const app = require('../server');
const BASE_URL = process.env.BASE_URL;

// ── HELPERS ──────────────────────────────────────────────────────────────────

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(timings) {
  const sorted = [...timings].sort((a, b) => a - b);
  const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  return {
    count: sorted.length,
    min:   sorted[0],
    avg:   Math.round(avg),
    p50:   percentile(sorted, 50),
    p95:   percentile(sorted, 95),
    p99:   percentile(sorted, 99),
    max:   sorted[sorted.length - 1],
  };
}

async function time(fn) {
  const start = Date.now();
  const res = await fn();
  return { ms: Date.now() - start, res };
}

async function repeat(n, fn) {
  const timings = [];
  let lastRes;
  for (let i = 0; i < n; i++) {
    const { ms, res } = await time(fn);
    timings.push(ms);
    lastRes = res;
  }
  return { timings, lastRes };
}

function printStats(label, s) {
  console.log(
    `  [${label}]  n=${s.count}  min=${s.min}ms  avg=${s.avg}ms  p50=${s.p50}ms  p95=${s.p95}ms  p99=${s.p99}ms  max=${s.max}ms`
  );
}

// ── FIXTURES ──────────────────────────────────────────────────────────────────

const MODELS = {
  user: {
    username:  'varchar',
    email:     'varchar',
    age:       'number',
    active:    'boolean',
    createdAt: 'datebr',
    expiresAt: 'dateus',
    profileId: 'uuid',
    meta:      'object',
  },
  product: {
    name:      'varchar',
    price:     'number',
    available: 'boolean',
    listedAt:  'datebr',
    updatedAt: 'dateus',
    sku:       'uuid',
    details:   'object',
  },
  order: {
    ref:       'varchar',
    total:     'number',
    paid:      'boolean',
    orderDate: 'datebr',
    dueDate:   'dateus',
    orderId:   'uuid',
    shipping:  'object',
  },
};

function makeRecord(modelName, i) {
  const base = {
    user: {
      username:  `user_${i}`,
      email:     `user${i}@example.com`,
      age:       20 + (i % 60),
      active:    i % 2 === 0,
      createdAt: '01/01/2026',
      expiresAt: '2026-12-31',
      profileId: uuidv4(),
      meta:      { rank: i, tags: ['a', 'b'] },
    },
    product: {
      name:      `Product ${i}`,
      price:     (i * 3.14),
      available: i % 3 !== 0,
      listedAt:  '15/03/2026',
      updatedAt: '2026-03-15',
      sku:       uuidv4(),
      details:   { weight: i * 0.1, category: 'general' },
    },
    order: {
      ref:       `ORD-${String(i).padStart(6, '0')}`,
      total:     i * 9.99,
      paid:      i % 4 !== 0,
      orderDate: '24/03/2026',
      dueDate:   '2026-04-24',
      orderId:   uuidv4(),
      shipping:  { address: `Street ${i}`, city: 'Belo Horizonte' },
    },
  };
  return base[modelName];
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Performance Test Suite', () => {
  // Aumenta timeout global para 5 minutos
  jest.setTimeout(300_000);

  let instance;
  let token;
  const insertedIds = { user: [], product: [], order: [] };

  // Volumes por fase
  const WARM   = 30;
  const SMALL  = 150;
  const MEDIUM = 600;
  const LARGE  = 1500;

  // ── SETUP ──────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    const reg = await request(app).get(BASE_URL + 'registerAndConnect');
    expect(reg.status).toBe(200);
    instance = reg.body.instance;
    token    = reg.body.token;

    // cria todos os modelos
    for (const [modelName, fields] of Object.entries(MODELS)) {
      const res = await request(app)
        .post(`${BASE_URL}setModel/${instance}`)
        .set('api-key', token)
        .send({ modelName, fields });
      expect(res.status).toBe(201);
    }
  });

  // ── 1. WARM-UP ─────────────────────────────────────────────────────────────

  describe('1. Warm-up (n=10 por modelo)', () => {
    for (const modelName of Object.keys(MODELS)) {
      it(`setDataOnModel [${modelName}] warm-up`, async () => {
        const { timings, lastRes } = await repeat(WARM, () =>
          request(app)
            .post(`${BASE_URL}setDataOnModel/${instance}`)
            .set('api-key', token)
            .send({ modelName, data: makeRecord(modelName, 0) })
        );
        expect(lastRes.status).toBe(201);
        const s = stats(timings);
        printStats(`warm-up ${modelName}`, s);
        // Guarda o último _id para testes de leitura
        insertedIds[modelName].push(lastRes.body.record._id);
      });
    }
  });

  // ── 2. INSERÇÃO ────────────────────────────────────────────────────────────

  describe('2. setDataOnModel — escrita sequencial', () => {
    it(`[user] ${SMALL} inserções`, async () => {
      const timings = [];
      for (let i = 0; i < SMALL; i++) {
        const { ms, res } = await time(() =>
          request(app)
            .post(`${BASE_URL}setDataOnModel/${instance}`)
            .set('api-key', token)
            .send({ modelName: 'user', data: makeRecord('user', i) })
        );
        expect(res.status).toBe(201);
        insertedIds.user.push(res.body.record._id);
        timings.push(ms);
      }
      const s = stats(timings);
      printStats(`setDataOnModel user n=${SMALL}`, s);
      expect(s.p95).toBeLessThan(200);
    });

    it(`[product] ${MEDIUM} inserções`, async () => {
      const timings = [];
      for (let i = 0; i < MEDIUM; i++) {
        const { ms, res } = await time(() =>
          request(app)
            .post(`${BASE_URL}setDataOnModel/${instance}`)
            .set('api-key', token)
            .send({ modelName: 'product', data: makeRecord('product', i) })
        );
        expect(res.status).toBe(201);
        insertedIds.product.push(res.body.record._id);
        timings.push(ms);
      }
      const s = stats(timings);
      printStats(`setDataOnModel product n=${MEDIUM}`, s);
      expect(s.p95).toBeLessThan(200);
    });

    it(`[order] ${LARGE} inserções`, async () => {
      const timings = [];
      for (let i = 0; i < LARGE; i++) {
        const { ms, res } = await time(() =>
          request(app)
            .post(`${BASE_URL}setDataOnModel/${instance}`)
            .set('api-key', token)
            .send({ modelName: 'order', data: makeRecord('order', i) })
        );
        expect(res.status).toBe(201);
        insertedIds.order.push(res.body.record._id);
        timings.push(ms);
      }
      const s = stats(timings);
      printStats(`setDataOnModel order n=${LARGE}`, s);
      expect(s.p95).toBeLessThan(200);
    });
  });

  // ── 3. LEITURA POR ID ──────────────────────────────────────────────────────

  describe('3. listDataFromUniqueId — leitura por _id', () => {
    it(`[user] ${SMALL} leituras por _id`, async () => {
      const ids = insertedIds.user.slice(0, SMALL);
      const timings = [];
      for (const id of ids) {
        const { ms, res } = await time(() =>
          request(app)
            .get(`${BASE_URL}listDataFromUniqueId/${instance}/${id}`)
            .set('api-key', token)
        );
        expect(res.status).toBe(200);
        expect(res.body.record._id).toBe(id);
        timings.push(ms);
      }
      const s = stats(timings);
      printStats(`listDataFromUniqueId user n=${SMALL}`, s);
      expect(s.p95).toBeLessThan(100);
    });

    it(`[product] ${MEDIUM} leituras por _id`, async () => {
      const ids = insertedIds.product.slice(0, MEDIUM);
      const timings = [];
      for (const id of ids) {
        const { ms, res } = await time(() =>
          request(app)
            .get(`${BASE_URL}listDataFromUniqueId/${instance}/${id}`)
            .set('api-key', token)
        );
        expect(res.status).toBe(200);
        timings.push(ms);
      }
      const s = stats(timings);
      printStats(`listDataFromUniqueId product n=${MEDIUM}`, s);
      expect(s.p95).toBeLessThan(100);
    });

    it(`[order] ${LARGE} leituras por _id (varredura em conjunto grande)`, async () => {
      // pega os últimos IDs inseridos para testar varredura longa no array
      const ids = insertedIds.order.slice(-Math.min(LARGE, insertedIds.order.length));
      const timings = [];
      for (const id of ids) {
        const { ms, res } = await time(() =>
          request(app)
            .get(`${BASE_URL}listDataFromUniqueId/${instance}/${id}`)
            .set('api-key', token)
        );
        expect(res.status).toBe(200);
        timings.push(ms);
      }
      const s = stats(timings);
      printStats(`listDataFromUniqueId order n=${ids.length}`, s);
      expect(s.p95).toBeLessThan(100);
    });
  });

  // ── 4. LEITURA EM MASSA ────────────────────────────────────────────────────

  describe('4. listAllData — leitura completa do database', () => {
    it(`${SMALL} chamadas de listAllData`, async () => {
      const { timings, lastRes } = await repeat(SMALL, () =>
        request(app)
          .get(`${BASE_URL}listAllData/${instance}`)
          .set('api-key', token)
      );
      expect(lastRes.status).toBe(200);
      const s = stats(timings);
      printStats(`listAllData n=${SMALL}`, s);
      // Com volume acumulado, threshold mais tolerante
      expect(s.p95).toBeLessThan(300);
    });
  });

  // ── 5. OPERAÇÕES MISTAS ────────────────────────────────────────────────────

  describe('5. Operações mistas (insert + read intercalados)', () => {
    it(`${MEDIUM} ciclos: insert user → read por id → listAllData`, async () => {
      const insertTimes = [];
      const readByIdTimes = [];
      const listAllTimes = [];

      for (let i = 0; i < MEDIUM; i++) {
        // insert
        const { ms: insMs, res: insRes } = await time(() =>
          request(app)
            .post(`${BASE_URL}setDataOnModel/${instance}`)
            .set('api-key', token)
            .send({ modelName: 'user', data: makeRecord('user', i + 10000) })
        );
        expect(insRes.status).toBe(201);
        insertTimes.push(insMs);
        const newId = insRes.body.record._id;

        // read por id
        const { ms: rMs, res: rRes } = await time(() =>
          request(app)
            .get(`${BASE_URL}listDataFromUniqueId/${instance}/${newId}`)
            .set('api-key', token)
        );
        expect(rRes.status).toBe(200);
        readByIdTimes.push(rMs);

        // listAllData a cada 10 ciclos
        if (i % 10 === 0) {
          const { ms: lMs, res: lRes } = await time(() =>
            request(app)
              .get(`${BASE_URL}listAllData/${instance}`)
              .set('api-key', token)
          );
          expect(lRes.status).toBe(200);
          listAllTimes.push(lMs);
        }
      }

      const si = stats(insertTimes);
      const sr = stats(readByIdTimes);
      const sl = stats(listAllTimes);

      printStats(`mixed insert n=${MEDIUM}`,     si);
      printStats(`mixed readById n=${MEDIUM}`,   sr);
      printStats(`mixed listAll n=${listAllTimes.length}`, sl);

      expect(si.p95).toBeLessThan(200);
      expect(sr.p95).toBeLessThan(100);
      expect(sl.p95).toBeLessThan(300);
    });
  });

  // ── 6. REGISTRO E AUTENTICAÇÃO ─────────────────────────────────────────────

  describe('6. registerAndConnect — latência de registro', () => {
    it(`${SMALL} novos registros de instância`, async () => {
      const { timings } = await repeat(SMALL, () =>
        request(app).get(BASE_URL + 'registerAndConnect')
      );
      const s = stats(timings);
      printStats(`registerAndConnect n=${SMALL}`, s);
      expect(s.p95).toBeLessThan(200);
    });
  });

  // ── 7. setEntry KEY-VALUE ──────────────────────────────────────────────────

  describe('7. setEntry / getEntry — key-value store', () => {
    it(`${LARGE} escritas setEntry`, async () => {
      const timings = [];
      for (let i = 0; i < LARGE; i++) {
        const { ms, res } = await time(() =>
          request(app)
            .post(`${BASE_URL}setEntry`)
            .set('api-key', token)
            .send({ instance, key: `perf_key_${i}`, value: { n: i, label: `val_${i}` } })
        );
        expect(res.status).toBe(201);
        timings.push(ms);
      }
      const s = stats(timings);
      printStats(`setEntry n=${LARGE}`, s);
      expect(s.p95).toBeLessThan(200);
    });

    it(`${SMALL} leituras getEntry`, async () => {
      const timings = [];
      for (let i = 0; i < SMALL; i++) {
        const { ms, res } = await time(() =>
          request(app)
            .post(`${BASE_URL}getEntry`)
            .set('api-key', token)
            .send({ instance, key: `perf_key_${i}` })
        );
        expect(res.status).toBe(200);
        timings.push(ms);
      }
      const s = stats(timings);
      printStats(`getEntry n=${SMALL}`, s);
      expect(s.p95).toBeLessThan(100);
    });
  });

  // ── 8. SUMÁRIO FINAL ───────────────────────────────────────────────────────

  afterAll(async () => {
    const { getInstance: getStorageService } = require('../app/services/storage.service');
    const { getInstance: getModelSvc }       = require('../app/services/model.service');
    const { getInstance: getOpsSvc }         = require('../app/services/operations.service');
    const { getInstance: getDbSvc }          = require('../app/services/database.service');

    const _storage = getStorageService();
    const _model   = getModelSvc();
    const _ops     = getOpsSvc();
    const _db      = getDbSvc();

    // limpa a instância principal do teste
    if (instance) {
      await Promise.all([
        _storage.purgeInstance(instance),
        _model.purgeInstance(instance),
        _ops.purgeInstance(instance),
        _db.purgeInstance(instance, Object.keys(MODELS)),
      ]);
    }

    // limpa instâncias criadas pelo teste de registerAndConnect
    const allInstances = await _storage.listInstances();
    await Promise.all(allInstances.map(inst => Promise.all([
      _storage.purgeInstance(inst),
      _model.purgeInstance(inst),
      _ops.purgeInstance(inst),
    ])));

    const totalRecords =
      insertedIds.user.length +
      insertedIds.product.length +
      insertedIds.order.length;
    console.log(`\n  ══ SUMÁRIO DE PERFORMANCE ══`);
    console.log(`  Total de registros inseridos no banco: ${totalRecords}`);
    console.log(`  Modelos usados: ${Object.keys(MODELS).join(', ')}`);
    console.log(`  Instância de teste: ${instance || '(não criada)'}`);
    console.log(`  Limpeza concluída.`);
  });
});
