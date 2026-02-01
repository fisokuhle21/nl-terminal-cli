#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { executeCommand, searchFiles, configureMappings, listMappings } from './commands.js';
import { initConfig } from './config.js';

// Export terminal session module for external use
export * from './terminal-session.js';
export * from './history.js';

const program = new Command();

program
  .name('nl-terminal')
  .description('Natural Language Terminal - Execute commands using natural language')
  .version('0.0.1');

program
  .command('exec')
  .alias('e')
  .description('Execute a natural language command')
  .argument('[command]', 'Natural language command to execute')
  .action(async (commandArg) => {
    await executeCommand(commandArg);
  });

program
  .command('search')
  .alias('s')
  .description('Search for files using natural language')
  .argument('[query]', 'Search query in natural language')
  .option('-e, --ext <extensions>', 'File extensions to search (comma-separated)')
  .action(async (query, options) => {
    await searchFiles(query, options);
  });

program
  .command('list')
  .alias('ls')
  .description('List all saved command mappings')
  .action(async () => {
    await listMappings();
  });

program
  .command('config')
  .alias('c')
  .description('Configure command mappings and settings')
  .action(async () => {
    await configureMappings();
  });

program
  .command('init')
  .description('Initialize configuration')
  .action(async () => {
    await initConfig();
    console.log(chalk.green('✓ Configuration initialized'));
  });

// Default action - if no command provided, run exec
if (process.argv.length <= 2) {
  program.action(async () => {
    await executeCommand();
  });
}

program.parse();
