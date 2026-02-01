/**
 * Runtime-agnostic database loader
 * Automatically detects Bun vs Node.js and loads the appropriate SQLite implementation
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import type { DatabaseCommand, Placeholder, ParsedCommand } from './types.js';

const CONFIG_DIR = path.join(os.homedir(), '.nl-terminal-cli');
const DB_PATH = path.join(CONFIG_DIR, 'commands.db');

// Detect if running under Bun
function isBun(): boolean {
  return typeof (process as any).versions?.bun !== 'undefined';
}

// Database interface that both implementations must satisfy
interface DatabaseInterface {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: any[]): { lastInsertRowid: number | bigint; changes: number };
    get(...args: any[]): any;
    all(...args: any[]): any[];
  };
  close(): void;
}

let db: DatabaseInterface | null = null;

async function loadDatabase(): Promise<DatabaseInterface> {
  if (isBun()) {
    // Use Bun's built-in SQLite
    const { Database } = await import('bun:sqlite');
    return new Database(DB_PATH) as DatabaseInterface;
  } else {
    // Use better-sqlite3 for Node.js
    const Database = (await import('better-sqlite3')).default;
    const database = new Database(DB_PATH);
    // Add WAL mode for better-sqlite3
    database.pragma('journal_mode = WAL');
    return database as DatabaseInterface;
  }
}

export async function getDatabase(): Promise<DatabaseInterface> {
  if (!db) {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    db = await loadDatabase();
  }
  return db;
}

export async function initDatabase(): Promise<void> {
  const database = await getDatabase();
  
  database.exec(`
    CREATE TABLE IF NOT EXISTS commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      natural_language TEXT NOT NULL,
      command_template TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      placeholders TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_commands_category ON commands(category);
    CREATE INDEX IF NOT EXISTS idx_commands_nl ON commands(natural_language);

    CREATE TABLE IF NOT EXISTS command_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command_id INTEGER,
      natural_language_input TEXT,
      executed_command TEXT,
      success BOOLEAN,
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (command_id) REFERENCES commands(id)
    );
  `);
}

export async function seedDatabase(): Promise<void> {
  const database = await getDatabase();
  
  const count = database.prepare('SELECT COUNT(*) as count FROM commands').get() as { count: number };
  
  if (count.count > 0) {
    return;
  }
  
  const insert = database.prepare(`
    INSERT INTO commands (natural_language, command_template, description, category, placeholders)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const commands = getDefaultCommands();
  
  // Manual transaction for bun:sqlite compatibility
  database.exec('BEGIN TRANSACTION');
  try {
    for (const cmd of commands) {
      insert.run(
        JSON.stringify(cmd.naturalLanguage),
        cmd.commandTemplate,
        cmd.description,
        cmd.category,
        JSON.stringify(cmd.placeholders)
      );
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function getDefaultCommands(): Array<{
  naturalLanguage: string[];
  commandTemplate: string;
  description: string;
  category: string;
  placeholders: Placeholder[];
}> {
  return [
    // File Operations
    {
      naturalLanguage: ['create a folder called', 'make directory', 'new folder named', 'mkdir'],
      commandTemplate: 'mkdir {folder_name}',
      description: 'Create a new directory',
      category: 'file',
      placeholders: [
        { name: 'folder_name', description: 'Name of the folder to create', required: true }
      ]
    },
    {
      naturalLanguage: ['create a file called', 'make file', 'new file named', 'touch'],
      commandTemplate: 'touch {file_name}',
      description: 'Create a new empty file',
      category: 'file',
      placeholders: [
        { name: 'file_name', description: 'Name of the file to create', required: true }
      ]
    },
    {
      naturalLanguage: ['delete folder', 'remove directory', 'rm dir', 'rmdir'],
      commandTemplate: 'rm -rf {folder_name}',
      description: 'Delete a directory and its contents',
      category: 'file',
      placeholders: [
        { name: 'folder_name', description: 'Name of the folder to delete', required: true }
      ]
    },
    {
      naturalLanguage: ['delete file', 'remove file', 'rm file'],
      commandTemplate: 'rm {file_name}',
      description: 'Delete a file',
      category: 'file',
      placeholders: [
        { name: 'file_name', description: 'Name of the file to delete', required: true }
      ]
    },
    {
      naturalLanguage: ['copy file', 'cp file'],
      commandTemplate: 'cp {source} {destination}',
      description: 'Copy a file from source to destination',
      category: 'file',
      placeholders: [
        { name: 'source', description: 'Source file path', required: true },
        { name: 'destination', description: 'Destination file path', required: true }
      ]
    },
    {
      naturalLanguage: ['move file', 'mv file', 'rename file'],
      commandTemplate: 'mv {source} {destination}',
      description: 'Move or rename a file',
      category: 'file',
      placeholders: [
        { name: 'source', description: 'Source file path', required: true },
        { name: 'destination', description: 'Destination file path', required: true }
      ]
    },
    {
      naturalLanguage: ['list files', 'ls', 'show files', 'list directory'],
      commandTemplate: 'ls -la',
      description: 'List all files in current directory with details',
      category: 'file',
      placeholders: []
    },
    {
      naturalLanguage: ['list files in', 'ls in directory'],
      commandTemplate: 'ls -la {directory}',
      description: 'List files in a specific directory',
      category: 'file',
      placeholders: [
        { name: 'directory', description: 'Directory path to list', required: true }
      ]
    },
    {
      naturalLanguage: ['find files named', 'search for file', 'locate file'],
      commandTemplate: 'find . -name "{file_pattern}"',
      description: 'Find files matching a pattern',
      category: 'file',
      placeholders: [
        { name: 'file_pattern', description: 'File name pattern (supports wildcards)', required: true }
      ]
    },
    {
      naturalLanguage: ['show current directory', 'pwd', 'print working directory'],
      commandTemplate: 'pwd',
      description: 'Show current working directory path',
      category: 'file',
      placeholders: []
    },
    {
      naturalLanguage: ['change directory', 'cd', 'go to folder'],
      commandTemplate: 'cd {directory}',
      description: 'Change to a different directory',
      category: 'file',
      placeholders: [
        { name: 'directory', description: 'Directory path to change to', required: true }
      ]
    },
    {
      naturalLanguage: ['view file contents', 'cat file', 'show file', 'read file'],
      commandTemplate: 'cat {file_name}',
      description: 'Display file contents',
      category: 'file',
      placeholders: [
        { name: 'file_name', description: 'File to display', required: true }
      ]
    },
    {
      naturalLanguage: ['edit file with nano', 'nano edit'],
      commandTemplate: 'nano {file_name}',
      description: 'Open file in nano editor',
      category: 'file',
      placeholders: [
        { name: 'file_name', description: 'File to edit', required: true }
      ]
    },
    {
      naturalLanguage: ['edit file with vim', 'vim edit'],
      commandTemplate: 'vim {file_name}',
      description: 'Open file in vim editor',
      category: 'file',
      placeholders: [
        { name: 'file_name', description: 'File to edit', required: true }
      ]
    },
    {
      naturalLanguage: ['copy folder', 'cp directory', 'copy directory'],
      commandTemplate: 'cp -r {source} {destination}',
      description: 'Copy a directory recursively',
      category: 'file',
      placeholders: [
        { name: 'source', description: 'Source directory', required: true },
        { name: 'destination', description: 'Destination directory', required: true }
      ]
    },

    // Git Commands
    {
      naturalLanguage: ['git init', 'initialize git', 'start git repo'],
      commandTemplate: 'git init',
      description: 'Initialize a new Git repository',
      category: 'git',
      placeholders: []
    },
    {
      naturalLanguage: ['git status', 'check git status', 'git state'],
      commandTemplate: 'git status',
      description: 'Show working tree status',
      category: 'git',
      placeholders: []
    },
    {
      naturalLanguage: ['git add all', 'stage all changes', 'git add .'],
      commandTemplate: 'git add .',
      description: 'Stage all changes for commit',
      category: 'git',
      placeholders: []
    },
    {
      naturalLanguage: ['git add file', 'stage file'],
      commandTemplate: 'git add {file_name}',
      description: 'Stage specific file for commit',
      category: 'git',
      placeholders: [
        { name: 'file_name', description: 'File to stage', required: true }
      ]
    },
    {
      naturalLanguage: ['git commit', 'commit changes'],
      commandTemplate: 'git commit -m "{message}"',
      description: 'Commit staged changes with a message',
      category: 'git',
      placeholders: [
        { name: 'message', description: 'Commit message', required: true }
      ]
    },
    {
      naturalLanguage: ['git push', 'push changes'],
      commandTemplate: 'git push',
      description: 'Push commits to remote repository',
      category: 'git',
      placeholders: []
    },
    {
      naturalLanguage: ['git push to branch', 'push to specific branch'],
      commandTemplate: 'git push origin {branch}',
      description: 'Push to a specific branch',
      category: 'git',
      placeholders: [
        { name: 'branch', description: 'Branch name to push to', required: true }
      ]
    },
    {
      naturalLanguage: ['git pull', 'pull changes', 'fetch and merge'],
      commandTemplate: 'git pull',
      description: 'Fetch and merge changes from remote',
      category: 'git',
      placeholders: []
    },
    {
      naturalLanguage: ['git log', 'view commit history', 'show commits'],
      commandTemplate: 'git log --oneline -{count}',
      description: 'Show commit history',
      category: 'git',
      placeholders: [
        { name: 'count', description: 'Number of commits to show', required: false, defaultValue: '10' }
      ]
    },
    {
      naturalLanguage: ['git log detailed', 'full git log'],
      commandTemplate: 'git log',
      description: 'Show detailed commit history',
      category: 'git',
      placeholders: []
    },
    {
      naturalLanguage: ['git branch', 'list branches', 'show branches'],
      commandTemplate: 'git branch',
      description: 'List all local branches',
      category: 'git',
      placeholders: []
    },
    {
      naturalLanguage: ['git branch all', 'list all branches', 'show all branches'],
      commandTemplate: 'git branch -a',
      description: 'List all local and remote branches',
      category: 'git',
      placeholders: []
    },
    {
      naturalLanguage: ['git checkout', 'switch branch'],
      commandTemplate: 'git checkout {branch}',
      description: 'Switch to a different branch',
      category: 'git',
      placeholders: [
        { name: 'branch', description: 'Branch name to checkout', required: true }
      ]
    },
    {
      naturalLanguage: ['git checkout new', 'create and switch branch'],
      commandTemplate: 'git checkout -b {branch}',
      description: 'Create and switch to a new branch',
      category: 'git',
      placeholders: [
        { name: 'branch', description: 'New branch name', required: true }
      ]
    },
    {
      naturalLanguage: ['git merge', 'merge branch'],
      commandTemplate: 'git merge {branch}',
      description: 'Merge a branch into current branch',
      category: 'git',
      placeholders: [
        { name: 'branch', description: 'Branch to merge', required: true }
      ]
    },
    {
      naturalLanguage: ['git diff', 'show differences'],
      commandTemplate: 'git diff',
      description: 'Show changes between commits, working tree, etc.',
      category: 'git',
      placeholders: []
    },
    {
      naturalLanguage: ['git diff staged', 'show staged differences'],
      commandTemplate: 'git diff --staged',
      description: 'Show changes in staged files',
      category: 'git',
      placeholders: []
    },
    {
      naturalLanguage: ['git stash', 'stash changes'],
      commandTemplate: 'git stash',
      description: 'Stash current changes',
      category: 'git',
      placeholders: []
    },
    {
      naturalLanguage: ['git stash pop', 'unstash changes', 'apply stash'],
      commandTemplate: 'git stash pop',
      description: 'Apply and remove stashed changes',
      category: 'git',
      placeholders: []
    },
    {
      naturalLanguage: ['git clone', 'clone repository'],
      commandTemplate: 'git clone {repository_url}',
      description: 'Clone a remote repository',
      category: 'git',
      placeholders: [
        { name: 'repository_url', description: 'Repository URL to clone', required: true }
      ]
    },
    {
      naturalLanguage: ['git remote add', 'add remote'],
      commandTemplate: 'git remote add {remote_name} {repository_url}',
      description: 'Add a remote repository',
      category: 'git',
      placeholders: [
        { name: 'remote_name', description: 'Name for the remote (e.g., origin)', required: true },
        { name: 'repository_url', description: 'Repository URL', required: true }
      ]
    },
    {
      naturalLanguage: ['git fetch', 'fetch remote'],
      commandTemplate: 'git fetch',
      description: 'Download objects and refs from remote',
      category: 'git',
      placeholders: []
    },

    // npm/yarn Commands
    {
      naturalLanguage: ['npm install', 'install dependencies', 'npm i'],
      commandTemplate: 'npm install',
      description: 'Install npm dependencies',
      category: 'npm',
      placeholders: []
    },
    {
      naturalLanguage: ['npm install package', 'install npm package'],
      commandTemplate: 'npm install {package_name}',
      description: 'Install a specific npm package',
      category: 'npm',
      placeholders: [
        { name: 'package_name', description: 'Package name to install', required: true }
      ]
    },
    {
      naturalLanguage: ['npm install dev', 'install dev dependency'],
      commandTemplate: 'npm install --save-dev {package_name}',
      description: 'Install a dev dependency',
      category: 'npm',
      placeholders: [
        { name: 'package_name', description: 'Package name to install', required: true }
      ]
    },
    {
      naturalLanguage: ['npm install global', 'install global package'],
      commandTemplate: 'npm install -g {package_name}',
      description: 'Install a package globally',
      category: 'npm',
      placeholders: [
        { name: 'package_name', description: 'Package name to install globally', required: true }
      ]
    },
    {
      naturalLanguage: ['npm uninstall', 'remove package'],
      commandTemplate: 'npm uninstall {package_name}',
      description: 'Uninstall a package',
      category: 'npm',
      placeholders: [
        { name: 'package_name', description: 'Package name to uninstall', required: true }
      ]
    },
    {
      naturalLanguage: ['npm run', 'run script'],
      commandTemplate: 'npm run {script_name}',
      description: 'Run an npm script',
      category: 'npm',
      placeholders: [
        { name: 'script_name', description: 'Script name from package.json', required: true }
      ]
    },
    {
      naturalLanguage: ['npm start', 'start project'],
      commandTemplate: 'npm start',
      description: 'Start the project',
      category: 'npm',
      placeholders: []
    },
    {
      naturalLanguage: ['npm build', 'build project'],
      commandTemplate: 'npm run build',
      description: 'Build the project',
      category: 'npm',
      placeholders: []
    },
    {
      naturalLanguage: ['npm test', 'run tests'],
      commandTemplate: 'npm test',
      description: 'Run tests',
      category: 'npm',
      placeholders: []
    },
    {
      naturalLanguage: ['npm update', 'update packages'],
      commandTemplate: 'npm update',
      description: 'Update all packages to latest versions',
      category: 'npm',
      placeholders: []
    },
    {
      naturalLanguage: ['npm outdated', 'check outdated packages'],
      commandTemplate: 'npm outdated',
      description: 'Check for outdated packages',
      category: 'npm',
      placeholders: []
    },
    {
      naturalLanguage: ['npm audit', 'audit packages'],
      commandTemplate: 'npm audit',
      description: 'Run security audit on dependencies',
      category: 'npm',
      placeholders: []
    },
    {
      naturalLanguage: ['npm audit fix', 'fix audit issues'],
      commandTemplate: 'npm audit fix',
      description: 'Fix security vulnerabilities',
      category: 'npm',
      placeholders: []
    },

    // Bun Commands
    {
      naturalLanguage: ['bun install', 'bun i', 'install with bun'],
      commandTemplate: 'bun install',
      description: 'Install dependencies with Bun',
      category: 'bun',
      placeholders: []
    },
    {
      naturalLanguage: ['bun add', 'bun add package', 'add package with bun'],
      commandTemplate: 'bun add {package_name}',
      description: 'Add a package with Bun',
      category: 'bun',
      placeholders: [
        { name: 'package_name', description: 'Package name to add', required: true }
      ]
    },
    {
      naturalLanguage: ['bun add dev', 'bun add dev dependency'],
      commandTemplate: 'bun add -d {package_name}',
      description: 'Add a dev dependency with Bun',
      category: 'bun',
      placeholders: [
        { name: 'package_name', description: 'Package name to add as dev dependency', required: true }
      ]
    },
    {
      naturalLanguage: ['bun add global', 'bun global package'],
      commandTemplate: 'bun add -g {package_name}',
      description: 'Add a package globally with Bun',
      category: 'bun',
      placeholders: [
        { name: 'package_name', description: 'Package name to install globally', required: true }
      ]
    },
    {
      naturalLanguage: ['bun remove', 'bun uninstall', 'remove package bun'],
      commandTemplate: 'bun remove {package_name}',
      description: 'Remove a package with Bun',
      category: 'bun',
      placeholders: [
        { name: 'package_name', description: 'Package name to remove', required: true }
      ]
    },
    {
      naturalLanguage: ['bun run', 'bun script', 'run script with bun'],
      commandTemplate: 'bun run {script_name}',
      description: 'Run a script with Bun',
      category: 'bun',
      placeholders: [
        { name: 'script_name', description: 'Script name from package.json', required: true }
      ]
    },
    {
      naturalLanguage: ['bun start', 'start with bun'],
      commandTemplate: 'bun start',
      description: 'Start the project with Bun',
      category: 'bun',
      placeholders: []
    },
    {
      naturalLanguage: ['bun build', 'build with bun'],
      commandTemplate: 'bun run build',
      description: 'Build the project with Bun',
      category: 'bun',
      placeholders: []
    },
    {
      naturalLanguage: ['bun test', 'test with bun', 'run tests bun'],
      commandTemplate: 'bun test',
      description: 'Run tests with Bun',
      category: 'bun',
      placeholders: []
    },
    {
      naturalLanguage: ['bun run file', 'bun execute', 'run file with bun'],
      commandTemplate: 'bun {file}',
      description: 'Run a JavaScript/TypeScript file with Bun',
      category: 'bun',
      placeholders: [
        { name: 'file', description: 'File to run (js/ts)', required: true }
      ]
    },
    {
      naturalLanguage: ['bun init', 'initialize bun project', 'create bun project'],
      commandTemplate: 'bun init',
      description: 'Initialize a new Bun project',
      category: 'bun',
      placeholders: []
    },
    {
      naturalLanguage: ['bun create', 'bun create project', 'scaffold with bun'],
      commandTemplate: 'bun create {template} {project_name}',
      description: 'Create a new project from a template',
      category: 'bun',
      placeholders: [
        { name: 'template', description: 'Template name (e.g., react, next, elysia)', required: true },
        { name: 'project_name', description: 'Project directory name', required: true }
      ]
    },
    {
      naturalLanguage: ['bun update', 'update bun packages'],
      commandTemplate: 'bun update',
      description: 'Update all dependencies with Bun',
      category: 'bun',
      placeholders: []
    },
    {
      naturalLanguage: ['bun outdated', 'check outdated bun'],
      commandTemplate: 'bun outdated',
      description: 'Check for outdated packages with Bun',
      category: 'bun',
      placeholders: []
    },
    {
      naturalLanguage: ['bun pm ls', 'bun list packages', 'list bun packages'],
      commandTemplate: 'bun pm ls',
      description: 'List installed packages',
      category: 'bun',
      placeholders: []
    },
    {
      naturalLanguage: ['bun pm cache', 'bun cache', 'show bun cache'],
      commandTemplate: 'bun pm cache',
      description: 'Show Bun cache directory',
      category: 'bun',
      placeholders: []
    },
    {
      naturalLanguage: ['bun pm cache rm', 'clear bun cache'],
      commandTemplate: 'bun pm cache rm',
      description: 'Clear Bun cache',
      category: 'bun',
      placeholders: []
    },
    {
      naturalLanguage: ['bunx', 'bun execute package', 'run package with bun'],
      commandTemplate: 'bunx {package_name}',
      description: 'Execute a package with bunx (like npx)',
      category: 'bun',
      placeholders: [
        { name: 'package_name', description: 'Package to execute', required: true }
      ]
    },
    {
      naturalLanguage: ['bun repl', 'bun interactive', 'bun shell'],
      commandTemplate: 'bun repl',
      description: 'Start Bun REPL (interactive shell)',
      category: 'bun',
      placeholders: []
    },
    {
      naturalLanguage: ['bun upgrade', 'upgrade bun', 'update bun itself'],
      commandTemplate: 'bun upgrade',
      description: 'Upgrade Bun to the latest version',
      category: 'bun',
      placeholders: []
    },
    {
      naturalLanguage: ['bun version', 'bun --version', 'check bun version'],
      commandTemplate: 'bun --version',
      description: 'Show Bun version',
      category: 'bun',
      placeholders: []
    },

    // System Commands
    {
      naturalLanguage: ['disk usage', 'show disk space', 'df'],
      commandTemplate: 'df -h',
      description: 'Show disk space usage',
      category: 'system',
      placeholders: []
    },
    {
      naturalLanguage: ['disk usage folder', 'folder size', 'du directory'],
      commandTemplate: 'du -sh {directory}',
      description: 'Show directory size',
      category: 'system',
      placeholders: [
        { name: 'directory', description: 'Directory to check size', required: true }
      ]
    },
    {
      naturalLanguage: ['show processes', 'list processes', 'ps aux'],
      commandTemplate: 'ps aux',
      description: 'List all running processes',
      category: 'system',
      placeholders: []
    },
    {
      naturalLanguage: ['find process', 'grep process', 'search process'],
      commandTemplate: 'ps aux | grep {process_name}',
      description: 'Find a specific process',
      category: 'system',
      placeholders: [
        { name: 'process_name', description: 'Process name to search for', required: true }
      ]
    },
    {
      naturalLanguage: ['kill process', 'terminate process'],
      commandTemplate: 'kill {pid}',
      description: 'Kill a process by PID',
      category: 'system',
      placeholders: [
        { name: 'pid', description: 'Process ID to kill', required: true }
      ]
    },
    {
      naturalLanguage: ['kill process force', 'force kill'],
      commandTemplate: 'kill -9 {pid}',
      description: 'Force kill a process',
      category: 'system',
      placeholders: [
        { name: 'pid', description: 'Process ID to force kill', required: true }
      ]
    },
    {
      naturalLanguage: ['show memory', 'memory usage', 'free memory'],
      commandTemplate: 'free -h',
      description: 'Show memory usage',
      category: 'system',
      placeholders: []
    },
    {
      naturalLanguage: ['show environment', 'print env', 'environment variables'],
      commandTemplate: 'env',
      description: 'Show all environment variables',
      category: 'system',
      placeholders: []
    },
    {
      naturalLanguage: ['get environment variable', 'echo env'],
      commandTemplate: 'echo ${variable_name}',
      description: 'Show a specific environment variable',
      category: 'system',
      placeholders: [
        { name: 'variable_name', description: 'Environment variable name', required: true }
      ]
    },
    {
      naturalLanguage: ['set environment variable', 'export variable'],
      commandTemplate: 'export {variable_name}={value}',
      description: 'Set an environment variable',
      category: 'system',
      placeholders: [
        { name: 'variable_name', description: 'Variable name', required: true },
        { name: 'value', description: 'Variable value', required: true }
      ]
    },
    {
      naturalLanguage: ['system info', 'uname', 'system information'],
      commandTemplate: 'uname -a',
      description: 'Show system information',
      category: 'system',
      placeholders: []
    },
    {
      naturalLanguage: ['uptime', 'system uptime'],
      commandTemplate: 'uptime',
      description: 'Show system uptime',
      category: 'system',
      placeholders: []
    },
    {
      naturalLanguage: ['whoami', 'current user'],
      commandTemplate: 'whoami',
      description: 'Show current user',
      category: 'system',
      placeholders: []
    },
    {
      naturalLanguage: ['which command', 'where is command'],
      commandTemplate: 'which {command}',
      description: 'Locate a command',
      category: 'system',
      placeholders: [
        { name: 'command', description: 'Command to locate', required: true }
      ]
    },

    // Docker Commands
    {
      naturalLanguage: ['docker build', 'build docker image'],
      commandTemplate: 'docker build -t {image_name} .',
      description: 'Build a Docker image',
      category: 'docker',
      placeholders: [
        { name: 'image_name', description: 'Name for the Docker image', required: true }
      ]
    },
    {
      naturalLanguage: ['docker run', 'start container'],
      commandTemplate: 'docker run -d --name {container_name} {image_name}',
      description: 'Run a Docker container',
      category: 'docker',
      placeholders: [
        { name: 'container_name', description: 'Name for the container', required: true },
        { name: 'image_name', description: 'Docker image to run', required: true }
      ]
    },
    {
      naturalLanguage: ['docker run interactive', 'run container interactive'],
      commandTemplate: 'docker run -it {image_name} /bin/bash',
      description: 'Run a container interactively',
      category: 'docker',
      placeholders: [
        { name: 'image_name', description: 'Docker image to run', required: true }
      ]
    },
    {
      naturalLanguage: ['docker ps', 'list containers', 'show containers'],
      commandTemplate: 'docker ps',
      description: 'List running containers',
      category: 'docker',
      placeholders: []
    },
    {
      naturalLanguage: ['docker ps all', 'list all containers'],
      commandTemplate: 'docker ps -a',
      description: 'List all containers including stopped',
      category: 'docker',
      placeholders: []
    },
    {
      naturalLanguage: ['docker stop', 'stop container'],
      commandTemplate: 'docker stop {container_name}',
      description: 'Stop a running container',
      category: 'docker',
      placeholders: [
        { name: 'container_name', description: 'Container name or ID to stop', required: true }
      ]
    },
    {
      naturalLanguage: ['docker start', 'start container'],
      commandTemplate: 'docker start {container_name}',
      description: 'Start a stopped container',
      category: 'docker',
      placeholders: [
        { name: 'container_name', description: 'Container name or ID to start', required: true }
      ]
    },
    {
      naturalLanguage: ['docker remove', 'rm container', 'delete container'],
      commandTemplate: 'docker rm {container_name}',
      description: 'Remove a container',
      category: 'docker',
      placeholders: [
        { name: 'container_name', description: 'Container name or ID to remove', required: true }
      ]
    },
    {
      naturalLanguage: ['docker remove force', 'force remove container'],
      commandTemplate: 'docker rm -f {container_name}',
      description: 'Force remove a container',
      category: 'docker',
      placeholders: [
        { name: 'container_name', description: 'Container name or ID to remove', required: true }
      ]
    },
    {
      naturalLanguage: ['docker exec', 'execute in container'],
      commandTemplate: 'docker exec -it {container_name} {command}',
      description: 'Execute a command in a running container',
      category: 'docker',
      placeholders: [
        { name: 'container_name', description: 'Container name or ID', required: true },
        { name: 'command', description: 'Command to execute', required: true, defaultValue: '/bin/bash' }
      ]
    },
    {
      naturalLanguage: ['docker logs', 'container logs'],
      commandTemplate: 'docker logs {container_name}',
      description: 'Show container logs',
      category: 'docker',
      placeholders: [
        { name: 'container_name', description: 'Container name or ID', required: true }
      ]
    },
    {
      naturalLanguage: ['docker logs follow', 'follow container logs'],
      commandTemplate: 'docker logs -f {container_name}',
      description: 'Follow container logs',
      category: 'docker',
      placeholders: [
        { name: 'container_name', description: 'Container name or ID', required: true }
      ]
    },
    {
      naturalLanguage: ['docker images', 'list images'],
      commandTemplate: 'docker images',
      description: 'List Docker images',
      category: 'docker',
      placeholders: []
    },
    {
      naturalLanguage: ['docker rmi', 'remove image', 'delete image'],
      commandTemplate: 'docker rmi {image_name}',
      description: 'Remove a Docker image',
      category: 'docker',
      placeholders: [
        { name: 'image_name', description: 'Image name or ID to remove', required: true }
      ]
    },
    {
      naturalLanguage: ['docker compose up', 'start docker compose'],
      commandTemplate: 'docker-compose up -d',
      description: 'Start services with Docker Compose',
      category: 'docker',
      placeholders: []
    },
    {
      naturalLanguage: ['docker compose down', 'stop docker compose'],
      commandTemplate: 'docker-compose down',
      description: 'Stop Docker Compose services',
      category: 'docker',
      placeholders: []
    },
    {
      naturalLanguage: ['docker compose build', 'build docker compose'],
      commandTemplate: 'docker-compose build',
      description: 'Build Docker Compose services',
      category: 'docker',
      placeholders: []
    },
    {
      naturalLanguage: ['docker compose logs', 'docker compose logs'],
      commandTemplate: 'docker-compose logs -f',
      description: 'View Docker Compose logs',
      category: 'docker',
      placeholders: []
    },
    {
      naturalLanguage: ['docker pull', 'pull image'],
      commandTemplate: 'docker pull {image_name}',
      description: 'Pull a Docker image from registry',
      category: 'docker',
      placeholders: [
        { name: 'image_name', description: 'Image name to pull', required: true }
      ]
    },
    {
      naturalLanguage: ['docker push', 'push image'],
      commandTemplate: 'docker push {image_name}',
      description: 'Push a Docker image to registry',
      category: 'docker',
      placeholders: [
        { name: 'image_name', description: 'Image name to push', required: true }
      ]
    },

    // Database Commands
    {
      naturalLanguage: ['database migrate', 'run migrations'],
      commandTemplate: 'npm run migrate',
      description: 'Run database migrations',
      category: 'database',
      placeholders: []
    },
    {
      naturalLanguage: ['database seed', 'seed database'],
      commandTemplate: 'npm run seed',
      description: 'Seed the database with data',
      category: 'database',
      placeholders: []
    },
    {
      naturalLanguage: ['database backup', 'backup database'],
      commandTemplate: 'pg_dump -U {username} -d {database_name} > {backup_file}',
      description: 'Backup a PostgreSQL database',
      category: 'database',
      placeholders: [
        { name: 'username', description: 'Database username', required: true },
        { name: 'database_name', description: 'Database name', required: true },
        { name: 'backup_file', description: 'Backup file path', required: true }
      ]
    },
    {
      naturalLanguage: ['database restore', 'restore database'],
      commandTemplate: 'psql -U {username} -d {database_name} < {backup_file}',
      description: 'Restore a PostgreSQL database',
      category: 'database',
      placeholders: [
        { name: 'username', description: 'Database username', required: true },
        { name: 'database_name', description: 'Database name', required: true },
        { name: 'backup_file', description: 'Backup file path', required: true }
      ]
    },
    {
      naturalLanguage: ['mysql dump', 'backup mysql'],
      commandTemplate: 'mysqldump -u {username} -p {database_name} > {backup_file}',
      description: 'Backup a MySQL database',
      category: 'database',
      placeholders: [
        { name: 'username', description: 'MySQL username', required: true },
        { name: 'database_name', description: 'Database name', required: true },
        { name: 'backup_file', description: 'Backup file path', required: true }
      ]
    },
    {
      naturalLanguage: ['mysql import', 'restore mysql'],
      commandTemplate: 'mysql -u {username} -p {database_name} < {backup_file}',
      description: 'Restore a MySQL database',
      category: 'database',
      placeholders: [
        { name: 'username', description: 'MySQL username', required: true },
        { name: 'database_name', description: 'Database name', required: true },
        { name: 'backup_file', description: 'Backup file path', required: true }
      ]
    },

    // Network Commands
    {
      naturalLanguage: ['curl', 'http request', 'fetch url'],
      commandTemplate: 'curl {url}',
      description: 'Make an HTTP request',
      category: 'network',
      placeholders: [
        { name: 'url', description: 'URL to fetch', required: true }
      ]
    },
    {
      naturalLanguage: ['curl download', 'download file'],
      commandTemplate: 'curl -O {url}',
      description: 'Download a file',
      category: 'network',
      placeholders: [
        { name: 'url', description: 'URL to download', required: true }
      ]
    },
    {
      naturalLanguage: ['curl output', 'save to file'],
      commandTemplate: 'curl -o {output_file} {url}',
      description: 'Save URL contents to a file',
      category: 'network',
      placeholders: [
        { name: 'output_file', description: 'Output file name', required: true },
        { name: 'url', description: 'URL to fetch', required: true }
      ]
    },
    {
      naturalLanguage: ['curl post', 'post request'],
      commandTemplate: 'curl -X POST -H "Content-Type: application/json" -d \'{data}\' {url}',
      description: 'Make a POST request with JSON data',
      category: 'network',
      placeholders: [
        { name: 'data', description: 'JSON data to send', required: true },
        { name: 'url', description: 'URL to post to', required: true }
      ]
    },
    {
      naturalLanguage: ['wget', 'download with wget'],
      commandTemplate: 'wget {url}',
      description: 'Download a file using wget',
      category: 'network',
      placeholders: [
        { name: 'url', description: 'URL to download', required: true }
      ]
    },
    {
      naturalLanguage: ['wget output', 'save with wget'],
      commandTemplate: 'wget -O {output_file} {url}',
      description: 'Download and save to specific file',
      category: 'network',
      placeholders: [
        { name: 'output_file', description: 'Output file name', required: true },
        { name: 'url', description: 'URL to download', required: true }
      ]
    },
    {
      naturalLanguage: ['ping', 'test connection'],
      commandTemplate: 'ping -c 4 {host}',
      description: 'Ping a host to test connectivity',
      category: 'network',
      placeholders: [
        { name: 'host', description: 'Host to ping', required: true }
      ]
    },
    {
      naturalLanguage: ['ping count', 'ping specific count'],
      commandTemplate: 'ping -c {count} {host}',
      description: 'Ping a host with specific count',
      category: 'network',
      placeholders: [
        { name: 'count', description: 'Number of pings', required: true, defaultValue: '4' },
        { name: 'host', description: 'Host to ping', required: true }
      ]
    },
    {
      naturalLanguage: ['netstat', 'network connections'],
      commandTemplate: 'netstat -tuln',
      description: 'Show network connections and ports',
      category: 'network',
      placeholders: []
    },
    {
      naturalLanguage: ['ifconfig', 'network interfaces'],
      commandTemplate: 'ifconfig',
      description: 'Show network interface configuration',
      category: 'network',
      placeholders: []
    },
    {
      naturalLanguage: ['ip addr', 'show ip addresses'],
      commandTemplate: 'ip addr',
      description: 'Show IP addresses',
      category: 'network',
      placeholders: []
    },
    {
      naturalLanguage: ['ssh', 'connect to server'],
      commandTemplate: 'ssh {user}@{host}',
      description: 'SSH into a remote server',
      category: 'network',
      placeholders: [
        { name: 'user', description: 'Username', required: true },
        { name: 'host', description: 'Host or IP address', required: true }
      ]
    },
    {
      naturalLanguage: ['ssh with port', 'ssh custom port'],
      commandTemplate: 'ssh -p {port} {user}@{host}',
      description: 'SSH with custom port',
      category: 'network',
      placeholders: [
        { name: 'port', description: 'SSH port', required: true, defaultValue: '22' },
        { name: 'user', description: 'Username', required: true },
        { name: 'host', description: 'Host or IP address', required: true }
      ]
    },
    {
      naturalLanguage: ['scp copy', 'secure copy'],
      commandTemplate: 'scp {source} {user}@{host}:{destination}',
      description: 'Copy files over SSH',
      category: 'network',
      placeholders: [
        { name: 'source', description: 'Local file path', required: true },
        { name: 'user', description: 'Remote username', required: true },
        { name: 'host', description: 'Remote host', required: true },
        { name: 'destination', description: 'Remote destination path', required: true }
      ]
    },

    // Text Processing Commands
    {
      naturalLanguage: ['grep', 'search text', 'find in files'],
      commandTemplate: 'grep "{pattern}" {file}',
      description: 'Search for a pattern in a file',
      category: 'text',
      placeholders: [
        { name: 'pattern', description: 'Pattern to search for', required: true },
        { name: 'file', description: 'File to search in', required: true }
      ]
    },
    {
      naturalLanguage: ['grep recursive', 'search in directory'],
      commandTemplate: 'grep -r "{pattern}" {directory}',
      description: 'Recursively search for pattern in directory',
      category: 'text',
      placeholders: [
        { name: 'pattern', description: 'Pattern to search for', required: true },
        { name: 'directory', description: 'Directory to search in', required: true }
      ]
    },
    {
      naturalLanguage: ['grep ignore case', 'case insensitive search'],
      commandTemplate: 'grep -i "{pattern}" {file}',
      description: 'Case-insensitive pattern search',
      category: 'text',
      placeholders: [
        { name: 'pattern', description: 'Pattern to search for', required: true },
        { name: 'file', description: 'File to search in', required: true }
      ]
    },
    {
      naturalLanguage: ['awk', 'process text', 'extract columns'],
      commandTemplate: 'awk \'{action}\' {file}',
      description: 'Process text with awk',
      category: 'text',
      placeholders: [
        { name: 'action', description: 'AWK action (e.g., \'{print $1}\')', required: true },
        { name: 'file', description: 'File to process', required: true }
      ]
    },
    {
      naturalLanguage: ['sed replace', 'replace text', 'substitute text'],
      commandTemplate: 'sed \'s/{old}/{new}/g\' {file}',
      description: 'Replace text in a file',
      category: 'text',
      placeholders: [
        { name: 'old', description: 'Text to replace', required: true },
        { name: 'new', description: 'Replacement text', required: true },
        { name: 'file', description: 'File to modify', required: true }
      ]
    },
    {
      naturalLanguage: ['sed replace in place', 'edit file in place'],
      commandTemplate: 'sed -i \'s/{old}/{new}/g\' {file}',
      description: 'Replace text in file in-place',
      category: 'text',
      placeholders: [
        { name: 'old', description: 'Text to replace', required: true },
        { name: 'new', description: 'Replacement text', required: true },
        { name: 'file', description: 'File to modify', required: true }
      ]
    },
    {
      naturalLanguage: ['cat', 'display file', 'show file contents'],
      commandTemplate: 'cat {file}',
      description: 'Display file contents',
      category: 'text',
      placeholders: [
        { name: 'file', description: 'File to display', required: true }
      ]
    },
    {
      naturalLanguage: ['cat multiple', 'concatenate files'],
      commandTemplate: 'cat {file1} {file2}',
      description: 'Concatenate multiple files',
      category: 'text',
      placeholders: [
        { name: 'file1', description: 'First file', required: true },
        { name: 'file2', description: 'Second file', required: true }
      ]
    },
    {
      naturalLanguage: ['echo', 'print text'],
      commandTemplate: 'echo "{text}"',
      description: 'Print text to console',
      category: 'text',
      placeholders: [
        { name: 'text', description: 'Text to print', required: true }
      ]
    },
    {
      naturalLanguage: ['echo to file', 'write to file'],
      commandTemplate: 'echo "{text}" > {file}',
      description: 'Write text to file (overwrite)',
      category: 'text',
      placeholders: [
        { name: 'text', description: 'Text to write', required: true },
        { name: 'file', description: 'File to write to', required: true }
      ]
    },
    {
      naturalLanguage: ['echo append', 'append to file'],
      commandTemplate: 'echo "{text}" >> {file}',
      description: 'Append text to file',
      category: 'text',
      placeholders: [
        { name: 'text', description: 'Text to append', required: true },
        { name: 'file', description: 'File to append to', required: true }
      ]
    },
    {
      naturalLanguage: ['head', 'show first lines'],
      commandTemplate: 'head -n {count} {file}',
      description: 'Show first n lines of a file',
      category: 'text',
      placeholders: [
        { name: 'count', description: 'Number of lines', required: true, defaultValue: '10' },
        { name: 'file', description: 'File to read', required: true }
      ]
    },
    {
      naturalLanguage: ['tail', 'show last lines'],
      commandTemplate: 'tail -n {count} {file}',
      description: 'Show last n lines of a file',
      category: 'text',
      placeholders: [
        { name: 'count', description: 'Number of lines', required: true, defaultValue: '10' },
        { name: 'file', description: 'File to read', required: true }
      ]
    },
    {
      naturalLanguage: ['tail follow', 'follow file'],
      commandTemplate: 'tail -f {file}',
      description: 'Follow file as it grows',
      category: 'text',
      placeholders: [
        { name: 'file', description: 'File to follow', required: true }
      ]
    },
    {
      naturalLanguage: ['wc', 'word count', 'count lines'],
      commandTemplate: 'wc -l {file}',
      description: 'Count lines in a file',
      category: 'text',
      placeholders: [
        { name: 'file', description: 'File to count', required: true }
      ]
    },
    {
      naturalLanguage: ['wc words', 'count words'],
      commandTemplate: 'wc -w {file}',
      description: 'Count words in a file',
      category: 'text',
      placeholders: [
        { name: 'file', description: 'File to count', required: true }
      ]
    },
    {
      naturalLanguage: ['sort', 'sort file'],
      commandTemplate: 'sort {file}',
      description: 'Sort lines in a file',
      category: 'text',
      placeholders: [
        { name: 'file', description: 'File to sort', required: true }
      ]
    },
    {
      naturalLanguage: ['sort reverse', 'reverse sort'],
      commandTemplate: 'sort -r {file}',
      description: 'Sort lines in reverse order',
      category: 'text',
      placeholders: [
        { name: 'file', description: 'File to sort', required: true }
      ]
    },
    {
      naturalLanguage: ['uniq', 'unique lines'],
      commandTemplate: 'uniq {file}',
      description: 'Show unique lines in a file',
      category: 'text',
      placeholders: [
        { name: 'file', description: 'File to process', required: true }
      ]
    },
    {
      naturalLanguage: ['uniq count', 'count unique'],
      commandTemplate: 'uniq -c {file}',
      description: 'Count occurrences of unique lines',
      category: 'text',
      placeholders: [
        { name: 'file', description: 'File to process', required: true }
      ]
    },
    {
      naturalLanguage: ['cut columns', 'extract columns'],
      commandTemplate: 'cut -d\'{delimiter}\' -f{fields} {file}',
      description: 'Extract specific columns from a file',
      category: 'text',
      placeholders: [
        { name: 'delimiter', description: 'Field delimiter', required: true, defaultValue: ',' },
        { name: 'fields', description: 'Field numbers to extract (e.g., 1,3,5)', required: true },
        { name: 'file', description: 'File to process', required: true }
      ]
    },

    // Compound Command Aliases
    {
      naturalLanguage: ['commit and push', 'commit then push', 'save and push'],
      commandTemplate: 'git add . && git commit -m "{message}" && git push',
      description: 'Stage all changes, commit with message, and push to remote',
      category: 'git',
      placeholders: [
        { name: 'message', description: 'Commit message', required: true }
      ]
    },
    {
      naturalLanguage: ['add commit push', 'stage commit and push'],
      commandTemplate: 'git add . && git commit -m "{message}" && git push',
      description: 'Stage all changes, commit with message, and push to remote',
      category: 'git',
      placeholders: [
        { name: 'message', description: 'Commit message', required: true }
      ]
    },
    {
      naturalLanguage: ['build and deploy', 'build then deploy', 'compile and deploy'],
      commandTemplate: 'npm run build && npm run deploy',
      description: 'Build the project and deploy it',
      category: 'npm',
      placeholders: []
    },
    {
      naturalLanguage: ['test and build', 'run tests then build', 'test then build'],
      commandTemplate: 'npm test && npm run build',
      description: 'Run tests and build the project',
      category: 'npm',
      placeholders: []
    },
    {
      naturalLanguage: ['install and start', 'install then start', 'npm install and run'],
      commandTemplate: 'npm install && npm start',
      description: 'Install dependencies and start the project',
      category: 'npm',
      placeholders: []
    },
    {
      naturalLanguage: ['save and exit', 'save then quit', 'write and exit'],
      commandTemplate: ':wq',
      description: 'Save and exit vim editor',
      category: 'text',
      placeholders: []
    },
    {
      naturalLanguage: ['save without exit', 'save file', 'write file'],
      commandTemplate: ':w',
      description: 'Save file in vim without exiting',
      category: 'text',
      placeholders: []
    },
    {
      naturalLanguage: ['pull and install', 'update dependencies', 'pull then install'],
      commandTemplate: 'git pull && npm install',
      description: 'Pull latest changes and install dependencies',
      category: 'git',
      placeholders: []
    },
    {
      naturalLanguage: ['create folder and cd', 'mkdir and enter', 'create and enter directory'],
      commandTemplate: 'mkdir {folder_name} && cd {folder_name}',
      description: 'Create a directory and change into it',
      category: 'file',
      placeholders: [
        { name: 'folder_name', description: 'Name of the folder to create', required: true }
      ]
    },
    {
      naturalLanguage: ['clean and build', 'clean then build', 'rebuild project'],
      commandTemplate: 'npm run clean && npm run build',
      description: 'Clean build artifacts and rebuild the project',
      category: 'npm',
      placeholders: []
    },
    {
      naturalLanguage: ['docker build and run', 'build then run docker', 'docker build and start'],
      commandTemplate: 'docker build -t {image_name} . && docker run -d --name {container_name} {image_name}',
      description: 'Build Docker image and run container',
      category: 'docker',
      placeholders: [
        { name: 'image_name', description: 'Name for the Docker image', required: true },
        { name: 'container_name', description: 'Name for the container', required: true }
      ]
    },
    {
      naturalLanguage: ['stop and remove container', 'stop then delete container'],
      commandTemplate: 'docker stop {container_name} && docker rm {container_name}',
      description: 'Stop and remove a Docker container',
      category: 'docker',
      placeholders: [
        { name: 'container_name', description: 'Container name or ID', required: true }
      ]
    }
  ];
}

export async function addCommand(command: Omit<DatabaseCommand, 'id' | 'createdAt' | 'updatedAt'>): Promise<DatabaseCommand> {
  const database = await getDatabase();
  
  const result = database.prepare(`
    INSERT INTO commands (natural_language, command_template, description, category, placeholders)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    JSON.stringify(command.naturalLanguage),
    command.commandTemplate,
    command.description,
    command.category,
    JSON.stringify(command.placeholders)
  );
  
  return {
    ...command,
    id: Number(result.lastInsertRowid),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export async function getAllCommands(): Promise<DatabaseCommand[]> {
  const database = await getDatabase();
  
  const rows = database.prepare('SELECT * FROM commands ORDER BY category, id').all() as any[];
  
  return rows.map(row => ({
    id: row.id,
    naturalLanguage: JSON.parse(row.natural_language),
    commandTemplate: row.command_template,
    description: row.description,
    category: row.category,
    placeholders: JSON.parse(row.placeholders || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function findCommandsByCategory(category: string): Promise<DatabaseCommand[]> {
  const database = await getDatabase();
  
  const rows = database.prepare('SELECT * FROM commands WHERE category = ? ORDER BY id').all(category) as any[];
  
  return rows.map(row => ({
    id: row.id,
    naturalLanguage: JSON.parse(row.natural_language),
    commandTemplate: row.command_template,
    description: row.description,
    category: row.category,
    placeholders: JSON.parse(row.placeholders || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function updateCommand(id: number, updates: Partial<Omit<DatabaseCommand, 'id' | 'createdAt'>>): Promise<DatabaseCommand | null> {
  const database = await getDatabase();
  
  const existing = database.prepare('SELECT * FROM commands WHERE id = ?').get(id) as any;
  if (!existing) return null;
  
  const naturalLanguage = updates.naturalLanguage ? JSON.stringify(updates.naturalLanguage) : existing.natural_language;
  const placeholders = updates.placeholders ? JSON.stringify(updates.placeholders) : existing.placeholders;
  
  database.prepare(`
    UPDATE commands 
    SET natural_language = ?, 
        command_template = COALESCE(?, command_template), 
        description = COALESCE(?, description), 
        category = COALESCE(?, category), 
        placeholders = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    naturalLanguage,
    updates.commandTemplate,
    updates.description,
    updates.category,
    placeholders,
    id
  );
  
  return getCommandById(id);
}

export async function deleteCommand(id: number): Promise<boolean> {
  const database = await getDatabase();
  
  const result = database.prepare('DELETE FROM commands WHERE id = ?').run(id);
  return result.changes > 0;
}

export async function getCommandById(id: number): Promise<DatabaseCommand | null> {
  const database = await getDatabase();
  
  const row = database.prepare('SELECT * FROM commands WHERE id = ?').get(id) as any;
  if (!row) return null;
  
  return {
    id: row.id,
    naturalLanguage: JSON.parse(row.natural_language),
    commandTemplate: row.command_template,
    description: row.description,
    category: row.category,
    placeholders: JSON.parse(row.placeholders || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function searchCommands(query: string): Promise<DatabaseCommand[]> {
  const database = await getDatabase();
  
  const searchPattern = `%${query.toLowerCase()}%`;
  
  const rows = database.prepare(`
    SELECT * FROM commands 
    WHERE LOWER(natural_language) LIKE ? 
       OR LOWER(command_template) LIKE ? 
       OR LOWER(description) LIKE ?
       OR LOWER(category) LIKE ?
    ORDER BY category, id
  `).all(searchPattern, searchPattern, searchPattern, searchPattern) as any[];
  
  return rows.map(row => ({
    id: row.id,
    naturalLanguage: JSON.parse(row.natural_language),
    commandTemplate: row.command_template,
    description: row.description,
    category: row.category,
    placeholders: JSON.parse(row.placeholders || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    db.close();
    db = null;
  }
}
