import { spawn } from 'child_process';
import chalk from 'chalk';
import * as shellQuote from 'shell-quote';
import type { ExecutionResult, CommandMapping } from './types.js';
import { getInquirer, getOra } from './lazy-modules.js';

// Type for ora spinner
type Ora = Awaited<ReturnType<typeof getOra>>['default'];
type OraSpinner = ReturnType<Ora>;

/**
 * Gets the appropriate shell for the current platform
 * @returns Shell command and args for spawn
 */
export function getShell(): { shell: string; args: string[] } {
  const platform = getPlatform();
  
  if (platform === 'windows') {
    // Use PowerShell on Windows if available, otherwise cmd.exe
    return {
      shell: process.env.COMSPEC || 'cmd.exe',
      args: ['/c']
    };
  }
  
  // Unix-like systems (Linux, macOS)
  return {
    shell: process.env.SHELL || '/bin/bash',
    args: ['-c']
  };
}

export async function executeInTerminal(command: string, shell?: string): Promise<ExecutionResult> {
  const oraModule = await getOra();
  const spinner = oraModule.default('Executing command...').start();
  
  return new Promise((resolve) => {
    const shellConfig = shell ? { shell, args: getShell().args } : getShell();
    const args = [...shellConfig.args, command];
    
    const child = spawn(shellConfig.shell, args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      cwd: process.cwd()
    });
    
    let output = '';
    let error = '';
    
    child.stdout?.on('data', (data) => {
      output += data.toString();
    });
    
    child.stderr?.on('data', (data) => {
      error += data.toString();
    });
    
    child.on('close', (code) => {
      spinner.stop();
      
      resolve({
        success: code === 0,
        output: output.trim(),
        error: error.trim() || undefined,
        exitCode: code || 0
      });
    });
    
    child.on('error', (err) => {
      spinner.stop();
      
      resolve({
        success: false,
        output: '',
        error: err.message,
        exitCode: 1
      });
    });
  });
}

export async function promptInput(message: string, defaultValue?: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return defaultValue || '';
  }
  if (process.env.NL_TERMINAL_CLI_ASSUME_YES === '1' && defaultValue !== undefined) {
    return defaultValue;
  }
  const fullMessage = defaultValue
    ? `${message} (Press Tab to use default)`
    : message;
  
  const inquirer = await getInquirer();
  const { answer } = await inquirer.default.prompt([{
    type: 'input',
    name: 'answer',
    message: chalk.blue(fullMessage),
    default: defaultValue,
    prefix: chalk.cyan('◇')
  }]);
  
  return answer.trim() || defaultValue || '';
}

export async function promptConfirm(message: string, defaultValue = true): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return defaultValue;
  }
  if (process.env.NL_TERMINAL_CLI_ASSUME_YES === '1') {
    return defaultValue;
  }
  const inquirer = await getInquirer();
  const { answer } = await inquirer.default.prompt([{
    type: 'confirm',
    name: 'answer',
    message: chalk.blue(message),
    default: defaultValue,
    prefix: '◇'
  }]);
  
  return answer;
}

// Navigation action types for menu system
export type NavigationAction = 'select' | 'back' | 'main' | null;

export interface MenuResult<T> {
  value: T | null;
  action: NavigationAction;
}

export function shouldUsePlainMenu(): boolean {
  const isBun = typeof (process as { versions?: { bun?: string } }).versions?.bun === 'string';
  const isTty = Boolean(process.stdout.isTTY && process.stdin.isTTY);
  return isBun || !isTty;
}

async function selectFromListFallback<T>(message: string, choices: { name: string; value: T }[]): Promise<T | null> {
  console.log(chalk.blue(message));
  choices.forEach((choice, index) => {
    console.log(`${index + 1}) ${choice.name}`);
  });

  const answer = await promptInput('Select option number:');
  const index = Number.parseInt(answer, 10) - 1;
  if (Number.isNaN(index) || index < 0 || index >= choices.length) {
    printWarning('Invalid selection.');
    return null;
  }

  return choices[index].value;
}

export async function selectFromList<T>(message: string, choices: { name: string; value: T }[], allowCancel = true, prefix = '◇'): Promise<T | null> {
  if (choices.length === 0) {
    printWarning('No menu options available.');
    return null;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    if (allowCancel) {
      return null;
    }
    return choices[0]?.value ?? null;
  }

  const choicesList = allowCancel 
    ? [...choices, { name: chalk.red('❌ Cancel / Back'), value: null as T }]
    : choices;

  if (shouldUsePlainMenu()) {
    return selectFromListFallback(message, choicesList);
  }
  
  const inquirer = await getInquirer();
  const { answer } = await inquirer.default.prompt([{
    type: 'list',
    name: 'answer',
    message: chalk.blue(message),
    choices: choicesList,
    prefix
  }]);
  
  return answer;
}

