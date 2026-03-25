const request = require('supertest');

process.env.SECRET = process.env.SECRET || 'testsecret';
process.env.BASE_URL = process.env.BASE_URL || '/titan-forge/';

const app = require('../server');

describe('Models API suite', () => {
  let instance;
  let token;
  const BASE_URL = process.env.BASE_URL;

  beforeAll(async () => {
    const res = await request(app).get(BASE_URL + 'registerAndConnect');
    instance = res.body.instance;
    token = res.body.token;
  });

  // ── createModel ────────────────────────────────────────────────────────────

  it('should return 401 when token is missing', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setModel/' + instance)
      .send({ modelName: 'user', fields: { name: 'varchar' } });
    expect(res.status).toBe(401);
  });

  it('should create a model successfully', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setModel/' + instance)
      .set('api-key', token)
      .send({
        modelName: 'user',
        fields: {
          name: 'varchar',
          age: 'number',
          active: 'boolean',
          bornDate: 'datebr',
          expiresAt: 'dateus',
          extraData: 'object',
        },
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('Criado/Atualizado');
  });

  it('should update (overwrite) an existing model', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setModel/' + instance)
      .set('api-key', token)
      .send({ modelName: 'user', fields: { email: 'varchar' } });
    expect(res.status).toBe(201);
  });

  it('should return 400 when modelName is missing', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setModel/' + instance)
      .set('api-key', token)
      .send({ fields: { name: 'varchar' } });
    expect(res.status).toBe(400);
  });

  it('should return 400 when fields is missing', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setModel/' + instance)
      .set('api-key', token)
      .send({ modelName: 'user' });
    expect(res.status).toBe(400);
  });

  it('should return 400 when modelName contains invalid characters', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setModel/' + instance)
      .set('api-key', token)
      .send({ modelName: 'my-model!', fields: { name: 'varchar' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/inválido/i);
  });

  it('should return 400 when a field type is invalid', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setModel/' + instance)
      .set('api-key', token)
      .send({ modelName: 'product', fields: { price: 'float' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/tipo de campo inválido/i);
  });

  it('should return 400 for invalid instance UUID', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setModel/not-a-uuid')
      .set('api-key', token)
      .send({ modelName: 'user', fields: { name: 'varchar' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/instância inválido/i);
  });

  it('should return 400 for non-existent instance', async () => {
    const fakeInstance = '00000000-0000-4000-a000-000000000000';
    const res = await request(app)
      .post(BASE_URL + 'setModel/' + fakeInstance)
      .set('api-key', token)
      .send({ modelName: 'user', fields: { name: 'varchar' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/instância inválida/i);
  });

  // ── getAllModels ───────────────────────────────────────────────────────────

  it('should return 401 when token is missing on getAllModels', async () => {
    const res = await request(app).get(BASE_URL + 'getAllModels/' + instance);
    expect(res.status).toBe(401);
  });

  it('should retrieve all models for the instance', async () => {
    const res = await request(app)
      .get(BASE_URL + 'getAllModels/' + instance)
      .set('api-key', token);
    expect(res.status).toBe(200);
    // user model was overwritten to { email: varchar }
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toEqual({ email: 'varchar' });
  });

  it('should return 400 for invalid UUID on getAllModels', async () => {
    const res = await request(app)
      .get(BASE_URL + 'getAllModels/invalid-uuid')
      .set('api-key', token);
    expect(res.status).toBe(400);
  });

  it('should return 400 for non-existent instance on getAllModels', async () => {
    const fakeInstance = '00000000-0000-4000-a000-000000000001';
    const res = await request(app)
      .get(BASE_URL + 'getAllModels/' + fakeInstance)
      .set('api-key', token);
    expect(res.status).toBe(400);
  });
});
