import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createNewSession,
  addToHistory,
  getAllSessions,
  reloadSession
} from '../src/history.js';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const isBun = typeof process.versions.bun !== 'undefined';
const isDist = __filename.includes('dist/') || __filename.includes('dist\\');

if (!isBun || !isDist) {

describe('History integration', () => {
  let tempDir = '';
  let originalHome = '';

  before(async () => {
    originalHome = process.env.HOME || '';
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nl-terminal-cli-history-'));
    process.env.HOME = tempDir;
  });

  after(async () => {
    if (originalHome) {
      process.env.HOME = originalHome;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates a session, saves history, and reloads it', async () => {
    const sessionId = await createNewSession('Integration Session');
    await addToHistory('list files', 'ls -la', true, 0, 'file.txt', undefined, ['test']);

    const sessions = await getAllSessions();
    assert.ok(sessions.length >= 1);

    const reloaded = await reloadSession(sessionId);
    assert.ok(reloaded);
    assert.strictEqual(reloaded?.id, sessionId);
    assert.strictEqual(reloaded?.commands.length, 1);
  });
});
}