/**
 * Select from list with navigation controls for submenus
 * Returns both the selected value and navigation action
 */
export async function selectFromSubmenu<T>(
  message: string, 
  choices: { name: string; value: T; disabled?: boolean | string }[],
  allowBack = true,
  allowMainMenu = true
): Promise<MenuResult<T>> {
  const navigationChoices = [...choices];
  
  if (allowBack) {
    navigationChoices.push({ name: chalk.yellow('← Back'), value: '__back__' as unknown as T });
  }
  
  if (allowMainMenu) {
    navigationChoices.push({ name: chalk.red('❌ Main Menu'), value: '__main__' as unknown as T });
  }
  
  let answer: T | null = null;
  if (shouldUsePlainMenu()) {
    answer = await selectFromListFallback(message, navigationChoices);
  } else {
    const inquirer = await getInquirer();
    const promptAnswer = await inquirer.default.prompt([{
      type: 'list',
      name: 'answer',
      message: chalk.blue(message),
      choices: navigationChoices,
      prefix: '◇'
    }]);
    answer = promptAnswer.answer as T | null;
  }
  
  if (answer === '__back__') {
    return { value: null, action: 'back' };
  }
  
  if (answer === '__main__') {
    return { value: null, action: 'main' };
  }
  
  if (answer === null) {
    return { value: null, action: null };
  }
  
  return { value: answer, action: 'select' };
}

/**
 * Select from list using expand prompt with keyboard shortcuts
 * Each choice needs a single-character key for quick selection
 */
export async function selectFromExpand<T>(
  message: string,
  choices: { name: string; value: T; key: string }[],
  allowCancel = true
): Promise<T | null> {
  if (choices.length === 0) {
    printWarning('No menu options available.');
    return null;
  }

  const choicesList = allowCancel 
    ? [...choices, { name: chalk.red('Cancel / Back'), value: null as T, key: 'q' }]
    : choices;

  // For plain menu fallback, handle 'h' for help to show all options
  if (shouldUsePlainMenu()) {
    const showOptions = () => {
      console.log(chalk.blue(message));
      choicesList.forEach((choice) => {
        console.log(`  ${chalk.cyan(choice.key)}) ${choice.name}`);
      });
      console.log(`  ${chalk.cyan('h')}) ${chalk.gray('Help, list all options')}`);
    };
    
    showOptions();
    
    while (true) {
      const answer = await promptInput('Enter key:');
      const key = answer.toLowerCase().trim();
      
      if (key === 'h') {
        // Show all options again
        console.log('');
        showOptions();
        continue;
      }
      
      const selected = choicesList.find(c => c.key.toLowerCase() === key);
      if (!selected) {
        printWarning('Invalid selection. Press h for help.');
        continue;
      }
      return selected.value;
    }
  }
  
  const inquirer = await getInquirer();
  const { answer } = await inquirer.default.prompt([{
    type: 'expand',
    name: 'answer',
    message: chalk.blue(message),
    choices: choicesList,
    expanded: true,  // Show all options immediately without needing to press 'h'
    pageSize: 50,  // Large enough to show all options without pagination
    loop: false,
    prefix: '●'
  }]);
  
  return answer;
}

export async function promptEditor(message: string, defaultValue?: string): Promise<string> {
  const inquirer = await getInquirer();
  const { answer } = await inquirer.default.prompt([{
    type: 'editor',
    name: 'answer',
    message: chalk.blue(message),
    default: defaultValue,
    prefix: '◇'
  }]);
  
  return answer;
}

export function formatTable(data: Record<string, any>[]): string {
  if (data.length === 0) return '';
  
  const columns = Object.keys(data[0]);
  const colWidths: Record<string, number> = {};
  
  columns.forEach(col => {
    const maxContentWidth = Math.max(...data.map(row => String(row[col]).length));
    colWidths[col] = Math.max(maxContentWidth, col.length);
  });
  
  let table = '';
  
  // Header
  const header = columns.map(col => col.padEnd(colWidths[col])).join(' | ');
  table += header + '\n';
  table += columns.map(col => '-'.repeat(colWidths[col])).join('-+-') + '\n';
  
  // Rows
  data.forEach(row => {
    const rowStr = columns.map(col => String(row[col]).padEnd(colWidths[col])).join(' | ');
    table += rowStr + '\n';
  });
  
  return table;
}

