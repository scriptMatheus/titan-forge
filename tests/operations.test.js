const request = require('supertest');
const fs = require('fs');
const path = require('path');
const os = require('os');

// make sure environment variables are set before requiring the app
process.env.SECRET = process.env.SECRET || 'testsecret';
process.env.BASE_URL = process.env.BASE_URL || '/titan-forge/';

const storageModule = require('../app/services/storage.service');

// require the server after env vars
const app = require('../server');

describe('Titan Forge API suite', () => {
  let instance;
  let token;
  const BASE_URL = process.env.BASE_URL;
  const tmpDir = path.join(os.tmpdir(), 'titan-forge-test');

  beforeAll(async () => {
    // force storage singleton reset and point to temp directory
    process.env.STORAGE_DIR = tmpDir;
    storageModule._resetInstance();

    // make sure directory is clean
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    // cleanup temp storage
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should register and connect successfully', async () => {
    const res = await request(app).get(BASE_URL + 'registerAndConnect');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('hash');
    expect(res.body).toHaveProperty('token');

    instance = res.body.hash;
    token = res.body.token;
    expect(typeof instance).toBe('string');
    expect(typeof token).toBe('string');
  });

  it('should return 401 when token is missing for protected route', async () => {
    const res = await request(app).post(BASE_URL + 'setEntry').send({});
    expect(res.status).toBe(401);
  });

  it('should create an entry', async () => {
    const res = await request(app)
      .post(BASE_URL + 'setEntry')
      .set('api-key', token)
      .send({ instance, key: 'foo', value: 'bar' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('Criado/Atualizado');
  });

  it('should retrieve the entry', async () => {
    const res = await request(app)
      .post(BASE_URL + 'getEntry')
      .set('api-key', token)
      .send({ instance, key: 'foo' });

    expect(res.status).toBe(200);
    expect(res.body.key).toBe('foo');
    expect(res.body.value).toBe('bar');
  });

  it('should read all entries for the instance', async () => {
    const res = await request(app)
      .get(BASE_URL + 'readAllEntries/' + instance)
      .set('api-key', token);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('foo', 'bar');
  });

  it('should list instances and include our instance', async () => {
    const res = await request(app)
      .get(BASE_URL + 'listInstances')
      .set('api-key', token);

    expect(res.status).toBe(200);
    expect(res.body.instances).toContain(instance);
  });

  it('should flush data successfully', async () => {
    const res = await request(app)
      .post(BASE_URL + 'flush')
      .set('api-key', token);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/salvos/);
  });
});
