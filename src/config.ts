import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import type { Config, CommandMapping } from './types.js';
import { printSuccess, printError, printInfo } from './utils.js';

const CONFIG_DIR = path.join(os.homedir(), '.nl-terminal-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export async function initConfig(): Promise<void> {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    
    const defaultConfig: Config = {
      schemaVersion: 1,
      version: '0.0.1',
      defaultShell: process.env.SHELL || '/bin/bash',
      menuStyle: 'list',
      mappings: [
        {
          id: '1',
          naturalLanguage: 'list all files',
          command: 'ls -la',
          description: 'List all files in current directory',
          tags: ['files', 'list'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: '2',
          naturalLanguage: 'show current directory',
          command: 'pwd',
          description: 'Show current working directory',
          tags: ['directory', 'path'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: '3',
          naturalLanguage: 'show git status',
          command: 'git status',
          description: 'Show git repository status',
          tags: ['git', 'status'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      settings: {
        confirmBeforeExecute: true,
        saveHistory: true,
        fuzzyMatchThreshold: 0.6,
        maxResults: 10,
        enableAutocomplete: true,
        preferredEditor: undefined,
        gitPlatform: 'auto'
      }
    };
    
    await fs.writeFile(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
    printSuccess(`Configuration initialized at ${chalk.cyan(CONFIG_FILE)}`);
  } catch (error) {
    printError(`Failed to initialize configuration: ${error}`);
    throw error;
  }
}

export async function getConfig(): Promise<Config> {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(data) as Config;
    
    // Merge with defaults to ensure all settings exist
    const defaults: Config['settings'] = {
      confirmBeforeExecute: true,
      saveHistory: true,
      fuzzyMatchThreshold: 0.6,
      maxResults: 10,
      enableAutocomplete: true,
      preferredEditor: undefined,
      gitPlatform: 'auto'
    };
    
    config.settings = { ...defaults, ...config.settings };

    let changed = false;
    if (typeof config.schemaVersion !== 'number') {
      config.schemaVersion = 1;
      changed = true;
    }
    if (config.version !== '0.0.1') {
      config.version = '0.0.1';
      changed = true;
    }
    if (changed) {
      await saveConfig(config);
    }
    
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      printInfo('Configuration not found. Creating default configuration...');
      await initConfig();
      return getConfig();
    }
    throw error;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    printError(`Failed to save configuration: ${error}`);
    throw error;
  }
}

export async function getMappings(): Promise<CommandMapping[]> {
  const config = await getConfig();
  return config.mappings;
}

export async function addMapping(mapping: Omit<CommandMapping, 'id' | 'createdAt' | 'updatedAt'>): Promise<CommandMapping> {
  const config = await getConfig();
  
  const newMapping: CommandMapping = {
    ...mapping,
    id: Date.now().toString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  config.mappings.push(newMapping);
  await saveConfig(config);
  
  printSuccess(`Mapping added: "${chalk.cyan(mapping.naturalLanguage)}" → ${chalk.yellow(mapping.command)}`);
  return newMapping;
}

export async function updateMapping(id: string, updates: Partial<CommandMapping>): Promise<CommandMapping | null> {
  const config = await getConfig();
  const index = config.mappings.findIndex(m => m.id === id);
  
  if (index === -1) {
    printError(`Mapping with id ${id} not found`);
    return null;
  }
  
  config.mappings[index] = {
    ...config.mappings[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };
  
  await saveConfig(config);
  printSuccess(`Mapping updated successfully`);
  return config.mappings[index];
}

export async function deleteMapping(id: string): Promise<boolean> {
  const config = await getConfig();
  const index = config.mappings.findIndex(m => m.id === id);
  
  if (index === -1) {
    printError(`Mapping with id ${id} not found`);
    return false;
  }
  
  const deleted = config.mappings.splice(index, 1)[0];
  await saveConfig(config);
  
  printSuccess(`Mapping deleted: "${chalk.cyan(deleted.naturalLanguage)}"`);
  return true;
}

export async function configExists(): Promise<boolean> {
  try {
    await fs.access(CONFIG_FILE);
    return true;
  } catch {
    return false;
  }
}

export async function resetConfig(): Promise<void> {
  try {
    await fs.unlink(CONFIG_FILE);
    await initConfig();
    printSuccess('Configuration reset to defaults');
  } catch (error) {
    printError(`Failed to reset configuration: ${error}`);
    throw error;
  }
}

export async function saveMenuStyle(style: 'expand' | 'list'): Promise<void> {
  try {
    const config = await getConfig();
    config.menuStyle = style;
    await saveConfig(config);
    printSuccess(`Menu style saved: ${chalk.cyan(style)}`);
  } catch (error) {
    printError(`Failed to save menu style: ${error}`);
    throw error;
  }
}
