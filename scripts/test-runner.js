import { glob } from 'glob';
import { spawn } from 'node:child_process';
import process from 'node:process';

// Find test files in dist/tests
// Using glob ensures cross-platform compatibility (Windows doesn't expand globs in npm scripts)
const pattern = 'dist/tests/*.test.js';

console.log(`Finding test files with pattern: ${pattern}`);

try {
  const files = await glob(pattern, { windowsPathsNoEscape: true });

  if (files.length === 0) {
    console.error('No test files found in dist/tests/');
    console.log('Current directory:', process.cwd());
    process.exit(1);
  }

  console.log(`Found ${files.length} test files.`);

  // Run node --test with the found files
  // This avoids passing globs to node --test which can be problematic on Windows
  const args = ['--test', ...files];
  
  const child = spawn(process.execPath, args, { 
    stdio: 'inherit',
    env: process.env 
  });

  child.on('close', (code) => {
    process.exit(code ?? 1);
  });

  child.on('error', (err) => {
    console.error('Failed to start test process:', err);
    process.exit(1);
  });

} catch (err) {
  console.error('Error finding test files:', err);
  process.exit(1);
}
