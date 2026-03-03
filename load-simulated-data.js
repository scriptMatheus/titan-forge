const request = require('supertest');

process.env.SECRET = process.env.SECRET || 'testsecret';
process.env.BASE_URL = process.env.BASE_URL || '/titan-forge/';

const app = require('./server');

const BASE_URL = process.env.BASE_URL;
const TOTAL_OBJECTS = 100;

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function randomArray(size) {
  const arr = [];
  for (let i = 0; i < size; i++) {
    arr.push({
      id: i + 1,
      code: randomString(randomInt(8, 24)),
      score: Math.random() * 100,
      active: Math.random() > 0.5
    });
  }
  return arr;
}

function generatePayload(index) {
  const profileType = index % 3;

  if (profileType === 0) {
    return {
      type: 'small',
      seq: index,
      name: randomString(10),
      enabled: Math.random() > 0.5,
      ts: new Date().toISOString()
    };
  }

  if (profileType === 1) {
    return {
      type: 'medium',
      seq: index,
      meta: {
        owner: randomString(12),
        region: randomString(5),
        tags: [randomString(6), randomString(6), randomString(6)]
      },
      items: randomArray(randomInt(8, 15)),
      note: randomString(randomInt(80, 180))
    };
  }

  return {
    type: 'large',
    seq: index,
    info: {
      customer: {
        id: randomString(16),
        document: randomString(14),
        contacts: {
          email: `${randomString(8).toLowerCase()}@mail.com`,
          phone: `+55${randomInt(10000000000, 99999999999)}`
        }
      },
      address: {
        street: `${randomString(12)} ${randomInt(1, 9999)}`,
        city: randomString(10),
        country: 'BR'
      }
    },
    history: randomArray(randomInt(30, 60)),
    content: randomString(randomInt(500, 1400))
  };
}

async function main() {
  console.log('\n🚀 Iniciando carga simulada (100 objetos)...');

  const registerRes = await request(app).get(BASE_URL + 'registerAndConnect');
  if (registerRes.status !== 200 || !registerRes.body?.token || !registerRes.body?.hash) {
    throw new Error(`Falha no registerAndConnect: status=${registerRes.status}`);
  }

  const token = registerRes.body.token;
  const instance = registerRes.body.hash;

  console.log(`✅ Instância criada: ${instance}`);

  for (let i = 1; i <= TOTAL_OBJECTS; i++) {
    const key = `sim-object-${i}`;
    const payload = generatePayload(i);
    const payloadSize = JSON.stringify(payload).length;

    const insertRes = await request(app)
      .post(BASE_URL + 'setEntry')
      .set('api-key', token)
      .send({ instance, key, value: payload });

    console.log(`[${i}/${TOTAL_OBJECTS}] INSERT key=${key} size=${payloadSize}B status=${insertRes.status}`);

    if (insertRes.status !== 201) {
      console.log(`❌ Falha no INSERT de ${key}:`, insertRes.body);
      continue;
    }

    const readRes = await request(app)
      .post(BASE_URL + 'getEntry')
      .set('api-key', token)
      .send({ instance, key });

    const readSize = JSON.stringify(readRes.body?.value ?? null).length;
    const isEqual = JSON.stringify(readRes.body?.value) === JSON.stringify(payload);

    console.log(
      `[${i}/${TOTAL_OBJECTS}] READ   key=${key} size=${readSize}B status=${readRes.status} match=${isEqual}`
    );
  }

  const flushRes = await request(app)
    .post(BASE_URL + 'flush')
    .set('api-key', token);

  console.log(`\n💾 Flush final status=${flushRes.status}`);
  console.log('🏁 Carga concluída.');
}

main().catch((error) => {
  console.error('Erro na carga simulada:', error.message);
  process.exit(1);
});