export function printSuccess(message: string): void {
  console.log(chalk.green('✓ ' + message));
}

export function printError(message: string): void {
  console.log(chalk.red('✗ ' + message));
}

export function printInfo(message: string): void {
  console.log(chalk.blue('ℹ ' + message));
}

export function printWarning(message: string): void {
  console.log(chalk.yellow('⚠ ' + message));
}

export function setColorEnabled(enabled: boolean): void {
  if (!enabled) {
    chalk.level = 0;
  }
}

export function printSeparator(): void {
  console.log(chalk.gray('\n' + '─'.repeat(50) + '\n'));
}

export async function executeInteractive(command: string, shell?: string): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const shellCmd = shell || process.env.SHELL || '/bin/bash';
    const args = ['-c', command];
    
    console.log(chalk.gray(`$ ${command}`));
    
    const child = spawn(shellCmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });
    
    let output = '';
    let error = '';
    
    // Capture output
    child.stdout?.on('data', (data) => {
      output += data.toString();
    });
    
    child.stderr?.on('data', (data) => {
      error += data.toString();
    });
    
    child.on('close', (code) => {
      // Format and display output
      if (output) {
        const formatted = formatCommandOutput(command, output.trim());
        console.log(formatted);
      }
      
      if (error) {
        process.stderr.write(chalk.red(error));
      }
      
      resolve({
        success: code === 0,
        output: output.trim(),
        error: error.trim() || undefined,
        exitCode: code || 0
      });
    });
    
    child.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: err.message,
        exitCode: 1
      });
    });
  });
}

/**
 * Executes an interactive editor (vim, nano, fresh, etc.) with direct terminal access
 * This is needed for editors that require full terminal control
 */
export async function executeEditor(command: string, shell?: string): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const shellCmd = shell || process.env.SHELL || '/bin/bash';
    const args = ['-c', command];
    
    printInfo(`Opening editor: ${command}`);
    
    const child = spawn(shellCmd, args, {
      stdio: 'inherit', // Direct terminal access for interactive editors
      cwd: process.cwd()
    });
    
    child.on('close', (code) => {
      resolve({
        success: code === 0,
        output: '',
        error: undefined,
        exitCode: code || 0
      });
    });
    
    child.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: err.message,
        exitCode: 1
      });
    });
  });
}

/**
 * Formats command output nicely, especially for ls -la
 */
export function formatCommandOutput(command: string, output: string): string {
  // Check if this looks like ls -la output
  if (command.includes('ls') && (command.includes('-la') || command.includes('-l'))) {
    return formatLsOutput(output);
  }
  return output;
}

/**
 * Formats ls -la output in a nice table with colors
 */
function formatLsOutput(output: string): string {
  const lines = output.split('\n');
  const formattedLines: string[] = [];
  let hasAddedHeader = false;
  
  // Header with column names
  const header = `${chalk.bold('Permissions')} ${chalk.gray('Lnks')} ${chalk.bold.cyan('Owner')}    ${chalk.bold.cyan('Group')}    ${chalk.bold.yellow('Size')}    ${chalk.bold.gray('Modified Date')}       ${chalk.bold('Name')}`;
  const separator = chalk.gray('─'.repeat(80));
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    // Parse ls -la format: permissions links owner group size date name
    const match = line.match(/^( [\-dlcbsp][\-rwxsStT]{9})\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+\s+\S+\s+\S+)\s+(.+)$/);
    
    if (match) {
      // Add header before first file entry
      if (!hasAddedHeader) {
        formattedLines.push(header);
        formattedLines.push(separator);
        hasAddedHeader = true;
      }
      
      const [, perms, links, owner, group, size, date, name] = match;
      
      // Color the permissions
      const coloredPerms = colorPermissions(perms);
      
      // Color the name based on type
      const coloredName = colorFileName(name, perms[0]);
      
      // Format size nicely
      const formattedSize = formatFileSize(size);
      
      formattedLines.push(`${coloredPerms} ${chalk.gray(links.padStart(4))} ${chalk.cyan(owner.padEnd(10))} ${chalk.cyan(group.padEnd(10))} ${chalk.yellow(formattedSize.padStart(10))} ${chalk.gray(date.padEnd(20))} ${coloredName}`);
    } else if (line.startsWith('total')) {
      formattedLines.push(chalk.gray(line));
    } else {
      formattedLines.push(line);
    }
  }
  
  return formattedLines.join('\n');
}

/**
 * Colors permission string
 */
