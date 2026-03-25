const request = require('supertest');

process.env.SECRET = process.env.SECRET || 'testsecret';
process.env.BASE_URL = process.env.BASE_URL || '/titan-forge/';

const app = require('../server');

describe('Database API suite', () => {
  let instance;
  let token;
  const BASE_URL = process.env.BASE_URL;

  // Modelo com todos os tipos aceitos (uuid é auto-gerado)
  const MODEL_FIELDS = {
    name:      'varchar',
    age:       'number',
    active:    'boolean',
    bornDate:  'datebr',
    expiresAt: 'dateus',
    extra:     'object',
    recordId:  'uuid',
  };

  const VALID_DATA = {
    name:      'João Silva',
    age:       30,
    active:    true,
    bornDate:  '15/03/1995',
    expiresAt: '2026-12-31',
    extra:     { obs: 'test' },
    recordId:  'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
  };

  beforeAll(async () => {
    // registra instância e cria o modelo necessário
    const reg = await request(app).get(BASE_URL + 'registerAndConnect');
    instance = reg.body.instance;
    token = reg.body.token;

    await request(app)
      .post(BASE_URL + 'setModel/' + instance)
      .set('api-key', token)
      .send({ modelName: 'person', fields: MODEL_FIELDS });
  });

  // ── autenticação ──────────────────────────────────────────────────────────

  it('should return 401 when token is missing', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setDataOnModel/' + instance)
      .send({ modelName: 'person', data: VALID_DATA });
    expect(res.status).toBe(401);
  });

  // ── inserção bem-sucedida ─────────────────────────────────────────────────

  it('should insert a record successfully and return it with _id and _createdAt', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setDataOnModel/' + instance)
      .set('api-key', token)
      .send({ modelName: 'person', data: VALID_DATA });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('Inserido');
    expect(res.body.record).toHaveProperty('_id');
    expect(res.body.record).toHaveProperty('_createdAt');
    expect(res.body.record.name).toBe('João Silva');
    expect(res.body.record.age).toBe(30);
    expect(res.body.record.active).toBe(true);
  });

  it('should accept a valid uuid value for uuid-type fields', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setDataOnModel/' + instance)
      .set('api-key', token)
      .send({ modelName: 'person', data: VALID_DATA });

    expect(res.status).toBe(201);
    expect(res.body.record.recordId).toBe('a1b2c3d4-e5f6-4789-abcd-ef0123456789');
  });

  it('should return 400 when uuid field receives an invalid UUID', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setDataOnModel/' + instance)
      .set('api-key', token)
      .send({ modelName: 'person', data: { ...VALID_DATA, recordId: 'not-a-uuid' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/recordId/i);
  });

  // ── validação de instância ────────────────────────────────────────────────

  it('should return 400 for invalid instance UUID format', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setDataOnModel/not-a-uuid')
      .set('api-key', token)
      .send({ modelName: 'person', data: VALID_DATA });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/formato de instância inválido/i);
  });

  it('should return 400 for non-existent instance', async () => {
    const fakeInstance = '00000000-0000-4000-a000-000000000000';
    const res = await request(app)
      .post(BASE_URL + 'setDataOnModel/' + fakeInstance)
      .set('api-key', token)
      .send({ modelName: 'person', data: VALID_DATA });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/instância inválida/i);
  });

  // ── validação do modelo ───────────────────────────────────────────────────

  it('should return 400 when modelName is missing', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setDataOnModel/' + instance)
      .set('api-key', token)
      .send({ data: VALID_DATA });
    expect(res.status).toBe(400);
  });

  it('should return 400 when data is missing', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setDataOnModel/' + instance)
      .set('api-key', token)
      .send({ modelName: 'person' });
    expect(res.status).toBe(400);
  });

  it('should return 404 when model does not exist', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setDataOnModel/' + instance)
      .set('api-key', token)
      .send({ modelName: 'nonexistent', data: VALID_DATA });
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/não encontrado/i);
  });

  // ── validação de campos extras ────────────────────────────────────────────

  it('should return 400 when data contains fields not defined in model', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setDataOnModel/' + instance)
      .set('api-key', token)
      .send({ modelName: 'person', data: { ...VALID_DATA, ghost: 'field' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/não definidos no modelo/i);
  });

  // ── validação de tipos ────────────────────────────────────────────────────

  it('should return 400 when varchar field receives a number', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setDataOnModel/' + instance)
      .set('api-key', token)
      .send({ modelName: 'person', data: { ...VALID_DATA, name: 123 } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/name/i);
  });

  it('should return 400 when number field receives a string', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setDataOnModel/' + instance)
      .set('api-key', token)
      .send({ modelName: 'person', data: { ...VALID_DATA, age: 'trinta' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/age/i);
  });

  it('should return 400 when boolean field receives a string', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setDataOnModel/' + instance)
      .set('api-key', token)
      .send({ modelName: 'person', data: { ...VALID_DATA, active: 'true' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/active/i);
  });

  it('should return 400 when datebr field has wrong format', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setDataOnModel/' + instance)
      .set('api-key', token)
      .send({ modelName: 'person', data: { ...VALID_DATA, bornDate: '1995-03-15' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/bornDate/i);
  });

  it('should return 400 when dateus field has wrong format', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setDataOnModel/' + instance)
      .set('api-key', token)
      .send({ modelName: 'person', data: { ...VALID_DATA, expiresAt: '31-12-2026' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expiresAt/i);
  });

  it('should return 400 when object field receives an array', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setDataOnModel/' + instance)
      .set('api-key', token)
      .send({ modelName: 'person', data: { ...VALID_DATA, extra: [1, 2, 3] } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/extra/i);
  });

  it('should insert a record with only partial fields provided', async () => {
    const { name: _omit, ...dataWithoutName } = VALID_DATA;
    const res = await request(app)
      .post(BASE_URL + 'setDataOnModel/' + instance)
      .set('api-key', token)
      .send({ modelName: 'person', data: dataWithoutName });
    expect(res.status).toBe(201);
    expect(res.body.record).not.toHaveProperty('name');
  });

  // ── listAllData ────────────────────────────────────────────────────────────

  it('should return 401 when token is missing on listAllData', async () => {
    const res = await request(app).get(BASE_URL + 'listAllData/' + instance);
    expect(res.status).toBe(401);
  });

  it('should list all records grouped by model', async () => {
    const res = await request(app)
      .get(BASE_URL + 'listAllData/' + instance)
      .set('api-key', token);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('person');
    expect(Array.isArray(res.body.person)).toBe(true);
    expect(res.body.person.length).toBeGreaterThan(0);
  });

  it('should return 400 for invalid instance UUID on listAllData', async () => {
    const res = await request(app)
      .get(BASE_URL + 'listAllData/invalid-uuid')
      .set('api-key', token);
    expect(res.status).toBe(400);
  });

  it('should return 400 for non-existent instance on listAllData', async () => {
    const res = await request(app)
      .get(BASE_URL + 'listAllData/00000000-0000-4000-a000-000000000000')
      .set('api-key', token);
    expect(res.status).toBe(400);
  });

  // ── listDataFromUniqueId ───────────────────────────────────────────────────

  it('should return 401 when token is missing on listDataFromUniqueId', async () => {
    const res = await request(app)
      .get(BASE_URL + 'listDataFromUniqueId/' + instance + '/some-id');
    expect(res.status).toBe(401);
  });

  it('should find a record by its _id', async () => {
    // insere um registro e guarda o _id retornado
    const insert = await request(app)
      .post(BASE_URL + 'setDataOnModel/' + instance)
      .set('api-key', token)
      .send({ modelName: 'person', data: VALID_DATA });
    const recordId = insert.body.record._id;

    const res = await request(app)
      .get(BASE_URL + 'listDataFromUniqueId/' + instance + '/' + recordId)
      .set('api-key', token);

    expect(res.status).toBe(200);
    expect(res.body.record._id).toBe(recordId);
    expect(res.body.modelName).toBe('person');
  });

  it('should return 500 when _id is not found', async () => {
    const res = await request(app)
      .get(BASE_URL + 'listDataFromUniqueId/' + instance + '/00000000-0000-4000-a000-000000000000')
      .set('api-key', token);
    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/não encontrado/i);
  });

  it('should return 400 for invalid instance UUID on listDataFromUniqueId', async () => {
    const res = await request(app)
      .get(BASE_URL + 'listDataFromUniqueId/invalid-uuid/some-id')
      .set('api-key', token);
    expect(res.status).toBe(400);
  });
});
