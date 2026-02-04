import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = process.cwd();
const distCli = path.join(rootDir, 'dist', 'src', 'cli.js');

const isBun = typeof process.versions.bun !== 'undefined';
const isDist = __filename.includes('dist/') || __filename.includes('dist\\');

if (!isBun || !isDist) {

async function runCli(args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('node', [distCli, ...args], {
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

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

describe('CLI integration', () => {
  let tempDir = '';
  let originalHome = '';

  before(async () => {
    originalHome = process.env.HOME || '';
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nl-terminal-cli-test-'));
    process.env.HOME = tempDir;
  });

  after(async () => {
    if (originalHome) {
      process.env.HOME = originalHome;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('runs a dry-run command without prompting', async () => {
    const result = await runCli(['run', 'list all files', '--dry-run', '--yes', '--no-color'], tempDir);
    if (result.code !== 0) {
      throw new Error(`CLI exited with code ${result.code}. stderr: ${result.stderr}`);
    }
    assert.ok(result.stdout.includes('[dry-run]'));
  });
});
}

