#!/usr/bin/env node

import { program } from 'commander';
import { 
  executeCommand, 
  searchFiles, 
  listMappings, 
  configureMappings,
  mainLoop
} from './commands.js';
import { initConfig, configExists } from './config.js';
import { initDatabase, seedDatabase } from './database.js';
import chalk from 'chalk';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { stdout } from 'process';
import { setColorEnabled } from './utils.js';

// Helper to get relative path from home
function getRelativeCwd(): string {
  const cwd = process.cwd();
  const home = os.homedir();
  
  // Normalize paths to handle Windows backslashes vs Unix forward slashes
  const normalizedCwd = path.normalize(cwd);
  const normalizedHome = path.normalize(home);
  
  if (normalizedCwd.startsWith(normalizedHome)) {
    // Use forward slashes consistently for display, even on Windows
    const relativePath = normalizedCwd.slice(normalizedHome.length).replace(/\\/g, '/');
    return '~' + relativePath;
  }
  return cwd.replace(/\\/g, '/');
}

// Helper to get git repository info
function getGitInfo(): { isRepo: boolean; branch?: string } {
  try {
    // Check if we're in a git repo by running git rev-parse --git-dir
    const result = spawnSync('git', ['rev-parse', '--git-dir'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 1000
    });
    
    if (result.status !== 0) {
      return { isRepo: false };
    }
    
    // Get the current branch name
    const branchResult = spawnSync('git', ['branch', '--show-current'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 1000
    });
    
    if (branchResult.status === 0) {
      const branch = branchResult.stdout?.trim();
      return { isRepo: true, branch };
    }
    
    return { isRepo: true };
  } catch {
    return { isRepo: false };
  }
}

// Build git info line
function getGitBannerLine(): string {
  const gitInfo = getGitInfo();
  if (!gitInfo.isRepo) {
    return '';
  }
  const branch = gitInfo.branch || 'unknown';
  return chalk.magenta(`\n                    ⎇  ${branch}`);
}

// Get terminal width
function getTerminalWidth(): number {
  return stdout.columns || 80;
}

// Full ASCII Art Banner (89 chars wide)
const fullAsciiArt = chalk.cyan(`
███╗   ██╗██╗         ████████╗███████╗██████╗ ███╗   ███╗██╗███╗   ██╗ █████╗ ██╗     
████╗  ██║██║         ╚══██╔══╝██╔════╝██╔══██╗████╗ ████║██║████╗  ██║██╔══██╗██║     
██╔██╗ ██║██║            ██║   █████╗  ██████╔╝██╔████╔██║██║██╔██╗ ██║███████║██║     
██║╚██╗██║██║            ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██║██║╚██╗██║██╔══██║██║     
██║ ╚████║███████╗       ██║   ███████╗██║  ██║██║ ╚═╝ ██║██║██║ ╚████║██║  ██║███████╗
╚═╝  ╚═══╝╚══════╝       ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝
`);

// Compact ASCII Art Banner (60 chars wide)
const compactAsciiArt = chalk.cyan(`
╔════════════════════════════════════════════════════════════╗
║           NL TERMINAL - Natural Language CLI               ║
╚════════════════════════════════════════════════════════════╝
`);

// Banner info text
const getBannerInfo = () => chalk.gray(`
                    Natural Language Terminal CLI v0.0.1
                    Type commands in natural language
                    SQLite Database with 160+ Commands
`) + chalk.yellow(`
                    📌 ${getRelativeCwd()}
`) + getGitBannerLine();

// Get banner based on terminal width
export function getBanner(): string {
  const width = getTerminalWidth();
  if (width >= 90) {
    return fullAsciiArt + getBannerInfo();
  } else {
    return compactAsciiArt + getBannerInfo();
  }
}

// Keep static banner for backwards compatibility
export const banner = getBanner();

const isTestRun = process.env.NL_TERMINAL_CLI_TEST === '1';
const rawArgs = process.argv.slice(2);

if (process.env.NO_COLOR === '1' || process.env.NL_TERMINAL_CLI_NO_COLOR === '1') {
  setColorEnabled(false);
}

if (rawArgs.includes('--no-color')) {
  process.env.NL_TERMINAL_CLI_NO_COLOR = '1';
  setColorEnabled(false);
}

if (rawArgs.includes('--dry-run')) {
  process.env.NL_TERMINAL_CLI_DRY_RUN = '1';
}

if (rawArgs.includes('--yes') || rawArgs.includes('-y')) {
  process.env.NL_TERMINAL_CLI_ASSUME_YES = '1';
}

// Show banner on startup
const args = process.argv.slice(2);
if (!isTestRun && (args.length === 0 || args[0] === 'run' || args[0] === 'r')) {
  console.log(getBanner());
}

const packageJson = {
  version: '0.0.1',
  name: 'nl-terminal-cli'
};

// Initialize database on startup
async function initializeApp(): Promise<void> {
  try {
    // Initialize database
    await initDatabase();
    await seedDatabase();
    
    // Check if config exists
    if (!(await configExists())) {
      await initConfig();
    }
  } catch (error) {
    console.error('Failed to initialize app:', error);
    process.exit(1);
  }
}

program
  .name('nl-terminal')
  .description('Natural Language Terminal - Execute commands using natural language')
  .version(packageJson.version);

program.option('--no-color', 'Disable color output');
program.option('--dry-run', 'Print commands without executing');
program.option('-y, --yes', 'Skip confirmation prompts');

program
  .command('run [command]')
  .alias('r')
  .description('Execute a command using natural language')
  .action(async (command, options) => {
    try {
      await initializeApp();
      
      if (command) {
        // Execute specific command
        await executeCommand(command);
      } else {
        // Start interactive mode with main loop
        await mainLoop();
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

program
  .command('search [query]')
  .alias('s')
  .description('Search for files')
  .option('-e, --ext <extension>', 'Filter by file extension')
  .option('-d, --dir <directory>', 'Search in specific directory')
  .option('-m, --max <number>', 'Maximum results', '20')
  .action(async (query, options) => {
    try {
      await initializeApp();
      
      await searchFiles(query, {
        extension: options.ext,
        directory: options.dir,
        maxResults: parseInt(options.max)
      });
    } catch (error) {
      console.error(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

program
  .command('list')
  .alias('ls')
  .description('List all saved command mappings')
  .action(async () => {
    try {
      await initializeApp();
      await listMappings();
    } catch (error) {
      console.error(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

program
  .command('config')
  .alias('c')
  .description('Configure command mappings')
  .action(async () => {
    try {
      await initializeApp();
      await configureMappings();
    } catch (error) {
      console.error(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Initialize configuration file')
  .action(async () => {
    try {
      await initConfig();
      console.log(chalk.green('✓ Configuration initialized'));
    } catch (error) {
      console.error(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

// Default command - if no command provided
if (!isTestRun && process.argv.length === 2) {
  process.argv.push('run');
}

const shouldParse = !isTestRun || args.length > 0;
if (shouldParse) {
  program.parse();
}
