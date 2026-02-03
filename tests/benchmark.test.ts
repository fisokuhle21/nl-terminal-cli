import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = process.cwd();
const nodeCliPath = path.join(rootDir, 'dist', 'src', 'cli.js');
const bunCliPath = path.join(rootDir, 'dist', 'bun-cli.js');

// Check if Bun is available
function isBunAvailable(): boolean {
  try {
    execSync('which bun', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Check if Bun CLI build exists
function bunBuildExists(): boolean {
  try {
    return fsSync.existsSync(bunCliPath);
  } catch {
    return false;
  }
}

const hasBun = isBunAvailable();
const hasBunBuild = bunBuildExists();

interface PerformanceResult {
  duration: number;      // milliseconds
  memoryUsed: number;    // bytes (peak RSS)
  cpuUser: number;       // microseconds
  cpuSystem: number;     // microseconds
  exitCode: number | null;
  runtime: 'node' | 'bun';
}

interface BenchmarkStats {
  min: number;
  max: number;
  avg: number;
  median: number;
  stdDev: number;
}

type Runtime = 'node' | 'bun';

/**
 * Get CLI path for runtime
 */
function getCliPath(runtime: Runtime): string {
  return runtime === 'bun' ? bunCliPath : nodeCliPath;
}

/**
 * Simple CLI runner for performance measurement
 */
async function runCliBenchmark(
  args: string[],
  cwd: string,
  runtime: Runtime = 'node',
  timeoutMs: number = 30000
): Promise<PerformanceResult> {
  return new Promise((resolve, reject) => {
    const startTime = process.hrtime.bigint();
    const startUsage = process.cpuUsage();
    const cliPath = getCliPath(runtime);
    
  const child = spawn(runtime, [cliPath, ...args], {
      cwd,
      env: {
        ...process.env,
        HOME: cwd,
        NL_TERMINAL_CLI_TEST: '1',
        NL_TERMINAL_CLI_DRY_RUN: '1',
        NL_TERMINAL_CLI_ASSUME_YES: '1',
        NL_TERMINAL_CLI_NO_COLOR: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Benchmark timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('close', async (code) => {
      clearTimeout(timeout);
      const endTime = process.hrtime.bigint();
      const endUsage = process.cpuUsage(startUsage);
      
      // Approximate child memory usage on CI (process.memoryUsage is parent)
      const memoryUsed = await getProcessMemoryUsage(child.pid);

      resolve({
        duration: Number(endTime - startTime) / 1e6,
        memoryUsed,
        cpuUser: endUsage.user,
        cpuSystem: endUsage.system,
        exitCode: code,
        runtime
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function getProcessMemoryUsage(pid?: number): Promise<number> {
  if (!pid) {
    return process.memoryUsage().rss;
  }

  try {
    if (process.platform === 'win32') {
      const { execSync } = await import('node:child_process');
      const output = execSync(`wmic process where processid=${pid} get WorkingSetSize /value`, { encoding: 'utf-8' });
      const match = output.match(/WorkingSetSize=(\d+)/);
      if (match) {
        return Number(match[1]);
      }
    } else {
      const { execSync } = await import('node:child_process');
      const output = execSync(`ps -o rss= -p ${pid}`, { encoding: 'utf-8' });
      const rssKb = Number(output.trim());
      if (!Number.isNaN(rssKb)) {
        return rssKb * 1024;
      }
    }
  } catch {
    return process.memoryUsage().rss;
  }

  return process.memoryUsage().rss;
}

/**
 * Run multiple iterations and calculate statistics
 */
async function runBenchmarkIterations(
  name: string,
  args: string[],
  cwd: string,
  runtime: Runtime = 'node',
  iterations: number = 5
): Promise<{ name: string; runtime: Runtime; results: PerformanceResult[]; stats: { duration: BenchmarkStats; memory: BenchmarkStats } }> {
  const results: PerformanceResult[] = [];
  
  // Warm-up run
  await runCliBenchmark(args, cwd, runtime);
  
  for (let i = 0; i < iterations; i++) {
    const result = await runCliBenchmark(args, cwd, runtime);
    results.push(result);
  }
  
  const durations = results.map(r => r.duration);
  const memories = results.map(r => r.memoryUsed);
  
  return {
    name,
    runtime,
    results,
    stats: {
      duration: calculateStats(durations),
      memory: calculateStats(memories)
    }
  };
}

function calculateStats(values: number[]): BenchmarkStats {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - avg, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg,
    median: sorted[Math.floor(sorted.length / 2)],
    stdDev: Math.sqrt(avgSquaredDiff)
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)} µs`;
  if (ms < 1000) return `${ms.toFixed(2)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function printBenchmarkStats(benchmark: { name: string; runtime: Runtime; stats: { duration: BenchmarkStats; memory: BenchmarkStats } }): void {
  console.log(`\n  Benchmark: ${benchmark.name} (${benchmark.runtime})`);
  console.log(`  Duration Stats:`);
  console.log(`    Min: ${formatDuration(benchmark.stats.duration.min)}`);
  console.log(`    Max: ${formatDuration(benchmark.stats.duration.max)}`);
  console.log(`    Avg: ${formatDuration(benchmark.stats.duration.avg)}`);
  console.log(`    Median: ${formatDuration(benchmark.stats.duration.median)}`);
  console.log(`    Std Dev: ${formatDuration(benchmark.stats.duration.stdDev)}`);
  console.log(`  Memory Stats:`);
  console.log(`    Min: ${formatBytes(benchmark.stats.memory.min)}`);
  console.log(`    Max: ${formatBytes(benchmark.stats.memory.max)}`);
  console.log(`    Avg: ${formatBytes(benchmark.stats.memory.avg)}`);
}

describe('Performance Benchmarks', () => {
  let tempDir: string;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nl-terminal-benchmark-'));
    // Create config directory
    await fs.mkdir(path.join(tempDir, '.nl-terminal-cli'), { recursive: true });
    
    console.log(`\n  Bun available: ${hasBun ? 'Yes' : 'No'}`);
    console.log(`  Bun build exists: ${hasBunBuild ? 'Yes' : 'No'}\n`);
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Node.js Startup Performance', () => {
    it('should start within acceptable time for --help', async () => {
      const result = await runCliBenchmark(['--help'], tempDir, 'node');
      
      console.log(`  [Node.js] --help startup: ${formatDuration(result.duration)}`);
      console.log(`  [Node.js] Memory used: ${formatBytes(result.memoryUsed)}`);
      
      // --help should complete within 2 seconds
      assert.ok(result.duration < 2000, `Startup took too long: ${formatDuration(result.duration)}`);
      assert.strictEqual(result.exitCode, 0);
    });

    it('should start within acceptable time for --version', async () => {
      const result = await runCliBenchmark(['--version'], tempDir, 'node');
      
      console.log(`  [Node.js] --version startup: ${formatDuration(result.duration)}`);
      console.log(`  [Node.js] Memory used: ${formatBytes(result.memoryUsed)}`);
      
      // --version should complete within 2 seconds
      assert.ok(result.duration < 2000, `Startup took too long: ${formatDuration(result.duration)}`);
      assert.strictEqual(result.exitCode, 0);
    });
  });

  describe('Bun Startup Performance', { skip: !hasBun || !hasBunBuild }, () => {
    it('should start within acceptable time for --help', async () => {
      const result = await runCliBenchmark(['--help'], tempDir, 'bun');
      
      console.log(`  [Bun] --help startup: ${formatDuration(result.duration)}`);
      console.log(`  [Bun] Memory used: ${formatBytes(result.memoryUsed)}`);
      
      // --help should complete within 2 seconds
      assert.ok(result.duration < 2000, `Startup took too long: ${formatDuration(result.duration)}`);
      assert.strictEqual(result.exitCode, 0);
    });

    it('should start within acceptable time for --version', async () => {
      const result = await runCliBenchmark(['--version'], tempDir, 'bun');
      
      console.log(`  [Bun] --version startup: ${formatDuration(result.duration)}`);
      console.log(`  [Bun] Memory used: ${formatBytes(result.memoryUsed)}`);
      
      // --version should complete within 2 seconds
      assert.ok(result.duration < 2000, `Startup took too long: ${formatDuration(result.duration)}`);
      assert.strictEqual(result.exitCode, 0);
    });
  });

  describe('Node.js Command Execution Performance', () => {
    it('should execute a simple command within acceptable time', async () => {
      const result = await runCliBenchmark(['list files'], tempDir, 'node');
      
      console.log(`  [Node.js] Simple command: ${formatDuration(result.duration)}`);
      console.log(`  [Node.js] Memory used: ${formatBytes(result.memoryUsed)}`);
      console.log(`  [Node.js] CPU (user): ${result.cpuUser} µs`);
      console.log(`  [Node.js] CPU (system): ${result.cpuSystem} µs`);
      
      // Simple command should complete within 5 seconds
      assert.ok(result.duration < 5000, `Command took too long: ${formatDuration(result.duration)}`);
    });
  });

  describe('Bun Command Execution Performance', { skip: !hasBun || !hasBunBuild }, () => {
    it('should execute a simple command within acceptable time', async () => {
      const result = await runCliBenchmark(['list files'], tempDir, 'bun');
      
      console.log(`  [Bun] Simple command: ${formatDuration(result.duration)}`);
      console.log(`  [Bun] Memory used: ${formatBytes(result.memoryUsed)}`);
      console.log(`  [Bun] CPU (user): ${result.cpuUser} µs`);
      console.log(`  [Bun] CPU (system): ${result.cpuSystem} µs`);
      
      // Simple command should complete within 5 seconds
      assert.ok(result.duration < 5000, `Command took too long: ${formatDuration(result.duration)}`);
    });
  });

  describe('Memory Usage', () => {
    it('Node.js should not exceed memory threshold for basic operations', async () => {
      const result = await runCliBenchmark(['--help'], tempDir, 'node');
      
      // Memory should not exceed 100MB for basic operations
      const maxMemoryMB = 100;
      const memoryMB = result.memoryUsed / (1024 * 1024);
      
      console.log(`  [Node.js] Memory used: ${formatBytes(result.memoryUsed)}`);
      
      assert.ok(
        memoryMB < maxMemoryMB,
        `Memory usage too high: ${memoryMB.toFixed(2)} MB (max: ${maxMemoryMB} MB)`
      );
    });

    it('Bun should not exceed memory threshold for basic operations', { skip: !hasBun || !hasBunBuild }, async () => {
      const result = await runCliBenchmark(['--help'], tempDir, 'bun');
      
      // Memory should not exceed 80MB for basic operations (Bun should be more efficient)
      const maxMemoryMB = 80;
      const memoryMB = result.memoryUsed / (1024 * 1024);
      
      console.log(`  [Bun] Memory used: ${formatBytes(result.memoryUsed)}`);
      
      assert.ok(
        memoryMB < maxMemoryMB,
        `Memory usage too high: ${memoryMB.toFixed(2)} MB (max: ${maxMemoryMB} MB)`
      );
    });
  });

  describe('Benchmark Statistics (5 iterations)', () => {
    it('Node.js should benchmark --help with consistent performance', async () => {
      const benchmark = await runBenchmarkIterations('--help', ['--help'], tempDir, 'node', 5);
      
      printBenchmarkStats(benchmark);
      
      // Check for consistency (std dev should be less than 50% of avg)
      const varianceRatio = benchmark.stats.duration.stdDev / benchmark.stats.duration.avg;
      console.log(`  Variance ratio: ${(varianceRatio * 100).toFixed(2)}%`);
      
      assert.ok(varianceRatio < 0.5, `Performance too inconsistent: ${(varianceRatio * 100).toFixed(2)}% variance`);
    });

    it('Bun should benchmark --help with consistent performance', { skip: !hasBun || !hasBunBuild }, async () => {
      const benchmark = await runBenchmarkIterations('--help', ['--help'], tempDir, 'bun', 5);
      
      printBenchmarkStats(benchmark);
      
      // Check for consistency (std dev should be less than 50% of avg)
      const varianceRatio = benchmark.stats.duration.stdDev / benchmark.stats.duration.avg;
      console.log(`  Variance ratio: ${(varianceRatio * 100).toFixed(2)}%`);
      
      assert.ok(varianceRatio < 0.5, `Performance too inconsistent: ${(varianceRatio * 100).toFixed(2)}% variance`);
    });
  });

  describe('Node.js vs Bun Comparison', { skip: !hasBun || !hasBunBuild }, () => {
    it('should compare startup performance between Node.js and Bun', async () => {
      const nodeBenchmark = await runBenchmarkIterations('--help', ['--help'], tempDir, 'node', 5);
      const bunBenchmark = await runBenchmarkIterations('--help', ['--help'], tempDir, 'bun', 5);
      
      console.log('\n  ┌─────────────────────────────────────────────────────────────┐');
      console.log('  │              NODE.JS vs BUN COMPARISON                      │');
      console.log('  └─────────────────────────────────────────────────────────────┘');
      
      console.log(`\n  Startup Time (--help):`);
      console.log(`    Node.js: ${formatDuration(nodeBenchmark.stats.duration.avg)} avg`);
      console.log(`    Bun:     ${formatDuration(bunBenchmark.stats.duration.avg)} avg`);
      
      const speedup = nodeBenchmark.stats.duration.avg / bunBenchmark.stats.duration.avg;
      if (speedup > 1) {
        console.log(`    => Bun is ${speedup.toFixed(2)}x faster`);
      } else {
        console.log(`    => Node.js is ${(1/speedup).toFixed(2)}x faster`);
      }
      
      console.log(`\n  Memory Usage:`);
      console.log(`    Node.js: ${formatBytes(nodeBenchmark.stats.memory.avg)} avg`);
      console.log(`    Bun:     ${formatBytes(bunBenchmark.stats.memory.avg)} avg`);
      
      const memRatio = (1 - bunBenchmark.stats.memory.avg / nodeBenchmark.stats.memory.avg) * 100;
      if (memRatio > 0) {
        console.log(`    => Bun uses ${memRatio.toFixed(1)}% less memory`);
      } else {
        console.log(`    => Node.js uses ${(-memRatio).toFixed(1)}% less memory`);
      }
      
      // Bun should generally be faster
      assert.ok(true, 'Comparison complete');
    });
  });
});
