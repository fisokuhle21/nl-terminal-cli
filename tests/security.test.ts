import { describe, it } from 'node:test';
import assert from 'node:assert';
import { replacePlaceholders } from '../src/matcher.js';
import { getShell, getPlatform } from '../src/utils.js';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const isBun = typeof process.versions.bun !== 'undefined';
const isDist = __filename.includes('dist/') || __filename.includes('dist\\');

if (!isBun || !isDist) {
describe('Security Tests', () => {
  describe('Command Injection Prevention', () => {
    it('should escape semicolons in values', () => {
      const template = 'rm -rf {folder}';
      const args = { folder: 'foo; rm -rf /' };
      const result = replacePlaceholders(template, args);
      assert.ok(result.includes("'foo; rm -rf /'"));
    });

    it('should escape && operators', () => {
      const template = 'echo {message}';
      const args = { message: 'hello && rm -rf /' };
      const result = replacePlaceholders(template, args);
      assert.ok(result.includes("'hello && rm -rf /'"));
    });

    it('should escape pipe operators', () => {
      const template = 'cat {file}';
      const args = { file: 'file.txt | rm -rf /' };
      const result = replacePlaceholders(template, args);
      assert.ok(result.includes("'file.txt | rm -rf /'"));
    });

    it('should escape backticks', () => {
      const template = 'echo {text}';
      const args = { text: '`rm -rf /`' };
      const result = replacePlaceholders(template, args);
      assert.ok(result.includes("'`rm -rf /`'"));
    });

    it('should escape $() command substitution', () => {
      const template = 'echo {cmd}';
      const args = { cmd: '$(rm -rf /)' };
      const result = replacePlaceholders(template, args);
      assert.ok(result.includes("'$(rm -rf /)'"));
    });

    it('should escape newlines in values', () => {
      const template = 'echo {message}';
      const args = { message: 'hello\nrm -rf /' };
      const result = replacePlaceholders(template, args);
      assert.ok(result.includes("'hello\nrm -rf /'"));
    });

    it('should escape double quotes in values', () => {
      const template = 'echo {message}';
      const args = { message: 'hello "world"' };
      const result = replacePlaceholders(template, args);
      assert.ok(result.includes("'hello \"world\"'"));
    });
  });

  describe('Cross-Platform Support', () => {
    it('should detect platform correctly', () => {
      const platform = getPlatform();
      assert.ok(['linux', 'mac', 'windows', 'unknown'].includes(platform));
    });

    it('should return correct shell for platform', () => {
      const shell = getShell();
      assert.ok('shell' in shell);
      assert.ok('args' in shell);
      assert.ok(Array.isArray(shell.args));
      
      if (process.platform === 'win32') {
        assert.ok(/cmd|powershell/i.test(shell.shell));
      } else {
        assert.ok(/bash|sh|zsh/.test(shell.shell));
      }
    });
  });
});
}