function colorPermissions(perms: string): string {
  let result = '';
  for (let i = 0; i < perms.length; i++) {
    const char = perms[i];
    if (i === 0) {
      // File type
      result += char === 'd' ? chalk.blue(char) : 
                char === 'l' ? chalk.cyan(char) :
                char === '-' ? chalk.gray(char) : chalk.magenta(char);
    } else if (char === 'r') {
      result += chalk.green(char);
    } else if (char === 'w') {
      result += chalk.yellow(char);
    } else if (char === 'x' || char === 's' || char === 'S' || char === 't' || char === 'T') {
      result += chalk.red(char);
    } else {
      result += chalk.gray(char);
    }
  }
  return result;
}

/**
 * Colors file name based on type
 */
function colorFileName(name: string, fileType: string): string {
  if (fileType === 'd') {
    return chalk.blue.bold(name);
  } else if (fileType === 'l') {
    // For symlinks, color the arrow gray and the target differently
    const parts = name.split(' -> ');
    if (parts.length === 2) {
      return chalk.cyan(parts[0]) + chalk.gray(' -> ') + chalk.cyan(parts[1]);
    }
    return chalk.cyan(name);
  } else if (name.endsWith('.zip') || name.endsWith('.tar') || name.endsWith('.gz') || name.endsWith('.bz2') || name.endsWith('.7z') || name.endsWith('.rar')) {
    return chalk.red(name);
  } else if (name.endsWith('.js') || name.endsWith('.ts') || name.endsWith('.jsx') || name.endsWith('.tsx')) {
    return chalk.yellow(name);
  } else if (name.endsWith('.json') || name.endsWith('.md') || name.endsWith('.txt')) {
    return chalk.white(name);
  } else if (name.endsWith('.py') || name.endsWith('.rb') || name.endsWith('.php')) {
    return chalk.green(name);
  } else if (name.endsWith('.sh') || name.endsWith('.bash') || name.endsWith('.zsh')) {
    return chalk.magenta(name);
  } else if (name.endsWith('.html') || name.endsWith('.css') || name.endsWith('.scss')) {
    return chalk.cyan(name);
  } else if (name.startsWith('.')) {
    return chalk.gray(name);
  }
  return chalk.white(name);
}

/**
 * Formats file size nicely (converts bytes to human readable)
 */
function formatFileSize(size: string): string {
  const num = parseInt(size);
  if (isNaN(num)) return size;
  
  if (num >= 1073741824) {
    return (num / 1073741824).toFixed(1) + 'G';
  } else if (num >= 1048576) {
    return (num / 1048576).toFixed(1) + 'M';
  } else if (num >= 1024) {
    return (num / 1024).toFixed(1) + 'K';
  }
  return size;
}

/**
 * Checks if an editor is installed by running `which` (Unix) or `where` (Windows) command
 * @param editorName - The name of the editor to check (e.g., 'vim', 'nano', 'cat')
 * @returns Promise<boolean> - True if installed, false otherwise
 */
export async function checkEditorInstalled(editorName: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Use 'where' on Windows, 'which' on Unix-like systems
    const command = getPlatform() === 'windows' ? 'where' : 'which';
    const child = spawn(command, [editorName], {
      stdio: 'pipe'
    });
    
    child.on('close', (code) => {
      resolve(code === 0);
    });
    
    child.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Gets the current platform
 * @returns 'linux' | 'mac' | 'windows' | 'unknown'
 */
export function getPlatform(): 'linux' | 'mac' | 'windows' | 'unknown' {
  const platform = process.platform;
  
  if (platform === 'linux') return 'linux';
  if (platform === 'darwin') return 'mac';
  if (platform === 'win32') return 'windows';
  
  return 'unknown';
}

export function clearScreen(banner?: string): void {
  // Clear terminal screen using ANSI escape codes
  process.stdout.write('\x1B[2J\x1B[0f');
  // Alternative for Windows/other terminals
  console.clear();
  
  // Re-print banner if provided
  if (banner) {
    console.log(banner);
  }
}

export async function openUrl(url: string): Promise<void> {
  const platform = process.platform;
  let command: string;
  
  if (platform === 'darwin') {
    command = `open "${url}"`;
  } else if (platform === 'linux') {
    command = `xdg-open "${url}"`;
  } else if (platform === 'win32') {
    command = `start "${url}"`;
  } else {
    console.log(chalk.gray('Please visit: ' + url));
    return;
  }
  
  try {
    await executeInTerminal(command);
  } catch {
    console.log(chalk.gray('Please visit: ' + url));
  }
}
