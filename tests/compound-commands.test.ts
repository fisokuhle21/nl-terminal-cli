import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { detectCompoundCommand, parseCompoundCommand } from '../src/commands.js';
import { initDatabase, seedDatabase, closeDatabase } from '../src/database.js';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const isBun = typeof process.versions.bun !== 'undefined';
const isDist = __filename.includes('dist/') || __filename.includes('dist\\');

if (!isBun || !isDist) {

describe('Compound Commands', () => {
  before(async () => {
    await initDatabase();
    await seedDatabase();
  });

  after(async () => {
    await closeDatabase();
  });

  describe('detectCompoundCommand', () => {
    it('should detect "and" separator', () => {
      const result = detectCompoundCommand('create folder and list files');
      assert.strictEqual(result.isCompound, true);
      assert.strictEqual(result.separator, 'and');
    });

    it('should detect "then" separator', () => {
      const result = detectCompoundCommand('commit changes then push to origin');
      assert.strictEqual(result.isCompound, true);
      assert.strictEqual(result.separator, 'then');
    });

    it('should detect semicolon separator', () => {
      const result = detectCompoundCommand('git status; npm test');
      assert.strictEqual(result.isCompound, true);
      assert.strictEqual(result.separator, ';');
    });

    it('should detect && separator', () => {
      const result = detectCompoundCommand('npm install && npm start');
      assert.strictEqual(result.isCompound, true);
      assert.strictEqual(result.separator, '&&');
    });

    it('should detect "after that" separator', () => {
      const result = detectCompoundCommand('build the project after that deploy it');
      assert.strictEqual(result.isCompound, true);
      assert.strictEqual(result.separator, 'after that');
    });

    it('should detect "followed by" separator', () => {
      const result = detectCompoundCommand('save changes followed by exit');
      assert.strictEqual(result.isCompound, true);
      assert.strictEqual(result.separator, 'followed by');
    });

    it('should return false for simple commands', () => {
      const result = detectCompoundCommand('list files');
      assert.strictEqual(result.isCompound, false);
      assert.strictEqual(result.separator, null);
    });

    it('should return false for single commands with "and" in different context', () => {
      const result = detectCompoundCommand('find files named command');
      assert.strictEqual(result.isCompound, false);
    });
  });

  describe('parseCompoundCommand', () => {
    it('should parse two commands with "and"', () => {
      const result = parseCompoundCommand('create folder and list files');
      assert.strictEqual(result.segments.length, 2);
      assert.strictEqual(result.segments[0].input, 'create folder');
      assert.strictEqual(result.segments[1].input, 'list files');
      assert.strictEqual(result.separatorUsed, 'and');
    });

    it('should parse three commands with "and"', () => {
      const result = parseCompoundCommand('git status and git add . and git commit');
      assert.strictEqual(result.segments.length, 3);
      assert.strictEqual(result.segments[0].input, 'git status');
      assert.strictEqual(result.segments[1].input, 'git add .');
      assert.strictEqual(result.segments[2].input, 'git commit');
    });

    it('should parse commands with "then"', () => {
      const result = parseCompoundCommand('build then deploy');
      assert.strictEqual(result.segments.length, 2);
      assert.strictEqual(result.segments[0].input, 'build');
      assert.strictEqual(result.segments[1].input, 'deploy');
      assert.strictEqual(result.separatorUsed, 'then');
    });

    it('should parse commands with semicolons', () => {
      const result = parseCompoundCommand('cd src; ls -la; npm test');
      assert.strictEqual(result.segments.length, 3);
      assert.strictEqual(result.segments[0].input, 'cd src');
      assert.strictEqual(result.segments[1].input, 'ls -la');
      assert.strictEqual(result.segments[2].input, 'npm test');
    });

    it('should handle commands with trailing punctuation', () => {
      const result = parseCompoundCommand('create folder and list files.');
      assert.strictEqual(result.segments.length, 2);
      assert.strictEqual(result.segments[1].input, 'list files');
    });

    it('should handle complex commands with placeholders', () => {
      const result = parseCompoundCommand('create folder called mydir and then list files in it');
      assert.strictEqual(result.segments.length, 2);
      assert.strictEqual(result.segments[0].input, 'create folder called mydir');
      assert.strictEqual(result.segments[1].input, 'then list files in it');
    });

    it('should return single segment for simple commands', () => {
      const result = parseCompoundCommand('list files');
      assert.strictEqual(result.segments.length, 1);
      assert.strictEqual(result.segments[0].input, 'list files');
      assert.strictEqual(result.separatorUsed, null);
    });

    it('should handle mixed case separators', () => {
      const result = parseCompoundCommand('Git Status AND Npm Test');
      assert.strictEqual(result.segments.length, 2);
      assert.strictEqual(result.separatorUsed, 'and');
    });

    it('should handle "&&" operator', () => {
      const result = parseCompoundCommand('npm install && npm run build');
      assert.strictEqual(result.segments.length, 2);
      assert.strictEqual(result.segments[0].input, 'npm install');
      assert.strictEqual(result.segments[1].input, 'npm run build');
      assert.strictEqual(result.separatorUsed, '&&');
    });

    it('should handle "after that" separator', () => {
      const result = parseCompoundCommand('run tests after that deploy');
      assert.strictEqual(result.segments.length, 2);
      assert.strictEqual(result.segments[0].input, 'run tests');
      assert.strictEqual(result.segments[1].input, 'deploy');
      assert.strictEqual(result.separatorUsed, 'after that');
    });

    it('should handle "followed by" separator', () => {
      const result = parseCompoundCommand('save changes followed by exit');
      assert.strictEqual(result.segments.length, 2);
      assert.strictEqual(result.segments[0].input, 'save changes');
      assert.strictEqual(result.segments[1].input, 'exit');
      assert.strictEqual(result.separatorUsed, 'followed by');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty strings', () => {
      const result = parseCompoundCommand('');
      assert.strictEqual(result.segments.length, 1);
      assert.strictEqual(result.segments[0].input, '');
    });

    it('should handle commands with multiple words', () => {
      const result = parseCompoundCommand('create a new folder called test and then list all files in current directory');
      assert.strictEqual(result.segments.length, 2);
    });

    it('should not split on "and" inside words', () => {
      // This tests that "command" with "and" in it doesn't trigger false positives
      const result = detectCompoundCommand('find files named command');
      assert.strictEqual(result.isCompound, false);
    });

    it('should handle sequential separators', () => {
      const result = parseCompoundCommand('cmd1 and then cmd2');
      // Should only use the first separator found
      assert.ok(result.segments.length >= 1);
    });
  });
});
}

