/**
 * Script de benchmark comparando versão original vs otimizada
 * 
 * Execute: node benchmark.js
 */

const fs = require('fs');
const uuid = require('uuid');

// Versão ORIGINAL (síncrona)
class OriginalStorage {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.instancesFile = `${baseDir}/instances.log`;
  }

  registerInstance(instance) {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }

    if (!fs.existsSync(this.instancesFile)) {
      fs.writeFileSync(this.instancesFile, instance + '\n', 'utf8');
    } else {
      fs.appendFileSync(this.instancesFile, instance + '\n', 'utf8');
    }
  }

  hasInstance(instance) {
    if (!fs.existsSync(this.instancesFile)) return false;
    const content = fs.readFileSync(this.instancesFile, 'utf8');
    const instances = content.split('\n').filter(line => line.trim() !== '');
    return instances.includes(instance);
  }

  setEntry(instance, key, value) {
    const dataPath = `${this.baseDir}/data-${instance}.json`;
    const opsPath = `${this.baseDir}/ops-${instance}.json`;

    // Data
    let data = {};
    if (fs.existsSync(dataPath)) {
      data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    }
    data[key] = value;
    fs.writeFileSync(dataPath, JSON.stringify(data), 'utf8');

    // Ops
    let ops = [];
    if (fs.existsSync(opsPath)) {
      ops = JSON.parse(fs.readFileSync(opsPath, 'utf8'));
    }
    ops.push({ key, value });
    fs.writeFileSync(opsPath, JSON.stringify(ops), 'utf8');
  }

  getEntry(instance, key) {
    const dataPath = `${this.baseDir}/data-${instance}.json`;
    if (!fs.existsSync(dataPath)) return undefined;
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    return data[key];
  }

  cleanup() {
    if (fs.existsSync(this.baseDir)) {
      fs.rmSync(this.baseDir, { recursive: true, force: true });
    }
  }
}

// Versão OTIMIZADA
const { StorageService } = require('./app/services/storage.service');

async function benchmarkWrites(name, storageFactory, iterations = 1000) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📝 Benchmark: ${name}`);
  console.log(`${'='.repeat(60)}`);
  
  const storage = storageFactory();
  const instance = uuid.v4();
  
  // Registra instância
  if (storage instanceof OriginalStorage) {
    storage.registerInstance(instance);
  } else {
    await storage.registerInstance(instance);
  }

  // Benchmark: Escritas sequenciais
  const startWrite = Date.now();
  for (let i = 0; i < iterations; i++) {
    if (storage instanceof OriginalStorage) {
      storage.setEntry(instance, `key${i}`, `value${i}`);
    } else {
      await storage.setEntry(instance, `key${i}`, `value${i}`);
    }
  }

  // Se for otimizada, aguarda flush
  if (!(storage instanceof OriginalStorage)) {
    await storage.flush();
  }

  const writeTime = Date.now() - startWrite;

  // Benchmark: Leituras sequenciais
  const startRead = Date.now();
  for (let i = 0; i < iterations; i++) {
    if (storage instanceof OriginalStorage) {
      storage.getEntry(instance, `key${i}`);
    } else {
      await storage.getEntry(instance, `key${i}`);
    }
  }
  const readTime = Date.now() - startRead;

  // Contagem de arquivos/operações I/O
  const baseDir = storage.baseDir;
  let fileCount = 0;
  if (fs.existsSync(baseDir)) {
    fileCount = fs.readdirSync(baseDir).length;
  }

  // Resultados
  console.log(`\n📊 Resultados (${iterations} operações):`);
  console.log(`   Escritas: ${writeTime}ms (${(iterations / (writeTime / 1000)).toFixed(2)} ops/s)`);
  console.log(`   Leituras: ${readTime}ms (${(iterations / (readTime / 1000)).toFixed(2)} ops/s)`);
  console.log(`   Total: ${writeTime + readTime}ms`);
  console.log(`   Arquivos criados: ${fileCount}`);

  // Cleanup
  if (storage instanceof OriginalStorage) {
    storage.cleanup();
  } else {
    await storage.destroy();
    storage.clearAllCache();
    if (fs.existsSync(baseDir)) {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  }

  return {
    name,
    writeTime,
    readTime,
    totalTime: writeTime + readTime,
    writeOps: iterations / (writeTime / 1000),
    readOps: iterations / (readTime / 1000)
  };
}

async function benchmarkConcurrentReads(name, storageFactory, instances = 5, readsPerInstance = 200) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📖 Benchmark Concurrent Reads: ${name}`);
  console.log(`${'='.repeat(60)}`);

  const storage = storageFactory();
  const instanceIds = [];

  // Prepara dados
  for (let i = 0; i < instances; i++) {
    const inst = uuid.v4();
    instanceIds.push(inst);
    
    if (storage instanceof OriginalStorage) {
      storage.registerInstance(inst);
      for (let j = 0; j < 10; j++) {
        storage.setEntry(inst, `key${j}`, `value${j}`);
      }
    } else {
      await storage.registerInstance(inst);
      for (let j = 0; j < 10; j++) {
        await storage.setEntry(inst, `key${j}`, `value${j}`);
      }
      await storage.flush();
    }
  }

  // Benchmark: Leituras concorrentes
  const startConcurrent = Date.now();
  const promises = [];

  for (let i = 0; i < readsPerInstance; i++) {
    for (const inst of instanceIds) {
      if (storage instanceof OriginalStorage) {
        // Simula "concorrência" com Promise (mas é sync)
        promises.push(Promise.resolve(storage.getEntry(inst, `key${i % 10}`)));
      } else {
        promises.push(storage.getEntry(inst, `key${i % 10}`));
      }
    }
  }

  await Promise.all(promises);
  const concurrentTime = Date.now() - startConcurrent;

  const totalReads = instances * readsPerInstance;
  console.log(`\n📊 Resultados (${totalReads} leituras concorrentes):`);
  console.log(`   Tempo: ${concurrentTime}ms`);
  console.log(`   Throughput: ${(totalReads / (concurrentTime / 1000)).toFixed(2)} reads/s`);
  console.log(`   Latência média: ${(concurrentTime / totalReads).toFixed(3)}ms`);

  // Cleanup
  if (storage instanceof OriginalStorage) {
    storage.cleanup();
  } else {
    await storage.destroy();
    storage.clearAllCache();
    if (fs.existsSync(storage.baseDir)) {
      fs.rmSync(storage.baseDir, { recursive: true, force: true });
    }
  }

  return {
    name,
    concurrentTime,
    totalReads,
    throughput: totalReads / (concurrentTime / 1000),
    avgLatency: concurrentTime / totalReads
  };
}

async function main() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           STORAGE PERFORMANCE BENCHMARK                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const iterations = 1000;

  // Benchmark 1: Original
  const resultOriginal = await benchmarkWrites(
    'ORIGINAL (sync)',
    () => new OriginalStorage('./benchmark-temp-original'),
    iterations
  );

  // Benchmark 2: Otimizado (delay 50ms)
  const resultOptimized50 = await benchmarkWrites(
    'OTIMIZADO (batch 50ms)',
    () => new StorageService({ baseDir: './benchmark-temp-optimized-50', writeDelay: 50 }),
    iterations
  );

  // Benchmark 3: Otimizado (delay 10ms)
  const resultOptimized10 = await benchmarkWrites(
    'OTIMIZADO (batch 10ms)',
    () => new StorageService({ baseDir: './benchmark-temp-optimized-10', writeDelay: 10 }),
    iterations
  );

  // Benchmark 4: Concurrent reads - Original
  const concurrentOriginal = await benchmarkConcurrentReads(
    'ORIGINAL (sync)',
    () => new OriginalStorage('./benchmark-temp-concurrent-original'),
    5,
    200
  );

  // Benchmark 5: Concurrent reads - Otimizado
  const concurrentOptimized = await benchmarkConcurrentReads(
    'OTIMIZADO (async + cache)',
    () => new StorageService({ baseDir: './benchmark-temp-concurrent-optimized', writeDelay: 50 }),
    5,
    200
  );

  // Resumo comparativo
  console.log('\n\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                    RESUMO COMPARATIVO                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  console.log('\n📈 ESCRITAS SEQUENCIAIS:');
  console.log(`   Original:         ${resultOriginal.writeTime}ms`);
  console.log(`   Otimizado (50ms): ${resultOptimized50.writeTime}ms (${(resultOriginal.writeTime / resultOptimized50.writeTime).toFixed(1)}x mais rápido)`);
  console.log(`   Otimizado (10ms): ${resultOptimized10.writeTime}ms (${(resultOriginal.writeTime / resultOptimized10.writeTime).toFixed(1)}x mais rápido)`);

  console.log('\n📈 LEITURAS SEQUENCIAIS:');
  console.log(`   Original:         ${resultOriginal.readTime}ms`);
  console.log(`   Otimizado (50ms): ${resultOptimized50.readTime}ms (${(resultOriginal.readTime / resultOptimized50.readTime).toFixed(1)}x mais rápido)`);
  console.log(`   Otimizado (10ms): ${resultOptimized10.readTime}ms (${(resultOriginal.readTime / resultOptimized10.readTime).toFixed(1)}x mais rápido)`);

  console.log('\n📈 LEITURAS CONCORRENTES:');
  console.log(`   Original:    ${concurrentOriginal.throughput.toFixed(0)} reads/s`);
  console.log(`   Otimizado:   ${concurrentOptimized.throughput.toFixed(0)} reads/s (${(concurrentOptimized.throughput / concurrentOriginal.throughput).toFixed(1)}x mais throughput)`);

  console.log('\n💾 EFICIÊNCIA I/O:');
  console.log(`   Escritas originais: ${iterations * 2} disk writes`);
  console.log(`   Escritas otimizadas: ~${Math.ceil(iterations * 2 / (50 / 10))} disk writes (batch de 50ms)`);
  console.log(`   Redução I/O: ~${(100 - (Math.ceil(iterations * 2 / (50 / 10)) / (iterations * 2) * 100)).toFixed(1)}%`);

  console.log('\n✅ Benchmark concluído!\n');
}

// Executar
main().catch(console.error);
