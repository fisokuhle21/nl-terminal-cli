import chalk from 'chalk';
import path from 'path';
import fs from 'fs/promises';
import { getConfig, getMappings, addMapping, updateMapping, deleteMapping, saveMenuStyle } from './config.js';
import { findBestMatch, findMultipleMatches, findBestMatchFromDatabase, findMultipleMatchesFromDatabase, parseCommand, parseUserMapping, replacePlaceholders, calculateSimilarity, detectCompoundCommand } from './matcher.js';
// Re-export for testing
export { detectCompoundCommand };
import { initDatabase, seedDatabase, getAllCommands, findCommandsByCategory, addCommand as addDbCommand, deleteCommand as deleteDbCommand, getDatabase } from './database.js';
import { getOra, getGlob } from './lazy-modules.js';
import {
  executeInTerminal,
  executeInteractive,
  executeEditor,
  formatTable,
  formatCommandOutput,
  promptInput,
  promptConfirm,
  selectFromList,
  selectFromExpand,
  selectFromSubmenu,
  printSuccess,
  printError,
  printInfo,
  printWarning,
  clearScreen,
  getPlatform,
  checkEditorInstalled,
  openUrl,
  shouldUsePlainMenu,
  type MenuResult,
  type NavigationAction
} from './utils.js';
import { banner } from './cli.js';
import type { CommandMapping, DatabaseCommand, DatabaseMatchResult, SearchOptions, ExecutionResult, Placeholder, ParsedUserMapping } from './types.js';
import { addToHistory, getRecentCommands, getAllSessions, searchHistory, exportHistory, clearHistory, deleteSession, formatHistoryEntry, formatHistoryEntryInline, reloadSession, CommandHistoryEntry, Session, getActiveSessions, switchActiveSession, createNewSession, getSessionInfo, closeSession, getCurrentActiveSessionId, initMultiSession, getSessionsOwnedByOtherTerminals, getActiveTerminals, getTerminalDisplayName, isSessionOwnedByCurrentTerminal, getSessionOwner, forceClaimSession, getTerminalId, TerminalInfo, TakeoverRequest, formatUTC, getSessionKey, getCurrentTerminalSessionKeys, verifySessionKey, takeoverSessionWithKey, createTakeoverRequest, getPendingTakeoverRequests, approveTakeoverRequest, denyTakeoverRequest, checkTakeoverRequestStatus, sessionEvents, checkSessionTakeover, detachSession } from './history.js';

// Menu style preference - loaded from config
let menuStyle: 'expand' | 'list' = 'list';

async function loadMenuStyle(): Promise<void> {
  try {
    const config = await getConfig();
    menuStyle = config.menuStyle || 'list';
  } catch {
    menuStyle = 'list';
  }
}

// Navigation stack for menu system
const menuStack: string[] = [];

function pushMenu(menuName: string): void {
  menuStack.push(menuName);
}

function popMenu(): string | undefined {
  return menuStack.pop();
}

function getCurrentMenu(): string | undefined {
  return menuStack[menuStack.length - 1];
}

function isAtMainMenu(): boolean {
  return menuStack.length === 0;
}

function clearMenuStack(): void {
  menuStack.length = 0;
}

/**
 * Check if a command is risky and prompt for confirmation if needed
 * Returns true if the command should proceed, false if cancelled
 */
async function checkRiskyCommandAndConfirm(command: string): Promise<boolean> {
  if (process.env.NL_TERMINAL_CLI_ASSUME_YES === '1') {
    return true;
  }

  const isRmCommand = /(?:^|\s|;|&&|\|\|)rm\s+/i.test(command);
  const isSudoCommand = /(?:^|\s|;|&&|\|\|)sudo\s+/i.test(command);
  const isOtherRisky = /(?:^|\s)(chmod\s+777|chown\s+-R|mkfs\.|dd\s+if=|:>\s*\/|>\s*\/dev\/sda|:\(\)\s*\{\s*:\s*\|\s*:\s*;\s*\}\s*;\s*:)/i.test(command);
  const isRisky = isRmCommand || isSudoCommand || isOtherRisky;

  if (!isRisky) {
    return true;
  }

  console.log('');
  console.log(chalk.red.bold('╔════════════════════════════════════════════════════════════╗'));
  console.log(chalk.red.bold('║                       ⚠️ WARNING ⚠️                        ║ '));
  console.log(chalk.red.bold('╚════════════════════════════════════════════════════════════╝'));
  
  if (isRmCommand) {
    console.log(chalk.red('🗑️  This command uses ') + chalk.red.bold('rm') + chalk.red(' which permanently deletes files.'));
    console.log(chalk.red('   Deleted files cannot be recovered from the trash!'));
  }
  
  if (isSudoCommand) {
    console.log(chalk.red('🔐 This command uses ') + chalk.red.bold('sudo') + chalk.red(' which runs with root privileges.'));
    console.log(chalk.red('   It can modify system files and settings!'));
  }
  
  if (isOtherRisky) {
    console.log(chalk.red('💀 This command can cause serious damage to your system.'));
  }
  
  console.log('');
  console.log(chalk.yellow('Command: ') + chalk.white(command));
  console.log('');
  
  const shouldProceed = await promptConfirm(chalk.red.bold('Are you absolutely sure you want to run this command?'), false);
  return shouldProceed;
}

// File extension mappings for natural language queries
const EXTENSION_MAPPINGS: Record<string, string[]> = {
  'typescript': ['.ts', '.tsx'],
  'ts': ['.ts', '.tsx'],
  'javascript': ['.js', '.jsx'],
  'js': ['.js', '.jsx'],
  'python': ['.py'],
  'py': ['.py'],
  'java': ['.java'],
  'html': ['.html', '.htm'],
  'htm': ['.html', '.htm'],
  'css': ['.css'],
  'scss': ['.scss'],
  'sass': ['.sass'],
  'json': ['.json'],
  'markdown': ['.md'],
  'md': ['.md'],
  'go': ['.go'],
  'golang': ['.go'],
  'rust': ['.rs'],
  'rs': ['.rs'],
  'php': ['.php'],
  'ruby': ['.rb'],
  'rb': ['.rb'],
  'c': ['.c', '.h'],
  'cpp': ['.cpp', '.hpp', '.cc', '.h'],
  'c++': ['.cpp', '.hpp', '.cc', '.h'],
  'csharp': ['.cs'],
  'c#': ['.cs'],
  'cs': ['.cs'],
  'swift': ['.swift'],
  'kotlin': ['.kt', '.kts'],
  'scala': ['.scala'],
  'r': ['.r'],
  'sql': ['.sql'],
  'yaml': ['.yaml', '.yml'],
  'yml': ['.yaml', '.yml'],
  'xml': ['.xml'],
  'dockerfile': ['Dockerfile'],
  'sh': ['.sh', '.bash'],
  'bash': ['.sh', '.bash'],
  'zsh': ['.zsh'],
  'fish': ['.fish'],
  'powershell': ['.ps1'],
  'ps1': ['.ps1'],
  'vim': ['.vim'],
  'lua': ['.lua'],
  'perl': ['.pl', '.pm'],
  'pl': ['.pl', '.pm'],
  'haskell': ['.hs'],
  'hs': ['.hs'],
  'clojure': ['.clj'],
  'clj': ['.clj'],
  'erlang': ['.erl'],
  'erl': ['.erl'],
  'elixir': ['.ex', '.exs'],
  'ex': ['.ex', '.exs'],
  'exs': ['.ex', '.exs'],
  'dart': ['.dart'],
  'flutter': ['.dart'],
  'julia': ['.jl'],
  'jl': ['.jl'],
  'matlab': ['.m'],
  'ocaml': ['.ml'],
  'ml': ['.ml'],
  'fsharp': ['.fs', '.fsx'],
  'fs': ['.fs', '.fsx'],
  'fsx': ['.fs', '.fsx'],
  'groovy': ['.groovy'],
  'gradle': ['.gradle'],
  'ini': ['.ini'],
  'toml': ['.toml'],
  'cfg': ['.cfg', '.conf', '.config'],
  'conf': ['.cfg', '.conf', '.config'],
  'config': ['.cfg', '.conf', '.config'],
  'log': ['.log'],
  'txt': ['.txt'],
  'csv': ['.csv'],
  'tsv': ['.tsv'],
  'pdf': ['.pdf'],
  'doc': ['.doc', '.docx'],
  'docx': ['.doc', '.docx'],
  'xls': ['.xls', '.xlsx'],
  'xlsx': ['.xls', '.xlsx'],
  'ppt': ['.ppt', '.pptx'],
  'pptx': ['.ppt', '.pptx'],
  'zip': ['.zip'],
  'tar': ['.tar', '.gz', '.tgz'],
  'gz': ['.gz', '.tgz'],
  'tgz': ['.gz', '.tgz'],
  'rar': ['.rar'],
  '7z': ['.7z'],
  'mp3': ['.mp3'],
  'mp4': ['.mp4'],
  'avi': ['.avi'],
  'mov': ['.mov'],
  'mkv': ['.mkv'],
  'jpg': ['.jpg', '.jpeg'],
  'jpeg': ['.jpg', '.jpeg'],
  'png': ['.png'],
  'gif': ['.gif'],
  'svg': ['.svg'],
  'ico': ['.ico'],
  'webp': ['.webp'],
  'bmp': ['.bmp'],
  'tiff': ['.tiff', '.tif'],
  'tif': ['.tiff', '.tif'],
  'wav': ['.wav'],
  'ogg': ['.ogg'],
  'flac': ['.flac'],
  'aac': ['.aac'],
  'wma': ['.wma'],
  'm4a': ['.m4a'],
  'webm': ['.webm'],
  'flv': ['.flv'],
  'wmv': ['.wmv'],
};

/**
 * Detects file extensions from a natural language search query
 * Returns the extension pattern if found, null otherwise
 */
function detectExtensionFromQuery(query: string): string | null {
  const queryLower = query.toLowerCase();
  
  // Check for explicit extension mentions like ".ts", ".js", etc.
  const explicitExtensionMatch = queryLower.match(/\.(\w+)\s*(?:files?|docs?)?/);
  if (explicitExtensionMatch) {
    const ext = explicitExtensionMatch[1].toLowerCase();
    // Check if this extension exists in our mappings
    for (const [key, extensions] of Object.entries(EXTENSION_MAPPINGS)) {
      if (key === ext) {
        return extensions[0]; // Return the primary extension
      }
    }
    // If not in mappings, return it as-is
    return `.${ext}`;
  }
  
  // Check for natural language mentions like "typescript files", "python files", etc.
  for (const [lang, extensions] of Object.entries(EXTENSION_MAPPINGS)) {
    // Match patterns like "typescript files", "typescript file", "ts files", etc.
    const pattern = new RegExp(`\\b${lang}\\s*(?:files?|docs?)?\\b`, 'i');
    if (pattern.test(queryLower)) {
      return extensions[0]; // Return the primary extension
    }
  }
  
  return null;
}

let isDatabaseInitialized = false;

async function ensureDatabase(): Promise<void> {
  if (!isDatabaseInitialized) {
    await initDatabase();
    await seedDatabase();
    isDatabaseInitialized = true;
  }
}

// Compound command detection patterns
const COMPOUND_SEPARATORS = [
  { pattern: /\s+and\s+/i, name: 'and' },
  { pattern: /\s+then\s+/i, name: 'then' },
  { pattern: /\s+after\s+that\s+/i, name: 'after that' },
  { pattern: /\s+followed\s+by\s+/i, name: 'followed by' },
  { pattern: /\s*;\s*/, name: ';' },
  { pattern: /\s*&&\s*/, name: '&&' },
  { pattern: /\s*&\s*/i, name: '&' }
];

interface CompoundSegment {
  input: string;
  match: CommandMapping | DatabaseMatchResult | null;
  resolvedCommand?: string;
  finalArgs?: Record<string, string>;
  success?: boolean;
  output?: string;
  error?: string;
}

interface ParsedCompoundCommand {
  segments: CompoundSegment[];
  originalInput: string;
  separatorUsed: string | null;
}

/**
 * Checks if input matches a compound command alias from user mappings
 */
function findCompoundAliasMatch(input: string, mappings: CommandMapping[]): CommandMapping | null {
  // Look for mappings that have compound commands (contain && or ; or multiple commands)
  const compoundAliases = mappings.filter(m => 
    m.command.includes(' && ') || 
    m.command.includes(';') || 
    m.command.includes(' || ')
  );
  
  // Find best match among compound aliases
  for (const mapping of compoundAliases) {
    const confidence = calculateSimilarity(input.toLowerCase(), mapping.naturalLanguage.toLowerCase());
    if (confidence >= 0.8) {
      return mapping;
    }
  }
  
  return null;
}

/**
 * Executes a compound command alias (single natural language phrase that maps to multiple commands)
 */
async function executeCompoundAlias(input: string, mapping: CommandMapping): Promise<void> {
  printInfo(`Executing compound alias: "${chalk.cyan(mapping.naturalLanguage)}"`);
  printInfo(`Command sequence: ${chalk.yellow(mapping.command)}`);
  if (mapping.description) {
    console.log(chalk.gray(`Description: ${mapping.description}`));
  }
  
  let commandToExecute = mapping.command;

  // Handle placeholders if they exist
  if (mapping.placeholders && mapping.placeholders.length > 0) {
    const parsed = parseUserMapping(input, mapping);
    
    // Prompt for missing required placeholders
    const finalArgs = { ...parsed.extractedArgs };
    for (const placeholder of parsed.missingPlaceholders) {
      const prompt = placeholder.description + (placeholder.defaultValue ? ` (default: ${placeholder.defaultValue})` : '');
      const value = await promptInput(prompt, placeholder.defaultValue);
      if (value || placeholder.defaultValue) {
        finalArgs[placeholder.name] = value || placeholder.defaultValue || '';
      }
    }
    
    // Replace placeholders in command
    commandToExecute = replacePlaceholders(mapping.command, finalArgs);
    printInfo(`Command with placeholders resolved: ${chalk.yellow(commandToExecute)}`);
  }
  
  if (process.env.NL_TERMINAL_CLI_DRY_RUN === '1') {
    printInfo(`[dry-run] ${commandToExecute}`);
    return;
  }

  if (process.env.NL_TERMINAL_CLI_ASSUME_YES !== '1') {
    const confirm = await promptConfirm('Execute this compound command?', true);
    if (!confirm) {
      printInfo('Cancelled');
      return;
    }
  }
  
  // Check for risky commands (rm, sudo, etc.) and prompt for confirmation
  const shouldProceed = await checkRiskyCommandAndConfirm(commandToExecute);
  if (!shouldProceed) {
    printInfo('Execution cancelled');
    return;
  }
  
  // Execute the compound command as a single command
  const config = await getConfig();
  const result = await executeInteractive(commandToExecute, config.defaultShell);
  
  // Add to history if saveHistory is enabled
  if (config.settings.saveHistory) {
    await addToHistory(
      mapping.naturalLanguage,
      mapping.command,
      result.success,
      result.exitCode,
      result.output,
      result.error,
      []
    );
  }
  
  if (result.success) {
    printSuccess('Compound command completed!');
  } else {
    printError(`Compound command failed with exit code ${result.exitCode}`);
  }
}

/**
 * Parses a compound command into individual segments
 */
export function parseCompoundCommand(input: string): ParsedCompoundCommand {
  // Find the first matching separator
  let separatorUsed: string | null = null;
  let segments: string[] = [input];
  
  for (const sep of COMPOUND_SEPARATORS) {
    if (sep.pattern.test(input)) {
      separatorUsed = sep.name;
      segments = input
        .split(sep.pattern)
        .map(s => s.trim())
        .filter(s => s.length > 0);
      break;
    }
  }
  
  // Clean up segments (remove trailing punctuation, but preserve standalone dots like in "git add .")
  segments = segments.map(s => {
    const trimmed = s.trim();
    // Only remove trailing punctuation if it's not a standalone dot preceded by a space (like "git add .")
    if (trimmed.endsWith(' .')) {
      return trimmed; // Preserve "git add ." style commands
    }
    return trimmed.replace(/[.!?;:]+$/, '').trim();
  });
  
  return {
    segments: segments.map(input => ({ input, match: null })),
    originalInput: input,
    separatorUsed
  };
}

/**
 * Matches each segment to a command from database or user mappings
 */
async function matchCompoundSegments(parsed: ParsedCompoundCommand): Promise<ParsedCompoundCommand> {
  const mappings = await getMappings();
  
  for (const segment of parsed.segments) {
    // Try database match first
    const dbMatch = await findBestMatchFromDatabase(segment.input);
    if (dbMatch && dbMatch.confidence >= 0.4) {
      segment.match = dbMatch;
    } else {
      // Fall back to user mappings
      const match = findBestMatch(segment.input, mappings);
      if (match.mapping && match.confidence >= 0.4) {
        segment.match = match.mapping;
      }
    }
  }
  
  return parsed;
}

/**
 * Resolves placeholders for a segment
 */
async function resolveSegmentPlaceholders(segment: CompoundSegment): Promise<CompoundSegment> {
  if (!segment.match) return segment;
  
  let commandTemplate: string;
  let placeholders: { name: string; description: string; required: boolean; defaultValue?: string }[] = [];
  let parsed: { command: DatabaseCommand; extractedArgs: Record<string, string>; missingPlaceholders: { name: string; description: string; required: boolean; defaultValue?: string }[] };
  
  if ('command' in segment.match && typeof segment.match.command === 'object') {
    // Database match
    const dbMatch = segment.match as DatabaseMatchResult;
    commandTemplate = dbMatch.command.commandTemplate;
    placeholders = dbMatch.command.placeholders;
    parsed = parseCommand(segment.input, dbMatch);
  } else {
    // User mapping
    const userMapping = segment.match as CommandMapping;
    commandTemplate = userMapping.command;
    parsed = {
      command: {
        id: 0,
        naturalLanguage: [],
        commandTemplate: userMapping.command,
        description: userMapping.description || '',
        category: 'custom',
        placeholders: [],
        createdAt: '',
        updatedAt: ''
      },
      extractedArgs: {},
      missingPlaceholders: []
    };
  }
  
  let finalArgs = { ...parsed.extractedArgs };
  
  // Handle missing required placeholders
  if (parsed.missingPlaceholders.length > 0) {
    console.log(chalk.yellow(`\n⚠️  Missing arguments for "${segment.input}":`));
    for (const placeholder of parsed.missingPlaceholders) {
      const prompt = placeholder.description + (placeholder.defaultValue ? ` (default: ${placeholder.defaultValue})` : '');
      const value = await promptInput(prompt, placeholder.defaultValue);
      if (value) {
        finalArgs[placeholder.name] = value;
      }
    }
  }
  
  const resolvedCommand = replacePlaceholders(commandTemplate, finalArgs);
  
  return {
    ...segment,
    resolvedCommand,
    finalArgs
  };
}

/**
 * Displays the parsed compound command breakdown
 */
function displayCompoundBreakdown(parsed: ParsedCompoundCommand): void {
  console.log(chalk.bold(`\n🔄 Detected ${parsed.segments.length} commands (separated by "${parsed.separatorUsed}"):\n`));
  
  const tableData = parsed.segments.map((segment, idx) => {
    const match = segment.match;
    let command = '❌ No match found';
    let status = chalk.red('⚠️');
    
    if (match) {
      if ('command' in match && typeof match.command === 'object') {
        // Database match
        const dbMatch = match as DatabaseMatchResult;
        command = dbMatch.command.commandTemplate;
        status = chalk.green('✓');
      } else {
        // User mapping
        const userMapping = match as CommandMapping;
        command = userMapping.command;
        status = chalk.green('✓');
      }
    }
    
    return {
      '#': idx + 1,
      'Input': segment.input,
      'Command': command,
      'Status': status
    };
  });
  
  console.log(formatTable(tableData));
}

export async function mainLoop(): Promise<void> {
  await ensureDatabase();
  await initMultiSession();
  await loadMenuStyle();
  if (process.env.NL_TERMINAL_CLI_TEST !== '1') {
    clearScreen(banner);
  }
  
  let running = true;
  
  // Track the session IDs we're currently using so we can detect takeover
  let trackedSessionIds: Set<string> = new Set(getActiveSessions());
  
  /**
   * Check if any of our sessions have been taken over by another terminal
   * Returns the session that was taken over and the new owner, or null if no takeover
   */
  async function checkForSessionTakeover(): Promise<{ sessionId: string; sessionName: string; newOwner: TerminalInfo } | null> {
    const currentSessionId = getCurrentActiveSessionId();
    if (!currentSessionId) return null;
    
    // Check if our current session was taken over
    const newOwner = await checkSessionTakeover(currentSessionId);
    if (newOwner) {
      const session = await getSessionInfo(currentSessionId);
      return {
        sessionId: currentSessionId,
        sessionName: session?.name || 'Unnamed',
        newOwner
      };
    }
    
    return null;
  }
  
  /**
   * Show the session lost screen when a session is taken over
   * Returns the action the user wants to take
   */
  async function showSessionLostScreen(sessionName: string, newOwner: TerminalInfo): Promise<'new' | 'reattach' | 'quit'> {
    if (process.env.NL_TERMINAL_CLI_TEST !== '1') {
      clearScreen(banner);
    }
    
    console.log(chalk.red.bold('\n⚠️  SESSION TAKEN OVER\n'));
    console.log(chalk.yellow(`Your session "${chalk.cyan(sessionName)}" has been taken over by another terminal.`));
    console.log(chalk.gray(`New owner: ${getTerminalDisplayName(newOwner)}\n`));
    console.log(chalk.gray('─────────────────────────────────────\n'));
    
    const action = await selectFromList<'new' | 'reattach' | 'quit'>(
      'What would you like to do?',
      [
        { name: chalk.green('➕ Start a new session') + chalk.gray(' - Create a fresh session'), value: 'new' },
        { name: chalk.blue('🔄 Reattach to another session') + chalk.gray(' - Switch to an existing session'), value: 'reattach' },
        { name: chalk.gray('❌ Quit') + chalk.gray(' - Exit the application'), value: 'quit' }
      ]
    );
    
    return action || 'quit';
  }
  
  /**
   * Handle session takeover: detach the session and show recovery options
   */
  async function handleSessionTakeover(takenOverSession: { sessionId: string; sessionName: string; newOwner: TerminalInfo }): Promise<boolean> {
    // Detach the taken over session from our active sessions
    detachSession(takenOverSession.sessionId);
    trackedSessionIds.delete(takenOverSession.sessionId);
    
    // Show the session lost screen
    const action = await showSessionLostScreen(takenOverSession.sessionName, takenOverSession.newOwner);
    
    switch (action) {
      case 'new':
        // Create a new session
        const name = await promptInput('Enter session name (optional):');
        const sessionId = await createNewSession(name || undefined);
        const session = await getSessionInfo(sessionId);
        trackedSessionIds.add(sessionId);
        printSuccess(`Created new session: ${chalk.cyan(session?.name || 'Unnamed')}`);
        if (process.env.NL_TERMINAL_CLI_TEST !== '1') {
          clearScreen(banner);
        }
        return true; // Continue running
        
      case 'reattach':
        // Show available sessions to reattach to
        const reattached = await reattachToSessionUI();
        if (reattached) {
          const newSessionId = getCurrentActiveSessionId();
          if (newSessionId) {
            trackedSessionIds.add(newSessionId);
          }
          if (process.env.NL_TERMINAL_CLI_TEST !== '1') {
            clearScreen(banner);
          }
          return true; // Continue running
        } else {
          // User cancelled or no sessions available, show menu again
          return await handleSessionTakeover(takenOverSession);
        }
        
      case 'quit':
      default:
        return false; // Stop running
    }
  }
  
  async function getSessionDisplayInfo(): Promise<{ info: string; pendingRequests: TakeoverRequest[] }> {
    const currentSessionId = getCurrentActiveSessionId();
    const pendingRequests = await getPendingTakeoverRequests();
    
    if (!currentSessionId) return { info: chalk.gray('No active session'), pendingRequests };
    
    const session = await getSessionInfo(currentSessionId);
    if (!session) return { info: chalk.gray('No active session'), pendingRequests };
    
    const activeCount = getActiveSessions().length;
    const cmdCount = session.commands.length;
    
    // Check for other terminals
    const otherTerminals = await getActiveTerminals();
    const otherCount = otherTerminals.length - 1; // Exclude current terminal
    
    let terminalInfo = '';
    if (otherCount > 0) {
      terminalInfo = chalk.yellow(` | ${otherCount} other terminal${otherCount !== 1 ? 's' : ''}`);
    }
    
    const info = `${chalk.cyan(session.name || 'Unnamed')} ${chalk.gray(`(${cmdCount} commands, ${activeCount} active session${activeCount !== 1 ? 's' : ''}${terminalInfo})`)}`;
    
    return { info, pendingRequests };
  }
  
  async function showMenu(): Promise<string | null> {
    const { info: sessionInfo, pendingRequests } = await getSessionDisplayInfo();
    
    console.log(chalk.gray(`\n💻 Current Session: ${sessionInfo}\n`));
    
    // Show pending takeover requests notification
    if (pendingRequests.length > 0) {
      console.log(chalk.red.bold(`📨 ${pendingRequests.length} pending takeover request${pendingRequests.length > 1 ? 's' : ''}!`));
      for (const request of pendingRequests) {
        const session = await getSessionInfo(request.sessionId);
        const terminals = await getActiveTerminals();
        const requestingTerminal = terminals.find(t => t.id === request.requestingTerminalId);
        const termName = requestingTerminal ? getTerminalDisplayName(requestingTerminal) : 'Unknown terminal';
        const expiresIn = Math.max(0, Math.round((new Date(request.expiresAt).getTime() - Date.now()) / 1000));
        console.log(chalk.yellow(`   • "${session?.name || 'Unnamed'}" requested by ${termName} (${expiresIn}s remaining)`));
      }
      console.log(chalk.gray(`   Go to Session Management > Takeover requests to respond\n`));
    }
    
    if (menuStyle === 'expand') {
      // Display shortcut hints in the same style as session info
      const shortcutLine1 = '(e)xecute | (s)earch | (l)ist | (m)appings | (b)uilt-in | (r)ecent';
      const shortcutLine2 = 'e(x)tras | (n)ew session | (c)lear | (t)oggle | (q)uit | (h)elp';
      console.log(chalk.gray(`Options: ${shortcutLine1}`));
      console.log(chalk.gray(`         ${shortcutLine2}\n`));
      
      // Expand style: single-key shortcuts for quick access
      const expandOptions = [
        { name: chalk.green('Execute a command') + chalk.gray(' - Type natural language to run'), value: 'execute', key: 'e' },
        { name: chalk.blue('Search for files') + chalk.gray(' - Find files by description'), value: 'search', key: 's' },
        { name: chalk.yellow('List saved commands') + chalk.gray(' - View your command mappings'), value: 'list', key: 'l' },
        { name: chalk.magenta('Configure mappings') + chalk.gray(' - Add/edit/delete commands'), value: 'config', key: 'm' },
        { name: chalk.cyan('Built-in commands') + chalk.gray(' - View pre-built command database'), value: 'database', key: 'b' },
        { name: chalk.green('Recent history') + chalk.gray(' - View and re-run previous commands'), value: 'history', key: 'r' },
        { name: chalk.red('Extras') + chalk.gray(' - Check editors and open installation guides'), value: 'install-editors', key: 'x' },
        { name: chalk.blue('New/Switch Session') + chalk.gray(' - Manage active sessions'), value: 'sessions', key: 'n' },
        { name: chalk.white('Clear screen') + chalk.gray(' - Clear terminal output'), value: 'clear', key: 'c' },
        { name: chalk.cyan('Toggle Menu Style') + chalk.gray(` - Current: ${menuStyle} view`), value: 'switch-style', key: 't' },
        { name: chalk.gray('Quit'), value: 'exit', key: 'q' }
      ];
      
      if (shouldUsePlainMenu()) {
        console.log(chalk.gray('Tip: Use a TTY terminal for interactive menus.'));
      }
      return await selectFromExpand<string>(chalk.blue('What would you like to do?'), expandOptions, false);
    } else {
      // List style: arrow-key navigation (same labels as expand style)
      const menuOptions = [
        { name: chalk.green('🚀 Execute a command') + chalk.gray(' - Type natural language to run'), value: 'execute' },
        { name: chalk.blue('🔍 Search for files') + chalk.gray(' - Find files by description'), value: 'search' },
        { name: chalk.yellow('📋 List saved commands') + chalk.gray(' - View your command mappings'), value: 'list' },
        { name: chalk.magenta('⚙️  Configure mappings') + chalk.gray(' - Add/edit/delete commands'), value: 'config' },
        { name: chalk.cyan('📚 Built-in commands') + chalk.gray(' - View pre-built command database'), value: 'database' },
        { name: chalk.green('📜 Recent history') + chalk.gray(' - View and re-run previous commands'), value: 'history' },
        { name: chalk.red('🔧 Extras') + chalk.gray(' - Check editors and open installation guides'), value: 'install-editors' },
        { name: chalk.blue('🔄 New/Switch Session') + chalk.gray(' - Manage active sessions'), value: 'sessions' },
        { name: chalk.white('🧹 Clear screen') + chalk.gray(' - Clear terminal output'), value: 'clear' },
        { name: chalk.cyan('🔄 Toggle Menu Style') + chalk.gray(` - Current: ${menuStyle} view`), value: 'switch-style' },
        { name: chalk.gray('❌ Quit'), value: 'exit' }
      ];
      
      if (shouldUsePlainMenu()) {
        console.log(chalk.gray('Tip: Use a TTY terminal for arrow-key menus.'));
      }
      return await selectFromList<string>(chalk.blue('What would you like to do?'), menuOptions, false, '●');
    }
  }
  
  while (running) {
    // Check for session takeover before showing the menu
    const takenOver = await checkForSessionTakeover();
    if (takenOver) {
      running = await handleSessionTakeover(takenOver);
      if (!running) break;
      continue; // Skip to next iteration with new session
    }
    
    // Check if we have no active session (shouldn't happen, but handle it)
    if (!getCurrentActiveSessionId()) {
      printWarning('No active session. Creating a new one...');
      const sessionId = await createNewSession('Default Session');
      trackedSessionIds.add(sessionId);
    }
    
    if (menuStack.length === 0) {
      console.log(chalk.gray('\n─────────────────────────────────────\n'));
    }
    
    const action = await showMenu();
    
    if (action === 'exit' || action === null) {
      const initialSessionCount = getActiveSessions().length;
      const currentSessionId = getCurrentActiveSessionId();
      
      if (!currentSessionId) {
        // No active session - just exit
        printInfo('Goodbye! 👋');
        running = false;
        break;
      }
      
      if (initialSessionCount === 1) {
        // Only one session - close it and exit
        await closeSession(currentSessionId);
        printInfo('Session closed. Goodbye! 👋');
        running = false;
        break;
      } else {
        // Multiple sessions - close current and continue
        // closeSession() will auto-switch to another active session
        await closeSession(currentSessionId);
        
        // Get the session we were switched to by closeSession()
        const switchedToSessionId = getCurrentActiveSessionId();
        
        if (switchedToSessionId) {
          const newSession = await getSessionInfo(switchedToSessionId);
          const newSessionName = newSession ? newSession.name : 'another session';
          printInfo(`Current session closed. Switched to: ${newSessionName}`);
          printInfo("Press 'q' again to exit or continue working...");
        } else {
          // Shouldn't happen if initialSessionCount > 1, but handle gracefully
          printInfo('Session closed. Goodbye! 👋');
          running = false;
          break;
        }
        // Don't set running = false - continue the loop
      }
    }
    
    switch (action) {
      case 'execute':
        await executeCommandFromMenu();
        break;
      case 'search':
        await searchFiles();
        break;
      case 'list':
        await listMappings();
        break;
      case 'config':
        await configureMappings();
        break;
      case 'database':
        await browseDatabase();
        break;
      case 'history':
        await browseHistory();
        break;
      case 'install-editors':
        await checkAndInstallEditors();
        break;
      case 'clear':
        if (process.env.NL_TERMINAL_CLI_TEST !== '1') {
          clearScreen(banner);
        }
        break;
      case 'switch-style':
        const newStyle = menuStyle === 'list' ? 'expand' : 'list';
        menuStyle = newStyle;
        await saveMenuStyle(newStyle);
        printSuccess(`Switched to ${menuStyle} view (saved to config)`);
        break;
      case 'sessions':
        await manageSessions();
        break;
    }
  }
}

async function executeCommandFromMenu(): Promise<void> {
  console.log(chalk.gray('💡 Tip: You can chain multiple commands using:'));
  console.log(chalk.gray('   "and", "then", "after that", "followed by", ";", "&&"'));
  console.log(chalk.gray('   Example: "create folder test and list files"\n'));
  
  const input = await promptInput(chalk.cyan('Enter your command in natural language:'));
  if (!input || !input.trim()) {
    printWarning('No command provided');
    return;
  }
  
  await executeCommand(input);
}

/**
 * Manage sessions: create, switch, view, and close sessions
 */
async function manageSessions(): Promise<void> {
  pushMenu('sessions');
  
  while (true) {
    // Check for pending takeover requests
    const pendingRequests = await getPendingTakeoverRequests();
    const requestNotification = pendingRequests.length > 0 
      ? chalk.red.bold(` [${pendingRequests.length} pending request${pendingRequests.length > 1 ? 's' : ''}]`)
      : '';
    
    const result = await selectFromSubmenu<string>('🔄 Session Management:', [
      { name: chalk.green('➕ Create new session') + chalk.gray(' - Start a fresh session'), value: 'create' },
      { name: chalk.blue('🔄 Switch to session') + chalk.gray(' - Change active session'), value: 'switch' },
      { name: chalk.cyan('📋 View active sessions') + chalk.gray(' - See all active sessions'), value: 'view' },
      { name: chalk.magenta('📁 View all sessions') + chalk.gray(' - Browse all saved sessions'), value: 'browse' },
      { name: chalk.yellow('🔁 Reload session') + chalk.gray(' - Resume a previous session'), value: 'reload' },
      { name: chalk.red('🗑️  Close session') + chalk.gray(' - End a specific session'), value: 'close' },
      { name: chalk.blue('🖥️  View other terminals') + chalk.gray(' - See sessions from other terminal windows'), value: 'terminals' },
      { name: chalk.yellow('🔀 Take over session') + chalk.gray(' - Claim a session from another terminal'), value: 'takeover' },
      { name: chalk.green('🔑 View session keys') + chalk.gray(' - Show keys for your sessions'), value: 'keys' },
      { name: chalk.red('📨 Takeover requests') + requestNotification + chalk.gray(' - Handle incoming requests'), value: 'requests' },
      { name: chalk.gray('🧹 Clean up sessions') + chalk.gray(' - Mark orphaned sessions as ended'), value: 'cleanup' }
    ]);
    
    if (result.action === 'back' || result.action === null) {
      popMenu();
      return;
    }
    
    if (result.action === 'main') {
      clearMenuStack();
      return;
    }
    
    if (result.action === 'select' && result.value) {
      switch (result.value) {
        case 'create':
          await createSessionUI();
          break;
        case 'switch':
          await switchSessionUI();
          break;
        case 'view':
          await viewActiveSessions();
          break;
        case 'browse':
          await browseSessions();
          break;
        case 'reload':
          await reloadSessionUI();
          break;
        case 'close':
          await closeSessionUI();
          break;
        case 'terminals':
          await viewOtherTerminals();
          break;
        case 'takeover':
          await takeOverSessionUI();
          break;
        case 'keys':
          await viewSessionKeysUI();
          break;
        case 'requests':
          await handleTakeoverRequestsUI();
          break;
        case 'cleanup':
          await cleanupOrphanedSessions();
          break;
      }
      if (isAtMainMenu()) {
        return;
      }
    }
  }
}

/**
 * UI for reattaching to a session after being disconnected
 * Shows only sessions that are available (not owned by other terminals)
 * Returns true if successfully reattached, false otherwise
 */
async function reattachToSessionUI(): Promise<boolean> {
  const allSessions = await getAllSessions();
  
  // Filter for available sessions (ended or not owned by other terminals)
  const availableSessions: { session: Session; status: string }[] = [];
  
  for (const session of allSessions) {
    const owner = await getSessionOwner(session.id);
    
    if (!owner) {
      // Session has no owner, it's available
      const status = session.endTime ? chalk.gray('(ended)') : chalk.green('(available)');
      availableSessions.push({ session, status });
    }
  }
  
  if (availableSessions.length === 0) {
    printWarning('No available sessions to reattach to.');
    const createNew = await promptConfirm('Would you like to create a new session?', true);
    if (createNew) {
      const name = await promptInput('Enter session name (optional):');
      await createNewSession(name || undefined);
      return true;
    }
    return false;
  }
  
  const choices = availableSessions.map(({ session, status }) => ({
    name: `${session.name || 'Unnamed'} ${status} - ${session.commands.length} commands`,
    value: session.id
  }));
  
  // Add option to create new session
  choices.push({
    name: chalk.green('➕ Create new session'),
    value: '__new__'
  });
  
  const selectedId = await selectFromList<string>('Select a session to reattach to:', choices);
  
  if (!selectedId) {
    return false;
  }
  
  if (selectedId === '__new__') {
    const name = await promptInput('Enter session name (optional):');
    await createNewSession(name || undefined);
    return true;
  }
  
  // Try to switch to the selected session
  const success = await switchActiveSession(selectedId);
  
  if (success) {
    const session = await getSessionInfo(selectedId);
    printSuccess(`Reattached to session: ${chalk.cyan(session?.name || 'Unnamed')}`);
    return true;
  } else {
    printError('Failed to reattach to session. It may have been taken by another terminal.');
    return false;
  }
}

async function createSessionUI(): Promise<void> {
  const name = await promptInput('Enter session name (optional):');
  const shared = await promptConfirm('Allow this session to be used by multiple terminals?', false);
  const sessionId = await createNewSession(name || undefined, shared);
  const session = await getSessionInfo(sessionId);
  
  if (session) {
    printSuccess(`Created new session: ${chalk.cyan(session.name || 'Unnamed')}`);
    console.log(chalk.gray(`Session ID: ${sessionId}`));
    if (shared) {
      console.log(chalk.gray('This session can be accessed from other terminal windows.'));
    } else {
      console.log(chalk.gray('This session is exclusive to this terminal window.'));
    }
    console.log(chalk.gray('New commands will be added to this session.'));
  }
}

async function switchSessionUI(): Promise<void> {
  const allSessions = await getAllSessions();
  const activeIds = getActiveSessions();
  const currentTerminalId = getTerminalId();
  
  // Show all sessions, highlighting active ones and showing ownership
  const choices: { name: string; value: string }[] = [];
  
  for (const session of allSessions.slice().reverse()) {
    const isActive = activeIds.includes(session.id);
    const isCurrent = session.id === getCurrentActiveSessionId();
    const cmdCount = session.commands.length;
    
    // Check ownership
    const isOwnedByCurrent = await isSessionOwnedByCurrentTerminal(session.id);
    const owner = await getSessionOwner(session.id);
    
    let status = chalk.gray('(ended)');
    let ownerInfo = '';
    
    if (isCurrent) {
      status = chalk.green('(current)');
    } else if (isActive) {
      status = chalk.yellow('(active)');
    } else if (owner && !isOwnedByCurrent) {
      // Session is owned by another terminal
      status = chalk.red('(in use)');
      ownerInfo = chalk.gray(` - ${getTerminalDisplayName(owner)}`);
    }
    
    choices.push({
      name: `${session.name || 'Unnamed'} ${status} - ${cmdCount} commands${ownerInfo}`,
      value: session.id
    });
  }
  
  const selectedId = await selectFromList<string>('Select session to switch to:', choices);
  
  if (selectedId && selectedId.trim()) {
    // Check if session is owned by another terminal
    const isOwnedByCurrent = await isSessionOwnedByCurrentTerminal(selectedId);
    const owner = await getSessionOwner(selectedId);
    
    if (owner && !isOwnedByCurrent) {
      const termName = getTerminalDisplayName(owner);
      const session = await getSessionInfo(selectedId);
      
      printWarning(`This session is currently in use by ${termName}`);
      
      // Offer takeover options
      const takeoverMethod = await selectFromList<string>(
        'How would you like to take over this session?',
        [
          { name: chalk.green('🔑 Enter session key') + chalk.gray(' - Use key from the other terminal'), value: 'key' },
          { name: chalk.blue('📨 Request approval') + chalk.gray(' - Ask the other terminal to approve'), value: 'request' },
          { name: chalk.gray('Cancel'), value: 'cancel' }
        ]
      );
      
      if (takeoverMethod === 'cancel' || !takeoverMethod) {
        return;
      }
      
      if (takeoverMethod === 'key') {
        console.log(chalk.gray('\nTo get the session key, go to the other terminal and select:'));
        console.log(chalk.gray('  Session Management > View session keys\n'));
        
        const providedKey = await promptInput('Enter the 8-character session key:');
        
        if (!providedKey || providedKey.trim().length === 0) {
          printWarning('No key provided');
          return;
        }
        
        const success = await takeoverSessionWithKey(selectedId, providedKey.trim());
        
        if (success) {
          const switchSuccess = await switchActiveSession(selectedId);
          if (switchSuccess) {
            printSuccess(`Took over and switched to session: ${chalk.cyan(session?.name || 'Unnamed')}`);
            
            const newKey = await getSessionKey(selectedId);
            if (newKey) {
              console.log(chalk.gray(`\nYour new session key: ${chalk.yellow.bold(newKey)}`));
            }
          } else {
            printError('Session ownership transferred but failed to switch to it');
          }
        } else {
          printError('Invalid session key. Please check the key and try again.');
        }
      } else if (takeoverMethod === 'request') {
        printInfo('Sending takeover request to the other terminal...');
        
        const request = await createTakeoverRequest(selectedId);
        
        if (!request) {
          printError('Failed to create takeover request');
          return;
        }
        
        console.log(chalk.gray('\nRequest sent! The other terminal must approve within 60 seconds.'));
        console.log(chalk.gray('Waiting for response...\n'));
        
        const startTime = Date.now();
        const timeout = 60000;
        
        while (Date.now() - startTime < timeout) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          const status = await checkTakeoverRequestStatus(request.id);
          
          if (!status) {
            printError('Request was removed or expired');
            return;
          }
          
          if (status.status === 'approved') {
            printSuccess('Request approved!');
            
            const switchSuccess = await switchActiveSession(selectedId);
            if (switchSuccess) {
              printSuccess(`Took over and switched to session: ${chalk.cyan(session?.name || 'Unnamed')}`);
              
              const newKey = await getSessionKey(selectedId);
              if (newKey) {
                console.log(chalk.gray(`\nYour new session key: ${chalk.yellow.bold(newKey)}`));
              }
            }
            return;
          }
          
          if (status.status === 'denied') {
            printError('Request was denied by the other terminal');
            return;
          }
          
          if (status.status === 'expired') {
            printWarning('Request expired - no response from the other terminal');
            return;
          }
          
          process.stdout.write('.');
        }
        
        printWarning('\nRequest timed out - no response from the other terminal');
      }
      return;
    }
    
    const success = await switchActiveSession(selectedId);
    if (success) {
      const session = await getSessionInfo(selectedId);
      printSuccess(`Switched to session: ${chalk.cyan(session?.name || 'Unnamed')}`);
    } else {
      printError('Failed to switch session');
    }
  }
}

async function viewActiveSessions(): Promise<void> {
  pushMenu('view-active-sessions');
  
  const activeIds = getActiveSessions();
  const currentId = getCurrentActiveSessionId();
  const currentTerminalId = getTerminalId();
  
  // Also get sessions from other terminals
  const sessionsFromOthers = await getSessionsOwnedByOtherTerminals();
  const allActiveSessionIds = new Set([...activeIds, ...sessionsFromOthers.map(s => s.sessionId)]);
  
  if (allActiveSessionIds.size === 0) {
    printWarning('No active sessions');
    popMenu();
    return;
  }
  
  console.log(chalk.bold(`\n📋 Active Sessions (${allActiveSessionIds.size}):\n`));
  
  // Show sessions owned by current terminal
  if (activeIds.length > 0) {
    console.log(chalk.cyan.bold('  This Terminal:'));
    for (const sessionId of activeIds) {
      const session = await getSessionInfo(sessionId);
      if (session) {
        const isCurrent = sessionId === currentId;
        const marker = isCurrent ? chalk.green('▶ ') : chalk.gray('  ');
        const name = isCurrent ? chalk.cyan.bold(session.name || 'Unnamed') : chalk.cyan(session.name || 'Unnamed');
        console.log(`  ${marker}${name} ${chalk.gray(`(${session.commands.length} commands)`)}`);
      }
    }
  }
  
  // Show sessions from other terminals
  if (sessionsFromOthers.length > 0) {
    console.log('');
    console.log(chalk.yellow.bold('  Other Terminals:'));
    for (const { sessionId, terminal } of sessionsFromOthers) {
      const session = await getSessionInfo(sessionId);
      if (session) {
        const termName = getTerminalDisplayName(terminal);
        console.log(`    ${chalk.gray('○ ')}${chalk.cyan(session.name || 'Unnamed')} ${chalk.gray(`(${session.commands.length} commands)`)} - ${chalk.yellow(termName)}`);
      }
    }
  }
  
  console.log(chalk.gray(`\nCurrent: ${chalk.cyan(currentId ? (await getSessionInfo(currentId))?.name || 'Unnamed' : 'None')}`));
  
  // Show navigation options
  const result = await selectFromSubmenu('', [], true, true);
  
  if (result.action === 'back' || result.action === null) {
    popMenu();
    return;
  }
  
  if (result.action === 'main') {
    clearMenuStack();
    return;
  }
}

async function closeSessionUI(): Promise<void> {
  const activeIds = getActiveSessions();
  const currentId = getCurrentActiveSessionId();
  
  if (activeIds.length === 0) {
    printWarning('No active sessions to close');
    return;
  }
  
  // Only show active sessions
  const choices = [];
  for (const sessionId of activeIds) {
    const session = await getSessionInfo(sessionId);
    if (session) {
      const isCurrent = sessionId === currentId;
      const marker = isCurrent ? chalk.green('(current) ') : '';
      choices.push({
        name: `${marker}${session.name || 'Unnamed'} - ${session.commands.length} commands`,
        value: sessionId
      });
    }
  }
  
  const selectedId = await selectFromList<string>('Select session to close:', choices);
  
  if (selectedId && selectedId.trim()) {
    if (selectedId === currentId && activeIds.length === 1) {
      const confirm = await promptConfirm(chalk.yellow('This is the only active session. Are you sure?'), false);
      if (!confirm) return;
    }
    
    const session = await getSessionInfo(selectedId);
    const success = await closeSession(selectedId);
    
    if (success) {
      printSuccess(`Closed session: ${chalk.cyan(session?.name || 'Unnamed')}`);
      if (selectedId === currentId) {
        const newCurrentId = getCurrentActiveSessionId();
        if (newCurrentId) {
          const newSession = await getSessionInfo(newCurrentId);
          printInfo(`Switched to: ${chalk.cyan(newSession?.name || 'Unnamed')}`);
        } else {
          printWarning('No active sessions remaining');
          const createNew = await promptConfirm('Create a new session?', true);
          if (createNew) {
            await createSessionUI();
          }
        }
      }
    } else {
      printError('Failed to close session');
    }
  }
}

/**
 * View sessions running in other terminal windows
 */
async function viewOtherTerminals(): Promise<void> {
  pushMenu('view-other-terminals');
  
  const terminals = await getActiveTerminals();
  const currentTerminalId = getTerminalId();
  const sessionsFromOthers = await getSessionsOwnedByOtherTerminals();
  
  console.log(chalk.bold(`\n🖥️  Active Terminals (${terminals.length}):\n`));
  
  if (terminals.length === 0) {
    printWarning('No active terminals found');
    popMenu();
    return;
  }
  
  // Group sessions by terminal
  const terminalSessions: Map<string, { terminal: TerminalInfo; sessions: string[] }> = new Map();
  
  for (const terminal of terminals) {
    terminalSessions.set(terminal.id, { terminal, sessions: [] });
  }
  
  for (const { sessionId, terminal } of sessionsFromOthers) {
    const entry = terminalSessions.get(terminal.id);
    if (entry) {
      entry.sessions.push(sessionId);
    }
  }
  
  // Display terminals
  for (const [termId, { terminal, sessions }] of terminalSessions) {
    const isCurrent = termId === currentTerminalId;
    const marker = isCurrent ? chalk.green('▶ ') : chalk.gray('  ');
    const termName = getTerminalDisplayName(terminal);
    const status = isCurrent ? chalk.green(' (this terminal)') : chalk.yellow(` (PID: ${terminal.pid})`);
    
    console.log(`${marker}${chalk.cyan(termName)}${status}`);
    console.log(chalk.gray(`     Shell: ${terminal.shell} | CWD: ${terminal.cwd}`));
    console.log(chalk.gray(`     Started: ${formatUTC(terminal.startTime)}`));
    
    if (sessions.length > 0) {
      console.log(chalk.gray(`     Sessions: ${sessions.length}`));
      for (const sessionId of sessions) {
        const session = await getSessionInfo(sessionId);
        if (session) {
          console.log(chalk.gray(`       • ${session.name || 'Unnamed'} (${session.commands.length} commands)`));
        }
      }
    }
    console.log('');
  }
  
  // Show navigation options
  const result = await selectFromSubmenu('', [], true, true);
  
  if (result.action === 'back' || result.action === null) {
    popMenu();
    return;
  }
  
  if (result.action === 'main') {
    clearMenuStack();
    return;
  }
}

/**
 * Take over a session from another terminal
 */
async function takeOverSessionUI(): Promise<void> {
  const sessionsFromOthers = await getSessionsOwnedByOtherTerminals();
  
  if (sessionsFromOthers.length === 0) {
    printWarning('No sessions from other terminals available to take over');
    return;
  }
  
  console.log(chalk.bold(`\n🔀 Sessions from Other Terminals:\n`));
  
  const choices: { name: string; value: { sessionId: string; terminal: TerminalInfo } }[] = [];
  
  for (const { sessionId, terminal } of sessionsFromOthers) {
    const session = await getSessionInfo(sessionId);
    if (session) {
      const termName = getTerminalDisplayName(terminal);
      choices.push({
        name: `${chalk.cyan(session.name || 'Unnamed')} ${chalk.gray(`(${session.commands.length} commands)`)} - ${chalk.yellow(termName)}`,
        value: { sessionId, terminal }
      });
    }
  }
  
  const selected = await selectFromList<{ sessionId: string; terminal: TerminalInfo }>(
    'Select a session to take over:',
    choices
  );
  
  if (!selected) {
    return;
  }
  
  const { sessionId, terminal } = selected;
  const session = await getSessionInfo(sessionId);
  const termName = getTerminalDisplayName(terminal);
  
  console.log(chalk.bold(`\n🔐 Session: ${chalk.cyan(session?.name || 'Unnamed')}`));
  console.log(chalk.gray(`Currently owned by: ${termName}\n`));
  
  // Show takeover options
  const takeoverMethod = await selectFromList<string>(
    'How would you like to take over this session?',
    [
      { name: chalk.green('🔑 Enter session key') + chalk.gray(' - Use key from the other terminal'), value: 'key' },
      { name: chalk.blue('📨 Request approval') + chalk.gray(' - Ask the other terminal to approve'), value: 'request' },
      { name: chalk.gray('Cancel'), value: 'cancel' }
    ]
  );
  
  if (takeoverMethod === 'cancel' || !takeoverMethod) {
    printInfo('Cancelled');
    return;
  }
  
  if (takeoverMethod === 'key') {
    // Session key takeover
    console.log(chalk.gray('\nTo get the session key, go to the other terminal and select:'));
    console.log(chalk.gray('  Session Management > View session keys\n'));
    
    const providedKey = await promptInput('Enter the 8-character session key:');
    
    if (!providedKey || providedKey.trim().length === 0) {
      printWarning('No key provided');
      return;
    }
    
    const keyTrimmed = providedKey.trim().toUpperCase();
    
    // Verify and take over with the key
    const success = await takeoverSessionWithKey(sessionId, keyTrimmed);
    
    if (success) {
      // Also add to active sessions locally
      const switchSuccess = await switchActiveSession(sessionId);
      if (switchSuccess) {
        printSuccess(`Successfully took over session: ${chalk.cyan(session?.name || 'Unnamed')}`);
        
        // Get the new session key
        const newKey = await getSessionKey(sessionId);
        if (newKey) {
          console.log(chalk.gray(`\nYour new session key: ${chalk.yellow.bold(newKey)}`));
          console.log(chalk.gray('Share this key with others if you want them to take over this session.'));
        }
      } else {
        printError('Session ownership transferred but failed to switch to it');
      }
    } else {
      printError('Invalid session key. Please check the key and try again.');
    }
  } else if (takeoverMethod === 'request') {
    // Request approval from the owning terminal
    printInfo('Sending takeover request to the other terminal...');
    
    const request = await createTakeoverRequest(sessionId);
    
    if (!request) {
      printError('Failed to create takeover request');
      return;
    }
    
    console.log(chalk.gray('\nRequest sent! The other terminal must approve within 60 seconds.'));
    console.log(chalk.gray('Waiting for response...\n'));
    
    // Poll for the request status
    const startTime = Date.now();
    const timeout = 60000; // 60 seconds
    
    while (Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Check every 2 seconds
      
      const status = await checkTakeoverRequestStatus(request.id);
      
      if (!status) {
        printError('Request was removed or expired');
        return;
      }
      
      if (status.status === 'approved') {
        printSuccess('Request approved!');
        
        // Switch to the session
        const switchSuccess = await switchActiveSession(sessionId);
        if (switchSuccess) {
          printSuccess(`Successfully took over session: ${chalk.cyan(session?.name || 'Unnamed')}`);
          
          // Get the new session key
          const newKey = await getSessionKey(sessionId);
          if (newKey) {
            console.log(chalk.gray(`\nYour new session key: ${chalk.yellow.bold(newKey)}`));
          }
        }
        return;
      }
      
      if (status.status === 'denied') {
        printError('Request was denied by the other terminal');
        return;
      }
      
      if (status.status === 'expired') {
        printWarning('Request expired - no response from the other terminal');
        return;
      }
      
      // Still pending, show a spinner dot
      process.stdout.write('.');
    }
    
    printWarning('\nRequest timed out - no response from the other terminal');
  }
}

/**
 * View session keys for sessions owned by the current terminal
 */
async function viewSessionKeysUI(): Promise<void> {
  pushMenu('view-session-keys');
  
  const sessionKeys = await getCurrentTerminalSessionKeys();
  const keyEntries = Object.entries(sessionKeys);
  
  if (keyEntries.length === 0) {
    printWarning('No sessions owned by this terminal');
    popMenu();
    return;
  }
  
  console.log(chalk.bold(`\n🔑 Your Session Keys:\n`));
  console.log(chalk.gray('Share these keys with other terminals to let them take over your sessions.\n'));
  
  for (const [sessionId, key] of keyEntries) {
    const session = await getSessionInfo(sessionId);
    if (session) {
      console.log(`  ${chalk.cyan(session.name || 'Unnamed')}`);
      console.log(`    Key: ${chalk.yellow.bold(key)}`);
      console.log(`    Commands: ${session.commands.length}`);
      console.log('');
    }
  }
  
  console.log(chalk.gray('─────────────────────────────────────'));
  console.log(chalk.gray('Note: Keys are regenerated when ownership changes.'));
  
  // Show navigation options
  const result = await selectFromSubmenu('', [], true, true);
  
  if (result.action === 'back' || result.action === null) {
    popMenu();
    return;
  }
  
  if (result.action === 'main') {
    clearMenuStack();
    return;
  }
}

/**
 * Handle incoming takeover requests
 * Shows requests as a list, and when approved, redirects to session recovery screen
 */
async function handleTakeoverRequestsUI(): Promise<void> {
  const pendingRequests = await getPendingTakeoverRequests();
  
  if (pendingRequests.length === 0) {
    printInfo('No pending takeover requests');
    return;
  }
  
  console.log(chalk.bold(`\n📨 Pending Takeover Requests (${pendingRequests.length}):\n`));
  
  // Build list of requests with info
  const choices: { name: string; value: { request: TakeoverRequest; session: Session | null; termName: string } | null }[] = [];
  
  for (const request of pendingRequests) {
    const session = await getSessionInfo(request.sessionId);
    const terminals = await getActiveTerminals();
    const requestingTerminal = terminals.find(t => t.id === request.requestingTerminalId);
    
    const termName = requestingTerminal 
      ? getTerminalDisplayName(requestingTerminal) 
      : 'Unknown terminal';
    
    const expiresIn = Math.max(0, Math.round((new Date(request.expiresAt).getTime() - Date.now()) / 1000));
    
    // Skip expired requests
    if (expiresIn <= 0) continue;
    
    choices.push({
      name: `${chalk.cyan(session?.name || 'Unnamed')} - requested by ${chalk.yellow(termName)} ${chalk.gray(`(${expiresIn}s remaining)`)}`,
      value: { request, session, termName }
    });
  }
  
  if (choices.length === 0) {
    printInfo('All pending requests have expired');
    return;
  }
  
  // Add cancel option
  choices.push({
    name: chalk.gray('Cancel - decide later'),
    value: null
  });
  
  const selected = await selectFromList<{ request: TakeoverRequest; session: Session | null; termName: string } | null>(
    'Select a request to handle:',
    choices
  );
  
  if (!selected) {
    return;
  }
  
  const { request, session, termName } = selected;
  
  console.log(chalk.bold(`\n📨 Request for: ${chalk.cyan(session?.name || 'Unnamed')}`));
  console.log(chalk.gray(`From: ${termName}\n`));
  
  const action = await selectFromList<string>(
    'What would you like to do?',
    [
      { name: chalk.green('✓ Approve') + chalk.gray(' - Let them take over the session'), value: 'approve' },
      { name: chalk.red('✗ Deny') + chalk.gray(' - Reject the request'), value: 'deny' },
      { name: chalk.gray('Cancel'), value: 'cancel' }
    ]
  );
  
  if (action === 'approve') {
    const success = await approveTakeoverRequest(request.id);
    if (success) {
      printSuccess(`Approved takeover request for "${session?.name || 'Unnamed'}"`);
      printInfo('The other terminal now has control of this session.');
      
      // Detach the session and show recovery screen
      detachSession(request.sessionId);
      
      // Show the session recovery screen
      await showSessionRecoveryScreen(session?.name || 'Unnamed', termName);
    } else {
      printError('Failed to approve request (it may have expired)');
    }
  } else if (action === 'deny') {
    const success = await denyTakeoverRequest(request.id);
    if (success) {
      printInfo(`Denied takeover request for "${session?.name || 'Unnamed'}"`);
    } else {
      printError('Failed to deny request (it may have expired)');
    }
  }
}

/**
 * Show the session recovery screen after approving a takeover or losing a session
 * Allows user to start new session, reattach to another, or quit
 */
async function showSessionRecoveryScreen(sessionName: string, newOwnerName: string): Promise<void> {
  if (process.env.NL_TERMINAL_CLI_TEST !== '1') {
    clearScreen(banner);
  }
  
  console.log(chalk.yellow.bold('\n🔄 SESSION TRANSFERRED\n'));
  console.log(chalk.gray(`Session "${chalk.cyan(sessionName)}" is now controlled by ${newOwnerName}.\n`));
  console.log(chalk.gray('─────────────────────────────────────\n'));
  
  // Check if we have other active sessions
  const remainingSessions = getActiveSessions();
  
  if (remainingSessions.length > 0) {
    // We still have other sessions, just inform the user
    const currentSessionId = getCurrentActiveSessionId();
    if (currentSessionId) {
      const currentSession = await getSessionInfo(currentSessionId);
      printInfo(`You still have ${remainingSessions.length} active session${remainingSessions.length > 1 ? 's' : ''}.`);
      printInfo(`Current session: ${chalk.cyan(currentSession?.name || 'Unnamed')}`);
    }
    return;
  }
  
  // No remaining sessions, show recovery options
  const action = await selectFromList<'new' | 'reattach' | 'quit'>(
    'What would you like to do?',
    [
      { name: chalk.green('➕ Start a new session') + chalk.gray(' - Create a fresh session'), value: 'new' },
      { name: chalk.blue('🔄 Reattach to another session') + chalk.gray(' - Switch to an existing session'), value: 'reattach' },
      { name: chalk.gray('❌ Quit') + chalk.gray(' - Exit the application'), value: 'quit' }
    ]
  );
  
  switch (action) {
    case 'new':
      const name = await promptInput('Enter session name (optional):');
      const sessionId = await createNewSession(name || undefined);
      const session = await getSessionInfo(sessionId);
      printSuccess(`Created new session: ${chalk.cyan(session?.name || 'Unnamed')}`);
      if (process.env.NL_TERMINAL_CLI_TEST !== '1') {
        clearScreen(banner);
      }
      break;
      
    case 'reattach':
      const reattached = await reattachToSessionUI();
      if (!reattached) {
        // If reattach failed, recursively show recovery screen
        await showSessionRecoveryScreen(sessionName, newOwnerName);
      } else {
        if (process.env.NL_TERMINAL_CLI_TEST !== '1') {
          clearScreen(banner);
        }
      }
      break;
      
    case 'quit':
    default:
      printInfo('Goodbye! 👋');
      process.exit(0);
  }
}

/**
 * Clean up orphaned sessions - mark sessions without owners as ended
 */
async function cleanupOrphanedSessions(): Promise<void> {
  const sessions = await getAllSessions();
  const activeIds = getActiveSessions();
  
  // Find orphaned sessions: no endTime, not active in current terminal, and no owner
  const orphanedSessions: Session[] = [];
  
  for (const session of sessions) {
    if (!session.endTime && !activeIds.includes(session.id)) {
      const owner = await getSessionOwner(session.id);
      if (!owner) {
        orphanedSessions.push(session);
      }
    }
  }
  
  if (orphanedSessions.length === 0) {
    printInfo('No orphaned sessions found. All sessions have proper status.');
    return;
  }
  
  console.log(chalk.bold(`\n🧹 Found ${orphanedSessions.length} orphaned session(s):\n`));
  
  for (const session of orphanedSessions) {
    const date = formatUTC(session.startTime);
    console.log(`  • ${chalk.cyan(session.name || 'Unnamed')} - ${session.commands.length} commands - ${date}`);
  }
  
  console.log('');
  
  const confirm = await promptConfirm(
    chalk.yellow(`Mark ${orphanedSessions.length} session(s) as ended?`),
    true
  );
  
  if (confirm) {
    let cleanedCount = 0;
    
    for (const session of orphanedSessions) {
      // Mark session as ended
      const allSessions = await getAllSessions();
      const targetSession = allSessions.find(s => s.id === session.id);
      if (targetSession && !targetSession.endTime) {
        targetSession.endTime = new Date().toISOString();
        // Save directly to file
        const fs = await import('fs/promises');
        const os = await import('os');
        const path = await import('path');
        const sessionsFile = path.join(os.homedir(), '.nl-terminal-cli', 'sessions.json');
        await fs.writeFile(sessionsFile, JSON.stringify(allSessions, null, 2));
        cleanedCount++;
      }
    }
    
    printSuccess(`Cleaned up ${cleanedCount} orphaned session(s)`);
  } else {
    printInfo('Cleanup cancelled');
  }
}

export async function executeCommand(commandArg?: string): Promise<void> {
  await ensureDatabase();
  
  try {
    let input = commandArg;
    if (!input || !input.trim()) {
      printWarning('No command provided');
      return;
    }
    
    printInfo(`Looking for matches for: "${chalk.cyan(input)}"`);
    
    // First, check for compound command aliases (saved multi-command mappings)
    const config = await getConfig();
    const mappings = await getMappings();
    const compoundAliasMatch = findCompoundAliasMatch(input, mappings);
    
    if (compoundAliasMatch) {
      printInfo(`Found compound command alias: "${chalk.cyan(compoundAliasMatch.naturalLanguage)}"`);
      await executeCompoundAlias(input, compoundAliasMatch);
      return;
    }
    
    // Then check for compound commands (chains with "and", "then", etc.)
    const compoundCheck = detectCompoundCommand(input);
    if (compoundCheck.isCompound) {
      printInfo(`Compound command detected using "${compoundCheck.separator}" separator`);
      await executeCompoundCommand(input);
      return;
    }
    
    // Try database match first
    const dbMatch = await findBestMatchFromDatabase(input);
    if (dbMatch && dbMatch.confidence >= 0.4) {
      await handleDatabaseMatch(input, dbMatch);
      return;
    }
    
    // Fall back to user mappings
    const match = findBestMatch(input, mappings);
    const threshold = config.settings.fuzzyMatchThreshold;
    
    if (match.mapping && match.confidence >= threshold) {
      await handleUserMappingMatch(input, match.mapping, match.confidence, match.isExactMatch, config);
    } else {
      // No match found - offer to save
      await handleNoMatch(input);
    }
  } catch (error) {
    printError(`Error executing command: ${error}`);
    throw error;
  }
}

/**
 * Execute a compound command (multiple commands in sequence)
 */
async function executeCompoundCommand(input: string): Promise<void> {
  // Parse the compound command
  let parsed = parseCompoundCommand(input);
  
  // Match each segment
  parsed = await matchCompoundSegments(parsed);
  
  // Check if any segments couldn't be matched
  const unmatchedSegments = parsed.segments.filter(s => !s.match);
  if (unmatchedSegments.length > 0) {
    printError(`\n⚠️  Could not match ${unmatchedSegments.length} command(s):`);
    unmatchedSegments.forEach((s, idx) => {
      console.log(chalk.red(`  ${idx + 1}. "${s.input}"`));
    });
    
    const shouldContinue = await promptConfirm('Continue with matched commands anyway?', false);
    if (!shouldContinue) {
      printInfo('Cancelled compound command execution');
      return;
    }
  }
  
  // Display breakdown
  displayCompoundBreakdown(parsed);
  
  // Resolve placeholders for each segment
  const resolvedSegments: CompoundSegment[] = [];
  for (const segment of parsed.segments) {
    if (segment.match) {
      const resolved = await resolveSegmentPlaceholders(segment);
      resolvedSegments.push(resolved);
    }
  }
  
  // Filter out segments without matches
  const executableSegments = resolvedSegments.filter(s => s.resolvedCommand);
  
  if (executableSegments.length === 0) {
    printError('No executable commands found');
    return;
  }
  
  if (process.env.NL_TERMINAL_CLI_DRY_RUN === '1') {
    executableSegments.forEach((segment, index) => {
      if (segment.resolvedCommand) {
        printInfo(`[dry-run ${index + 1}/${executableSegments.length}] ${segment.resolvedCommand}`);
      }
    });
    return;
  }

  // Confirm execution
  if (process.env.NL_TERMINAL_CLI_ASSUME_YES !== '1') {
    const shouldExecute = await promptConfirm(`Execute ${executableSegments.length} command(s) in sequence?`, true);
    if (!shouldExecute) {
      const editOption = await promptConfirm('Would you like to edit the commands before executing?', false);
      if (editOption) {
        for (let i = 0; i < executableSegments.length; i++) {
          const segment = executableSegments[i];
          if (segment.resolvedCommand) {
            const edited = await promptInput(`Edit command ${i + 1}:`, segment.resolvedCommand);
            segment.resolvedCommand = edited;
          }
        }
      } else {
        printInfo('Cancelled');
        return;
      }
    }
  }
  
  // Execute each command sequentially
  const config = await getConfig();
  const results: CompoundSegment[] = [];
  let stopExecution = false;
  
  for (let i = 0; i < executableSegments.length; i++) {
    const segment = executableSegments[i];
    if (stopExecution || !segment.resolvedCommand) continue;
    
    console.log(chalk.cyan(`\n[${i + 1}/${executableSegments.length}] Executing: ${chalk.yellow(segment.resolvedCommand)}`));
    
    // Check for risky commands (rm, sudo, etc.) and prompt for confirmation
    const shouldProceed = await checkRiskyCommandAndConfirm(segment.resolvedCommand);
    if (!shouldProceed) {
      printInfo(`Skipping command ${i + 1}`);
      if (i < executableSegments.length - 1) {
        const continueExecution = await promptConfirm('Continue with remaining commands?', true);
        if (!continueExecution) {
          stopExecution = true;
          printInfo('Stopping execution');
        }
      }
      continue;
    }
    
    const result = await executeInteractive(segment.resolvedCommand, config.defaultShell);
    segment.success = result.success;
    segment.output = result.output;
    segment.error = result.error;
    results.push(segment);
    
    if (result.success) {
      printSuccess(`✓ Command ${i + 1} completed successfully`);
    } else {
      printError(`✗ Command ${i + 1} failed with exit code ${result.exitCode}`);
      if (result.error) {
        console.error(chalk.red(result.error));
      }
      
      // Ask whether to continue
      if (i < executableSegments.length - 1) {
        const continueExecution = await promptConfirm('Continue with remaining commands?', false);
        if (!continueExecution) {
          stopExecution = true;
          printInfo('Stopping execution');
        }
      }
    }
  }
  
  // Add each executed command to history
  if (config.settings.saveHistory) {
    for (const segment of results) {
      if (segment.resolvedCommand) {
        await addToHistory(
          segment.input,
          segment.resolvedCommand,
          segment.success ?? false,
          segment.success ? 0 : 1,
          segment.output,
          segment.error,
          []
        );
      }
    }
  }
  
  // Display summary
  displayExecutionSummary(results, stopExecution);
}

/**
 * Display execution summary for compound commands
 */
function displayExecutionSummary(results: CompoundSegment[], wasStopped: boolean): void {
  console.log(chalk.bold('\n📊 Execution Summary:\n'));
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  const tableData = results.map((result, idx) => {
    const status = result.success ? chalk.green('✓ Success') : chalk.red('✗ Failed');
    const command = result.resolvedCommand || 'N/A';
    
    return {
      '#': idx + 1,
      'Command': command.length > 40 ? command.substring(0, 37) + '...' : command,
      'Status': status
    };
  });
  
  console.log(formatTable(tableData));
  console.log(chalk.gray(`\nSuccessful: ${chalk.green(successful)} | Failed: ${chalk.red(failed)}`));
  
  if (wasStopped) {
    console.log(chalk.yellow('⚠️  Execution was stopped early'));
  }
  
  if (successful === results.length) {
    printSuccess('\n✅ All commands executed successfully!');
  } else if (failed > 0) {
    printWarning(`\n⚠️  ${failed} command(s) failed`);
  }
}

async function handleDatabaseMatch(input: string, match: DatabaseMatchResult): Promise<void> {
  const parsed = parseCommand(input, match);
  printSuccess(`Found ${match.isExactMatch ? 'exact' : 'similar'} match: "${chalk.cyan(match.matchedPhrase)}" (${Math.round(match.confidence * 100)}% confidence)`);
  console.log(chalk.gray(`Template: ${chalk.yellow(match.command.commandTemplate)}`));
  if (match.command.description) {
    console.log(chalk.gray(`Description: ${match.command.description}`));
  }

  if (process.env.NL_TERMINAL_CLI_DRY_RUN === '1') {
    const placeholderNames = match.command.placeholders.map(ph => ph.name);
    const args: Record<string, string> = { ...parsed.extractedArgs };
    for (const name of placeholderNames) {
      if (!args[name]) {
        args[name] = '<value>';
      }
    }
    const preview = replacePlaceholders(match.command.commandTemplate, args);
    printInfo(`[dry-run] ${preview}`);
    return;
  }
  
  // Show extracted arguments
  if (Object.keys(parsed.extractedArgs).length > 0) {
    console.log(chalk.gray('Extracted arguments:'));
    for (const [key, value] of Object.entries(parsed.extractedArgs)) {
      console.log(chalk.gray(`  ${key}: ${chalk.cyan(value)}`));
    }
  }
  
  // Handle missing required placeholders
  let finalArgs = { ...parsed.extractedArgs };
  if (parsed.missingPlaceholders.length > 0) {
    console.log(chalk.yellow('\n⚠️  Some required arguments are missing:'));
    for (const placeholder of parsed.missingPlaceholders) {
      const prompt = placeholder.description + (placeholder.defaultValue ? ` (default: ${placeholder.defaultValue})` : '');
      const value = await promptInput(prompt, placeholder.defaultValue);
      if (value) {
        finalArgs[placeholder.name] = value;
      }
    }
  }
  
  // Build the final command
  let commandToExecute = replacePlaceholders(match.command.commandTemplate, finalArgs);
  
  // Show placeholder hints if any exist
  if (match.command.placeholders.length > 0) {
    console.log(chalk.gray('\n📌 Placeholders:'));
    for (const ph of match.command.placeholders) {
      const value = finalArgs[ph.name] || chalk.gray('(not provided)');
      console.log(chalk.gray(`  {${ph.name}}: ${value}`));
    }
  }
  
  // Ask user what to do
  const action = await selectFromList('What would you like to do?', [
    { name: '✓ Execute this command', value: 'execute' },
    { name: '✏️  Edit command before executing', value: 'edit' },
    { name: '🔍 Search for other matches', value: 'search' }
  ]);
  
  if (action === null) {
    printInfo('Cancelled');
    return;
  }
  
  if (action === 'edit') {
    commandToExecute = await promptInput('Edit command:', commandToExecute);
  }
  
  if (action === 'search') {
    await showMultipleDatabaseMatches(input);
    return;
  }
  
  // Execute the command
  await executeWithConfirmation(commandToExecute, input);
}

async function handleUserMappingMatch(input: string, mapping: CommandMapping, confidence: number, isExactMatch: boolean, config: { defaultShell: string; settings: { confirmBeforeExecute: boolean } }): Promise<void> {
  printSuccess(`Found ${isExactMatch ? 'exact' : 'similar'} match: "${chalk.cyan(mapping.naturalLanguage)}" (${Math.round(confidence * 100)}% confidence)`);
  const command = mapping.command;
  console.log(chalk.gray(`Command: ${chalk.yellow(command)}`));
  
  let commandToExecute = command;
  
  // Handle placeholders if they exist
  if (mapping.placeholders && mapping.placeholders.length > 0) {
    const parsed = parseUserMapping(input, mapping);
    
    // Prompt for missing required placeholders
    const finalArgs = { ...parsed.extractedArgs };
    for (const placeholder of parsed.missingPlaceholders) {
      const prompt = placeholder.description + (placeholder.defaultValue ? ` (default: ${placeholder.defaultValue})` : '');
      const value = await promptInput(prompt, placeholder.defaultValue);
      if (value || placeholder.defaultValue) {
        finalArgs[placeholder.name] = value || placeholder.defaultValue || '';
      }
    }
    
    // Replace placeholders in command
    commandToExecute = replacePlaceholders(mapping.command, finalArgs);
    console.log(chalk.gray(`Expanded command: ${chalk.yellow(commandToExecute)}`));
  }
  
  if (process.env.NL_TERMINAL_CLI_DRY_RUN === '1') {
    printInfo(`[dry-run] ${commandToExecute}`);
    return;
  }

  const action = await selectFromList('What would you like to do?', [
    { name: '✓ Execute this command', value: 'execute' },
    { name: '✏️  Edit command before executing', value: 'edit' },
    { name: '🔍 Search for other matches', value: 'search' }
  ]);
  
  if (action === null) {
    printInfo('Cancelled');
    return;
  }
  
  if (action === 'edit') {
    commandToExecute = await promptInput('Edit command:', commandToExecute);
  }
  
  if (action === 'search') {
    const mappings = await getMappings();
    await showMultipleMatches(input, mappings);
    return;
  }
  
  await executeWithConfirmation(commandToExecute, input);
}

async function handleNoMatch(input: string): Promise<void> {
  printWarning(`No matching command found`);
  const shouldSave = await promptConfirm('Would you like to save this as a new command?');
  
  if (shouldSave) {
    const newCommand = await promptInput('Enter the terminal command:');
    const description = await promptInput('Enter description (optional):');
    
    if (newCommand.trim() && input) {
      await addMapping({
        naturalLanguage: input,
        command: newCommand,
        description: description || undefined,
        tags: []
      });
      
      const executeNow = await promptConfirm('Execute this command now?');
      if (executeNow) {
        await executeWithConfirmation(newCommand, input);
      }
    }
  }
}

async function showMultipleDatabaseMatches(input: string): Promise<void> {
  const matches = await findMultipleMatchesFromDatabase(input, 0.2, 10);
  if (matches.length === 0) {
    printWarning('No similar commands found');
    return;
  }
  
  console.log(chalk.bold('\nSimilar commands from database:'));
  const choices = matches.map((match, idx) => ({
    name: `${idx + 1}. "${chalk.cyan(match.matchedPhrase)}" (${Math.round(match.confidence * 100)}%) → ${chalk.yellow(match.command.commandTemplate)}`,
    value: match
  }));
  
  const selected = await selectFromList('Select a command:', choices, false);
  if (selected) {
    await handleDatabaseMatch(input, selected);
  }
}

async function showMultipleMatches(input: string, mappings: CommandMapping[]): Promise<void> {
  const matches = findMultipleMatches(input, mappings, 0.2, 10);
  if (matches.length === 0) {
    printWarning('No similar commands found');
    return;
  }
  
  console.log(chalk.bold('\nSimilar commands:'));
  const choices = matches
    .filter(match => match.mapping !== null)
    .map((match, idx) => ({
      name: `${idx + 1}. "${chalk.cyan(match.mapping!.naturalLanguage)}" (${Math.round(match.confidence * 100)}%) → ${chalk.yellow(match.mapping!.command)}`,
      value: match.mapping!
    }));
  
  const selected = await selectFromList('Select a command to execute:', choices, false);
  if (selected) {
    await executeWithConfirmation(selected.command, input);
  }
}

export async function searchFiles(query?: string, options?: SearchOptions): Promise<void> {
  try {
    let searchQuery = query;
    if (!searchQuery) {
      searchQuery = await promptInput('Search for files:');
    }
    
    if (!searchQuery?.trim()) {
      printWarning('No search query provided');
      return;
    }
    
    // Lazy load ora and glob
    const oraModule = await getOra();
    const globModule = await getGlob();
    const spinner = oraModule.default('Searching files...').start();
    const searchDir = options?.directory || process.cwd();
    let extension = options?.extension;
    const maxResults = options?.maxResults || 20;
    
    // Detect extension from natural language query if not provided via options
    let detectedExtension: string | null = null;
    if (!extension) {
      detectedExtension = detectExtensionFromQuery(searchQuery);
      if (detectedExtension) {
        extension = detectedExtension;
      }
    }
    
    let pattern = '**/*';
    if (extension) {
      pattern = extension.startsWith('.') 
        ? `**/*${extension}` 
        : `**/*.${extension}`;
    }
    
    if (searchQuery.includes('*') || searchQuery.includes('?')) {
      pattern = searchQuery;
    }
    
    // Debug output
    if (process.env.DEBUG || process.env.NL_CLI_DEBUG) {
      spinner.stop();
      printInfo(`Search directory: ${searchDir}`);
      printInfo(`Search pattern: ${pattern}`);
      if (detectedExtension) {
        printInfo(`Detected extension from query: ${detectedExtension}`);
      } else if (extension) {
        printInfo(`Extension filter: ${extension}`);
      }
      spinner.start('Searching files...');
    }
    
    try {
      const files = await globModule.glob(pattern, {
        cwd: searchDir,
        nodir: true,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**']
      });
      
      if (process.env.DEBUG || process.env.NL_CLI_DEBUG) {
        spinner.stop();
        printInfo(`Files found before filtering: ${files.length}`);
        spinner.start('Filtering results...');
      }
      
      let filteredFiles = files;
      
      // If we have an extension filter or detected extension, don't filter by name
      // Otherwise, filter by the search query
      if (!extension && !searchQuery.includes('*') && !searchQuery.includes('?')) {
        const queryLower = searchQuery.toLowerCase();
        filteredFiles = files.filter((file: string) => 
          file.toLowerCase().includes(queryLower) || 
          path.basename(file).toLowerCase().includes(queryLower)
        );
      }
      
      filteredFiles = filteredFiles.slice(0, maxResults);
      spinner.stop();
      
      if (filteredFiles.length === 0) {
        printWarning('No files found');
        if (extension) {
          printInfo(`Searching for pattern: ${pattern}`);
          printInfo(`Try searching without specifying file type or check if ${extension} files exist in this directory`);
        }
        return;
      }
      
      if (detectedExtension) {
        printSuccess(`Found ${filteredFiles.length} ${detectedExtension} file(s) (detected from query)`);
      } else if (extension) {
        printSuccess(`Found ${filteredFiles.length} ${extension} file(s)`);
      } else {
        printSuccess(`Found ${filteredFiles.length} file(s)`);
      }
      
      // Get file stats for each file
      const tableData = await Promise.all(filteredFiles.map(async (file: string, idx: number) => {
        const fullPath = path.resolve(searchDir, file);
        let size = 'N/A';
        let modified = 'N/A';
        
        try {
          const stats = await fs.stat(fullPath);
          // Format size
          const bytes = stats.size;
          if (bytes < 1024) size = `${bytes} B`;
          else if (bytes < 1024 * 1024) size = `${(bytes / 1024).toFixed(1)} KB`;
          else if (bytes < 1024 * 1024 * 1024) size = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
          else size = `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
          
          // Format date
          const mtime = stats.mtime;
          const now = new Date();
          const diffMs = now.getTime() - mtime.getTime();
          const diffMins = Math.floor(diffMs / 60000);
          const diffHours = Math.floor(diffMs / 3600000);
          const diffDays = Math.floor(diffMs / 86400000);
          
          if (diffMins < 1) modified = 'just now';
          else if (diffMins < 60) modified = `${diffMins}m ago`;
          else if (diffHours < 24) modified = `${diffHours}h ago`;
          else if (diffDays < 7) modified = `${diffDays}d ago`;
          else modified = mtime.toLocaleDateString();
        } catch {
          // File might not be accessible
        }
        
        return {
          '#': idx + 1,
          'File': path.basename(file),
          'Size': size,
          'Modified': modified,
          'Directory': path.dirname(file)
        };
      }));
      
      console.log(formatTable(tableData));
      
      const shouldOpen = await promptConfirm('Would you like to open a file?');
      if (shouldOpen) {
        const fileChoices = filteredFiles.map((file: string, idx: number) => ({
          name: `${idx + 1}. ${file}`,
          value: file
        }));
        
        const selectedFile = await selectFromList<string>('Select a file to open:', fileChoices);
        if (selectedFile) {
          const fullPath = path.resolve(searchDir, selectedFile);
          const isMarkdown = selectedFile.toLowerCase().endsWith('.md') || selectedFile.toLowerCase().endsWith('.markdown');
          
          // Check which editors are installed
          const [vimInstalled, nanoInstalled, freshInstalled, glowInstalled] = await Promise.all([
            checkEditorInstalled('vim'),
            checkEditorInstalled('nano'),
            checkEditorInstalled('fresh'),
            isMarkdown ? checkEditorInstalled('glow') : Promise.resolve(false)
          ]);
          
          // Ask which editor to use - all options selectable, check installation when used
          const editorChoices: { name: string; value: string }[] = [
            { name: chalk.yellow('📄 cat') + chalk.gray(' - View file contents (always installed)'), value: 'cat' },
            { 
              name: vimInstalled 
                ? chalk.green('📝 vim') + chalk.gray(' - Edit with vim')
                : chalk.gray('📝 vim - Edit with vim (not installed)'), 
              value: 'vim'
            },
            { 
              name: nanoInstalled
                ? chalk.cyan('✏️  nano') + chalk.gray(' - Edit with nano')
                : chalk.gray('✏️  nano - Edit with nano (not installed)'), 
              value: 'nano'
            },
            { 
              name: freshInstalled
                ? chalk.magenta('🌟 fresh') + chalk.gray(' - Edit with Fresh editor')
                : chalk.gray('🌟 fresh - Edit with Fresh editor (not installed)'), 
              value: 'fresh'
            }
          ];
          
          // Add glow option for markdown files
          if (isMarkdown) {
            editorChoices.unshift({ 
              name: glowInstalled
                ? chalk.magenta('🌸 glow') + chalk.gray(' - View with Glow (markdown renderer)')
                : chalk.gray('🌸 glow - View with Glow (markdown renderer) (not installed)'), 
              value: 'glow'
            });
          }
          
          const editor = await selectFromList('Choose editor:', editorChoices);
          
          if (editor) {
            // Check if the selected editor is installed before trying to use it
            const isInstalled = editor === 'cat' ? true : await checkEditorInstalled(editor);
            
            if (!isInstalled) {
              printError(`${editor} is not installed on your system.`);
              printInfo(`Go to Extras menu to get installation instructions for ${editor}.`);
            } else {
              printInfo(`Opening with ${editor}...`);
              await executeEditor(`${editor} "${fullPath}"`);
            }
          }
        }
      }
    } catch (error) {
      spinner.stop();
      printError(`Search failed: ${error}`);
    }
  } catch (error) {
    printError(`Error searching files: ${error}`);
    throw error;
  }
}

export async function listMappings(): Promise<void> {
  pushMenu('view-mappings');
  
  try {
    // Get config mappings
    const configMappings = await getMappings();
    
    // Get database commands
    await ensureDatabase();
    const dbCommands = await getAllCommands();
    
    const totalConfig = configMappings.length;
    const totalDb = dbCommands.length;
    const total = totalConfig + totalDb;
    
    if (total === 0) {
      printWarning('No command mappings found');
      printInfo('Use "configure" to add mappings');
      popMenu();
      return;
    }
    
    printSuccess(`Found ${total} total command mappings:`);
    console.log(chalk.gray(`  • ${totalConfig} custom mappings (from config)`));
    console.log(chalk.gray(`  • ${totalDb} built-in commands`));
    
    // Show config mappings if any
    if (totalConfig > 0) {
      console.log(chalk.bold('\n📋 Custom Mappings (Config):\n'));
      const configTableData = configMappings.map((m, idx) => ({
        '#': idx + 1,
        'Natural Language': m.naturalLanguage,
        'Command': m.command,
        'Description': m.description || '-',
        'Tags': m.tags?.join(', ') || '-'
      }));
      console.log(formatTable(configTableData));
    }
    
    // Show database commands if any
    if (totalDb > 0) {
      console.log(chalk.bold('\n🗄️  Built-in Commands:\n'));
      // Group by category
      const byCategory: Record<string, DatabaseCommand[]> = {};
      dbCommands.forEach(cmd => {
        if (!byCategory[cmd.category]) {
          byCategory[cmd.category] = [];
        }
        byCategory[cmd.category].push(cmd);
      });
      
      // Show summary by category
      for (const [category, commands] of Object.entries(byCategory)) {
        console.log(chalk.cyan(`  ${getCategoryIcon(category)} ${category}:`) + chalk.gray(` ${commands.length} commands`));
      }
      console.log(chalk.gray('\n  (Use "Built-in commands" option to view all details)'));
    }
    
    // Show navigation options
    const result = await selectFromSubmenu('', [], true, true);
    
    if (result.action === 'back' || result.action === null) {
      popMenu();
      return;
    }
    
    if (result.action === 'main') {
      clearMenuStack();
      return;
    }
  } catch (error) {
    printError(`Error listing mappings: ${error}`);
    popMenu();
    throw error;
  }
}

export async function browseDatabase(): Promise<void> {
  await ensureDatabase();
  pushMenu('database');
  
  while (true) {
    const result = await selectFromSubmenu('Database Options:', [
      { name: '📋 List all commands by category', value: 'bycategory' },
      { name: '🔍 Search commands', value: 'search' },
      { name: '⭐ Show popular commands', value: 'popular' }
    ]);
    
    if (result.action === 'back' || result.action === null) {
      popMenu();
      return;
    }
    
    if (result.action === 'main') {
      clearMenuStack();
      return;
    }
    
    if (result.action === 'select' && result.value) {
      switch (result.value) {
        case 'bycategory':
          await listCommandsByCategory();
          break;
        case 'search':
          await searchDatabaseCommands();
          break;
        case 'popular':
          await showPopularCommands();
          break;
      }
      if (isAtMainMenu()) {
        return;
      }
    }
  }
}

async function listCommandsByCategory(): Promise<void> {
  pushMenu('database-category');
  
  while (true) {
    const categories = ['file', 'git', 'npm', 'bun', 'system', 'docker', 'database', 'network', 'text'];
    const categoryResult = await selectFromSubmenu('Select category:', [
      ...categories.map(c => ({ name: `${getCategoryIcon(c)} ${c.charAt(0).toUpperCase() + c.slice(1)}`, value: c }))
    ]);
    
    if (categoryResult.action === 'back' || categoryResult.action === null) {
      popMenu();
      return;
    }
    
    if (categoryResult.action === 'main') {
      clearMenuStack();
      return;
    }
    
    if (categoryResult.action === 'select' && categoryResult.value) {
      const category = categoryResult.value;
      const commands = await findCommandsByCategory(category);
      if (commands.length === 0) {
        printWarning('No commands found in this category');
        continue;
      }
      
      printSuccess(`Found ${commands.length} command(s) in ${category}`);
      const choices = commands.map((cmd, idx) => ({
        name: `${idx + 1}. ${chalk.cyan(cmd.naturalLanguage[0])} → ${chalk.yellow(cmd.commandTemplate)}`,
        value: cmd
      }));
      
      const selectedResult = await selectFromSubmenu('Select a command to view details:', choices, true, true);
      
      if (selectedResult.action === 'back') {
        continue; // Go back to category selection
      }
      
      if (selectedResult.action === 'main') {
        clearMenuStack();
        return;
      }
      
      if (selectedResult.action === 'select' && selectedResult.value) {
        displayCommandDetails(selectedResult.value);
      }
      if (isAtMainMenu()) {
        return;
      }
    }
  }
}

async function searchDatabaseCommands(): Promise<void> {
  const query = await promptInput('Search for commands:');
  if (!query.trim()) {
    printWarning('No search query provided');
    return;
  }
  
  const { searchCommands } = await import('./database.js');
  const commands = await searchCommands(query);
  
  if (commands.length === 0) {
    printWarning('No commands found matching your query');
    return;
  }
  
  printSuccess(`Found ${commands.length} command(s)`);
  const choices = commands.map((cmd, idx) => ({
    name: `${idx + 1}. [${cmd.category}] ${chalk.cyan(cmd.naturalLanguage[0])} → ${chalk.yellow(cmd.commandTemplate)}`,
    value: cmd
  }));
  
  const selected = await selectFromSubmenu('Select a command to view details:', choices, true, true);

  if (selected.action === 'back' || selected.action === null) {
    return;
  }

  if (selected.action === 'main') {
    clearMenuStack();
    return;
  }

  if (selected.action === 'select' && selected.value) {
    displayCommandDetails(selected.value);
  }
}

async function showPopularCommands(): Promise<void> {
  const allCommands = await getAllCommands();
  
  // Curated list of popular commands - a mix of file, npm, and bun
  const popularTemplates = [
    // File commands
    'mkdir {folder_name}',
    'touch {file_name}',
    'ls -la',
    'rm {file_name}',
    'cp {source} {destination}',
    'mv {source} {destination}',
    'cat {file_name}',
    // npm commands
    'npm install',
    'npm install {package_name}',
    'npm run {script_name}',
    'npm start',
    'npm test',
    'npm run build',
    // bun commands
    'bun install',
    'bun add {package_name}',
    'bun run {script_name}',
    'bun start',
    'bun test',
    'bun run build',
    'bunx {package_name}'
  ];
  
  // Find commands matching our curated list
  const commands = popularTemplates
    .map(template => allCommands.find(cmd => cmd.commandTemplate === template))
    .filter((cmd): cmd is DatabaseCommand => cmd !== undefined);
  
  const choices = commands.map((cmd, idx) => ({
    name: `${idx + 1}. ${getCategoryIcon(cmd.category)} [${cmd.category}] ${chalk.cyan(cmd.naturalLanguage[0])}`,
    value: cmd
  }));
  
  const selected = await selectFromSubmenu('Select a command to view details:', choices, true, true);

  if (selected.action === 'back' || selected.action === null) {
    return;
  }

  if (selected.action === 'main') {
    clearMenuStack();
    return;
  }

  if (selected.action === 'select' && selected.value) {
    displayCommandDetails(selected.value);
  }
}

function displayCommandDetails(command: DatabaseCommand): void {
  console.log(chalk.bold('\n📌 Command Details:'));
  console.log(chalk.gray(`Category: ${getCategoryIcon(command.category)} ${command.category}`));
  console.log(chalk.gray(`Template: ${chalk.yellow(command.commandTemplate)}`));
  console.log(chalk.gray(`Description: ${command.description || 'No description'}`));
  
  if (command.naturalLanguage.length > 0) {
    console.log(chalk.gray('\nNatural language phrases:'));
    command.naturalLanguage.forEach(phrase => {
      console.log(chalk.gray(`  • "${phrase}"`));
    });
  }
  
  if (command.placeholders.length > 0) {
    console.log(chalk.gray('\n📋 Placeholders:'));
    command.placeholders.forEach(ph => {
      const required = ph.required ? chalk.red('(required)') : chalk.gray('(optional)');
      const defaultVal = ph.defaultValue ? chalk.gray(` [default: ${ph.defaultValue}]`) : '';
      console.log(chalk.gray(`  {${chalk.cyan(ph.name)}} ${ph.description} ${required}${defaultVal}`));
    });
  }
}

function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    file: '📁',
    git: '🌿',
    npm: '📦',
    bun: '🥟',
    system: '⚙️',
    docker: '🐳',
    database: '🗄️',
    network: '🌐',
    text: '📝'
  };
  return icons[category] || '•';
}

export async function configureMappings(): Promise<void> {
  pushMenu('config');
  
  while (true) {
    const result = await selectFromSubmenu('Configuration Options:', [
      { name: '➕ Add new mapping', value: 'add' },
      { name: '✏️  Edit existing mapping', value: 'edit' },
      { name: '🗑️  Delete mapping', value: 'delete' },
      { name: '📋 View all mappings', value: 'view' },
      { name: '🔗 Add compound command alias', value: 'compound' }
    ]);
    
    if (result.action === 'back' || result.action === null) {
      popMenu();
      return;
    }
    
    if (result.action === 'main') {
      clearMenuStack();
      return;
    }
    
    if (result.action === 'select' && result.value) {
      switch (result.value) {
        case 'add':
          await addNewMapping();
          break;
        case 'edit':
          await editMapping();
          break;
        case 'delete':
          await deleteMappingInteractive();
          break;
        case 'view':
          await listMappings();
          break;
        case 'compound':
          await addCompoundCommandAlias();
          break;
      }
      if (isAtMainMenu()) {
        return;
      }
    }
  }
}

async function manageDatabaseCommands(): Promise<void> {
  await ensureDatabase();
  pushMenu('database-manage');
  
  while (true) {
    const result = await selectFromSubmenu('Database Management:', [
      { name: '➕ Add custom command', value: 'add' },
      { name: '🗑️  Delete custom command', value: 'delete' },
      { name: '📊 View database stats', value: 'stats' },
      { name: '🔄 Reset to defaults', value: 'reset' }
    ]);
    
    if (result.action === 'back' || result.action === null) {
      popMenu();
      return;
    }
    
    if (result.action === 'main') {
      clearMenuStack();
      return;
    }
    
    if (result.action === 'select' && result.value) {
      switch (result.value) {
        case 'add':
          await addDatabaseCommand();
          break;
        case 'delete':
          await deleteDatabaseCommand();
          break;
        case 'stats':
          await showDatabaseStats();
          break;
        case 'reset':
          await resetDatabase();
          break;
      }
      if (isAtMainMenu()) {
        return;
      }
    }
  }
}

async function addDatabaseCommand(): Promise<void> {
  console.log(chalk.bold('\n➕ Add Custom Database Command\n'));
  
  const naturalLanguage = await promptInput('Natural language phrases (comma-separated):');
  if (!naturalLanguage.trim()) {
    printError('Natural language phrases are required');
    return;
  }
  
  const commandTemplate = await promptInput('Command template (use {placeholder} syntax):');
  if (!commandTemplate.trim()) {
    printError('Command template is required');
    return;
  }
  
  const description = await promptInput('Description (optional):');
  const categories = ['file', 'git', 'npm', 'bun', 'system', 'docker', 'database', 'network', 'text', 'custom'];
  const category = await selectFromList('Select category:', categories.map(c => ({ name: c, value: c })));
  
  if (!category) {
    printInfo('Cancelled');
    return;
  }
  
  // Parse placeholders
  const placeholdersText = await promptInput('Placeholders (format: name|description|required|default, comma-separated, optional):');
  const placeholders: { name: string; description: string; required: boolean; defaultValue?: string }[] = [];
  
  if (placeholdersText.trim()) {
    placeholdersText.split(',').forEach(p => {
      const parts = p.split('|').map(s => s.trim());
      if (parts[0]) {
        placeholders.push({
          name: parts[0],
          description: parts[1] || parts[0],
          required: parts[2] === 'true' || parts[2] === 'yes',
          defaultValue: parts[3]
        });
      }
    });
  }
  
  const command = await addDbCommand({
    naturalLanguage: naturalLanguage.split(',').map(s => s.trim()).filter(Boolean),
    commandTemplate: commandTemplate.trim(),
    description: description.trim() || '',
    category: category || 'custom',
    placeholders
  });
  
  printSuccess(`Command added with ID: ${command.id}`);
}

async function deleteDatabaseCommand(): Promise<void> {
  const commands = await getAllCommands();
  if (commands.length === 0) {
    printWarning('No commands to delete');
    return;
  }
  
  // Only show commands that are likely custom (high IDs typically indicate user-added)
  const customCommands = commands.filter(c => c.id > 100);
  if (customCommands.length === 0) {
    printWarning('No custom commands found to delete');
    printInfo('Built-in commands cannot be deleted');
    return;
  }
  
  const choices = customCommands.map((cmd, idx) => ({
    name: `${idx + 1}. [${cmd.category}] ${cmd.naturalLanguage[0]}`,
    value: cmd.id
  }));
  
  const idToDelete = await selectFromList('Select command to delete:', choices);
  if (idToDelete) {
    const confirm = await promptConfirm('Are you sure you want to delete this command?', false);
    if (confirm) {
      const success = await deleteDbCommand(idToDelete);
      if (success) {
        printSuccess('Command deleted');
      } else {
        printError('Failed to delete command');
      }
    }
  }
}

async function showDatabaseStats(): Promise<void> {
  const commands = await getAllCommands();
  const stats: Record<string, number> = {};
  commands.forEach(cmd => {
    stats[cmd.category] = (stats[cmd.category] || 0) + 1;
  });
  
  console.log(chalk.bold('\n📊 Database Statistics:'));
  console.log(chalk.gray(`Total commands: ${commands.length}`));
  console.log(chalk.gray('\nBy category:'));
  Object.entries(stats).forEach(([category, count]) => {
    console.log(chalk.gray(`  ${getCategoryIcon(category)} ${category}: ${count}`));
  });
}

async function resetDatabase(): Promise<void> {
  const confirm = await promptConfirm(chalk.red('⚠️  WARNING: This will delete all custom commands and reset to defaults. Continue?'), false);
  if (confirm) {
    const db = await getDatabase();
    db.exec('DELETE FROM commands');
    await seedDatabase();
    printSuccess('Database reset to defaults');
  }
}

async function addNewMapping(): Promise<void> {
  console.log(chalk.bold('\nAdd New Command Mapping\n'));
  
  const naturalLanguage = await promptInput('Natural language description:');
  if (!naturalLanguage.trim()) {
    printError('Natural language description is required');
    return;
  }
  
  const command = await promptInput('Terminal command:');
  if (!command.trim()) {
    printError('Command is required');
    return;
  }
  
  const description = await promptInput('Description (optional):');
  const tagsInput = await promptInput('Tags (comma-separated, optional):');
  const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(Boolean) : [];

  const placeholdersText = await promptInput('Placeholders (format: name|description|required|default, comma-separated, optional):');
  const placeholders: Placeholder[] = [];

  if (placeholdersText.trim()) {
    placeholdersText.split(',').forEach(p => {
      const parts = p.split('|').map(s => s.trim());
      if (parts[0]) {
        placeholders.push({
          name: parts[0],
          description: parts[1] || parts[0],
          required: parts[2] === 'true' || parts[2] === 'yes',
          defaultValue: parts[3]
        });
      }
    });
  }

  // Preview and confirm
  console.log(chalk.bold('\n📋 Preview:\n'));
  console.log(chalk.gray(`  Natural Language: ${chalk.cyan(naturalLanguage.trim())}`));
  console.log(chalk.gray(`  Command: ${chalk.yellow(command.trim())}`));
  if (description.trim()) {
    console.log(chalk.gray(`  Description: ${description.trim()}`));
  }
  if (tags.length > 0) {
    console.log(chalk.gray(`  Tags: ${tags.join(', ')}`));
  }
  if (placeholders.length > 0) {
    console.log(chalk.gray(`  Placeholders:`));
    placeholders.forEach(ph => {
      const req = ph.required ? chalk.red('(required)') : chalk.gray('(optional)');
      const def = ph.defaultValue ? chalk.gray(`[default: ${ph.defaultValue}]`) : '';
      console.log(chalk.gray(`    • {${chalk.yellow(ph.name)}} ${ph.description} ${req} ${def}`));
    });
  }
  
  const confirm = await selectFromList('What would you like to do?', [
    { name: chalk.green('💾 Save mapping'), value: 'save' },
    { name: chalk.yellow('📝 Edit again'), value: 'edit' }
  ]);
  
  if (confirm === null) {
    printInfo('Cancelled - mapping not saved');
    return;
  }
  
  if (confirm === 'edit') {
    // Restart the process
    await addNewMapping();
    return;
  }
  
  await addMapping({
    naturalLanguage: naturalLanguage.trim(),
    command: command.trim(),
    description: description.trim() || undefined,
    tags,
    placeholders: placeholders.length > 0 ? placeholders : undefined
  });
  printSuccess('Mapping saved successfully!');
}

async function editMapping(): Promise<void> {
  const mappings = await getMappings();
  if (mappings.length === 0) {
    printWarning('No mappings to edit');
    return;
  }
  
  const choices = mappings.map((m, idx) => ({
    name: `${idx + 1}. "${m.naturalLanguage}" → ${m.command}`,
    value: m
  }));
  
  const selected = await selectFromList('Select mapping to edit:', choices);
  if (!selected) {
    printInfo('Cancelled');
    return;
  }
  
  await editMappingWithPreview(selected);
}

async function editMappingWithPreview(selected: CommandMapping): Promise<void> {
  console.log(chalk.bold('\nEdit Mapping (press Enter to keep current value)\n'));
  
  const naturalLanguage = await promptInput('Natural language:', selected.naturalLanguage);
  const command = await promptInput('Command:', selected.command);
  const description = await promptInput('Description:', selected.description || '');
  const tagsInput = await promptInput('Tags (comma-separated):', selected.tags?.join(', ') || '');
  const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(Boolean) : [];
  
  // Handle placeholders
  let placeholders = selected.placeholders || [];
  if (placeholders.length > 0) {
    console.log(chalk.gray('\nCurrent placeholders:'));
    placeholders.forEach((ph, idx) => {
      const req = ph.required ? chalk.red('(required)') : chalk.gray('(optional)');
      const def = ph.defaultValue ? chalk.gray(`[default: ${ph.defaultValue}]`) : '';
      console.log(chalk.gray(`  ${idx + 1}. {${chalk.yellow(ph.name)}} ${ph.description} ${req} ${def}`));
    });
    
    const editPlaceholders = await promptConfirm('Edit placeholders?', false);
    if (editPlaceholders) {
      const currentPlaceholdersText = placeholders.map(ph => 
        `${ph.name}|${ph.description}|${ph.required}|${ph.defaultValue || ''}`
      ).join(', ');
      
      const placeholdersText = await promptInput('Placeholders (format: name|description|required|default, comma-separated):', currentPlaceholdersText);
      
      if (placeholdersText.trim()) {
        placeholders = [];
        placeholdersText.split(',').forEach(p => {
          const parts = p.split('|').map(s => s.trim());
          if (parts[0]) {
            placeholders.push({
              name: parts[0],
              description: parts[1] || parts[0],
              required: parts[2] === 'true' || parts[2] === 'yes',
              defaultValue: parts[3]
            });
          }
        });
      }
    }
  } else if (command.includes('{') && command.includes('}')) {
    // New command has placeholders but mapping didn't have them defined
    const addPlaceholders = await promptConfirm('Command contains {placeholders}. Add placeholder definitions?', true);
    if (addPlaceholders) {
      const placeholdersText = await promptInput('Placeholders (format: name|description|required|default, comma-separated):');
      if (placeholdersText.trim()) {
        placeholdersText.split(',').forEach(p => {
          const parts = p.split('|').map(s => s.trim());
          if (parts[0]) {
            placeholders.push({
              name: parts[0],
              description: parts[1] || parts[0],
              required: parts[2] === 'true' || parts[2] === 'yes',
              defaultValue: parts[3]
            });
          }
        });
      }
    }
  }
  
  const updatedMapping: CommandMapping = {
    ...selected,
    naturalLanguage: naturalLanguage || selected.naturalLanguage,
    command: command || selected.command,
    description: description || undefined,
    tags,
    placeholders: placeholders.length > 0 ? placeholders : undefined,
    updatedAt: new Date().toISOString()
  };
  
  // Preview and confirm
  console.log(chalk.bold('\n📋 Preview of Changes:\n'));
  console.log(chalk.gray(`  Natural Language: ${chalk.cyan(updatedMapping.naturalLanguage)}`));
  console.log(chalk.gray(`  Command: ${chalk.yellow(updatedMapping.command)}`));
  if (updatedMapping.description) {
    console.log(chalk.gray(`  Description: ${updatedMapping.description}`));
  }
  if (tags.length > 0) {
    console.log(chalk.gray(`  Tags: ${tags.join(', ')}`));
  }
  if (placeholders.length > 0) {
    console.log(chalk.gray(`  Placeholders:`));
    placeholders.forEach(ph => {
      const req = ph.required ? chalk.red('(required)') : chalk.gray('(optional)');
      const def = ph.defaultValue ? chalk.gray(`[default: ${ph.defaultValue}]`) : '';
      console.log(chalk.gray(`    • {${chalk.yellow(ph.name)}} ${ph.description} ${req} ${def}`));
    });
  }
  
  const confirm = await selectFromList('What would you like to do?', [
    { name: chalk.green('💾 Save changes'), value: 'save' },
    { name: chalk.yellow('📝 Edit again'), value: 'edit' }
  ]);
  
  if (confirm === null) {
    printInfo('Cancelled - changes not saved');
    return;
  }
  
  if (confirm === 'edit') {
    // Restart the edit process with current values
    await editMappingWithPreview(updatedMapping);
    return;
  }
  
  await updateMapping(selected.id, {
    naturalLanguage: updatedMapping.naturalLanguage,
    command: updatedMapping.command,
    description: updatedMapping.description,
    tags: updatedMapping.tags,
    placeholders: updatedMapping.placeholders
  });
  printSuccess('Mapping updated successfully!');
}

async function deleteMappingInteractive(): Promise<void> {
  const mappings = await getMappings();
  if (mappings.length === 0) {
    printWarning('No mappings to delete');
    return;
  }
  
  const choices = mappings.map((m, idx) => ({
    name: `${idx + 1}. "${m.naturalLanguage}" → ${m.command}`,
    value: m
  }));
  
  const selected = await selectFromList('Select mapping to delete:', choices);
  if (!selected) {
    printInfo('Cancelled');
    return;
  }
  
  const confirm = await promptConfirm(`Are you sure you want to delete "${selected.naturalLanguage}"?`, false);
  if (confirm) {
    await deleteMapping(selected.id);
  } else {
    printInfo('Deletion cancelled');
  }
}

/**
 * Add a compound command alias (sequence of commands as a single natural language phrase)
 */
async function addCompoundCommandAlias(): Promise<void> {
  console.log(chalk.bold('\n🔗 Add Compound Command Alias\n'));
  console.log(chalk.gray('Create a natural language shortcut for multiple commands.\n'));
  console.log(chalk.gray('Examples:'));
  console.log(chalk.gray('  - "deploy" → git add . && git commit -m "update" && git push'));
  console.log(chalk.gray('  - "fresh start" → npm ci && npm start'));
  console.log(chalk.gray('  - "update all" → git pull && npm install\n'));
  
  await addCompoundCommandWithPreview();
}

interface CompoundCommandPreview {
  naturalLanguage?: string;
  commands?: string[];
}

async function addCompoundCommandWithPreview(initialValues?: CompoundCommandPreview): Promise<void> {
  const naturalLanguage = await promptInput('Natural language phrase (e.g., "deploy", "update all"):', initialValues?.naturalLanguage);
  if (!naturalLanguage.trim()) {
    printError('Natural language phrase is required');
    return;
  }
  
  const commands: string[] = initialValues?.commands ? [...initialValues.commands] : [];
  let addMore = true;
  
  console.log(chalk.cyan('\nEnter the commands to execute in sequence:\n'));
  while (addMore) {
    const command = await promptInput(`Command ${commands.length + 1}:`);
    if (command.trim()) {
      commands.push(command.trim());
    }
    
    if (commands.length > 0) {
      addMore = await promptConfirm('Add another command?', false);
    } else if (!command.trim()) {
      printWarning('At least one command is required');
      return;
    }
  }
  
  if (commands.length === 0) {
    printWarning('No commands provided');
    return;
  }
  
  // Join commands with && for sequential execution
  const compoundCommand = commands.join(' && ');
  const description = await promptInput('Description (optional):');
  const tagsInput = await promptInput('Tags (comma-separated, optional):');
  const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(Boolean) : ['compound', 'alias'];

  const placeholdersText = await promptInput('Placeholders (format: name|description|required|default, comma-separated, optional):');
  const placeholders: Placeholder[] = [];

  if (placeholdersText.trim()) {
    placeholdersText.split(',').forEach(p => {
      const parts = p.split('|').map(s => s.trim());
      if (parts[0]) {
        placeholders.push({
          name: parts[0],
          description: parts[1] || parts[0],
          required: parts[2] === 'true' || parts[2] === 'yes',
          defaultValue: parts[3]
        });
      }
    });
  }

  // Preview and confirm
  console.log(chalk.bold('\n📋 Preview:\n'));
  console.log(chalk.gray(`  Natural Language: ${chalk.cyan(naturalLanguage.trim())}`));
  console.log(chalk.gray(`  Command Sequence:`));
  commands.forEach((cmd, idx) => {
    console.log(chalk.gray(`    ${idx + 1}. ${chalk.yellow(cmd)}`));
  });
  console.log(chalk.gray(`  Full Command: ${chalk.yellow(compoundCommand)}`));
  if (description.trim()) {
    console.log(chalk.gray(`  Description: ${description.trim()}`));
  }
  if (tags.length > 0) {
    console.log(chalk.gray(`  Tags: ${tags.join(', ')}`));
  }
  if (placeholders.length > 0) {
    console.log(chalk.gray(`  Placeholders:`));
    placeholders.forEach(ph => {
      const req = ph.required ? chalk.red('(required)') : chalk.gray('(optional)');
      const def = ph.defaultValue ? chalk.gray(`[default: ${ph.defaultValue}]`) : '';
      console.log(chalk.gray(`    • {${chalk.yellow(ph.name)}} ${ph.description} ${req} ${def}`));
    });
  }
  
  const confirm = await selectFromList('What would you like to do?', [
    { name: chalk.green('💾 Save mapping'), value: 'save' },
    { name: chalk.yellow('📝 Edit again'), value: 'edit' }
  ]);
  
  if (confirm === null) {
    printInfo('Cancelled - compound command not saved');
    return;
  }
  
  if (confirm === 'edit') {
    // Restart the process with current values
    await addCompoundCommandWithPreview({ naturalLanguage, commands });
    return;
  }
  
  await addMapping({
    naturalLanguage: naturalLanguage.trim(),
    command: compoundCommand,
    description: description.trim() || `Compound command: ${commands.length} step(s)`,
    tags,
    placeholders: placeholders.length > 0 ? placeholders : undefined
  });
  printSuccess(`Compound command alias "${naturalLanguage}" saved successfully!`);
}

const SUPPORTED_EDITORS = [
  {
    name: 'cat',
    description: 'built-in',
    website: { linux: '', mac: '', windows: '' }
  },
  {
    name: 'nano',
    description: 'Simple text editor',
    website: { linux: 'https://www.nano-editor.org/', mac: 'https://www.nano-editor.org/', windows: 'https://www.nano-editor.org/' }
  },
  {
    name: 'vim',
    description: 'Powerful text editor',
    website: { linux: 'https://www.vim.org/', mac: 'https://www.vim.org/', windows: 'https://www.vim.org/' }
  },
  {
    name: 'fresh',
    description: 'Modern Rust-based editor',
    website: { linux: 'https://github.com/sinelaw/fresh', mac: 'https://github.com/sinelaw/fresh', windows: 'https://github.com/sinelaw/fresh' },
    installGuide: 'Install using cargo: cargo install fresh'
  },
  {
    name: 'glow',
    description: 'Markdown viewer with charm',
    website: { linux: 'https://github.com/charmbracelet/glow', mac: 'https://github.com/charmbracelet/glow', windows: 'https://github.com/charmbracelet/glow' },
    installGuide: 'Install via package manager: https://github.com/charmbracelet/glow#installation'
  }
];

/**
 * Checks which editors are installed and provides installation links
 */
export async function checkAndInstallEditors(): Promise<void> {
  pushMenu('editors');
  
  while (true) {
    const platform = getPlatform();
    printInfo('Checking installed editors...');
    
    const editorStatuses: { editor: typeof SUPPORTED_EDITORS[0]; installed: boolean }[] = [];
    
    for (const editor of SUPPORTED_EDITORS) {
      const installed = editor.name === 'cat' ? true : await checkEditorInstalled(editor.name);
      editorStatuses.push({ editor, installed });
    }
    
    // Display status
    console.log(chalk.bold('\n🔧 Editor Status:\n'));
    for (const { editor, installed } of editorStatuses) {
      const icon = installed ? chalk.green('✅') : chalk.red('❌');
      const status = installed ? 'Installed' : 'Not installed';
      const description = editor.description ? chalk.gray(`(${editor.description})`) : '';
      console.log(`${icon} ${chalk.cyan(editor.name)} - ${status} ${description}`);
    }
    
    // Get editors that are not installed and have website links
    const missingEditors = editorStatuses.filter(({ editor, installed }) => {
      if (installed || editor.name === 'cat') return false;
      const websiteUrl = platform === 'linux' ? editor.website.linux :
        platform === 'mac' ? editor.website.mac :
        platform === 'windows' ? editor.website.windows : '';
      return websiteUrl && websiteUrl.length > 0;
    });
    
    if (missingEditors.length === 0) {
      printSuccess('All supported editors are already installed!');
      
      // Show navigation options
      const navResult = await selectFromSubmenu('What would you like to do?', [
        { name: chalk.gray('↻ Refresh'), value: 'refresh' }
      ], true, true);
      
      if (navResult.action === 'back' || navResult.action === null) {
        popMenu();
        return;
      }
      
      if (navResult.action === 'main') {
        clearMenuStack();
        return;
      }
      
      continue; // Refresh
    }
    
    console.log(chalk.gray('\n─────────────────────────────────────\n'));
    
    // Create choices for uninstalled editors (selectable to get installation links)
    const choices: { name: string; value: { name: string; description: string; website: { linux: string; mac: string; windows: string; }; installGuide?: string } | null }[] = missingEditors.map(({ editor }) => ({
      name: chalk.gray(`${editor.name} - ${editor.description} (not installed)`),
      value: editor
    }));
    
    const result = await selectFromSubmenu('Select editor to get installation link:', choices, true, true);
    
    if (result.action === 'back' || result.action === null) {
      popMenu();
      return;
    }
    
    if (result.action === 'main') {
      clearMenuStack();
      return;
    }
    
    if (result.action === 'select' && result.value) {
      const selectedEditor = result.value;
      
      // Get website URL based on platform
      let websiteUrl: string;
      if (platform === 'linux') {
        websiteUrl = selectedEditor.website.linux;
      } else if (platform === 'mac') {
        websiteUrl = selectedEditor.website.mac;
      } else if (platform === 'windows') {
        websiteUrl = selectedEditor.website.windows;
      } else {
        websiteUrl = selectedEditor.website.linux || selectedEditor.website.mac || selectedEditor.website.windows;
      }
      
      if (!websiteUrl) {
        printError(`No installation website available for ${selectedEditor.name}`);
        continue;
      }
      
      // Show installation guide information
      console.log(chalk.yellow(`\n📖 Installation guide for ${selectedEditor.name}:`));
      console.log(chalk.gray(`Website: ${chalk.cyan(websiteUrl)}`));
      if (selectedEditor.installGuide) {
        console.log(chalk.gray(`Guide: ${selectedEditor.installGuide}`));
      }
      
      // Ask if user wants to open the website
      const shouldOpen = await promptConfirm('Open installation guide in browser?', true);
      if (shouldOpen) {
        printInfo(`Opening ${websiteUrl}...`);
        await openUrl(websiteUrl);
      } else {
        printInfo(`You can visit ${websiteUrl} to install ${selectedEditor.name}`);
      }
    }
  }
}

export async function executeWithConfirmation(command: string, naturalLanguage?: string): Promise<void> {
  const config = await getConfig();

  if (process.env.NL_TERMINAL_CLI_DRY_RUN === '1') {
    printInfo(`[dry-run] ${command}`);
    return;
  }
  
  if (config.settings.confirmBeforeExecute && process.env.NL_TERMINAL_CLI_ASSUME_YES !== '1') {
    const shouldExecute = await promptConfirm(`Execute: ${chalk.yellow(command)}?`);
    if (!shouldExecute) {
      printInfo('Execution cancelled');
      return;
    }
  }

  // Extra warning and confirmation for dangerous commands (rm, sudo, etc.)
  const shouldProceed = await checkRiskyCommandAndConfirm(command);
  if (!shouldProceed) {
    printInfo('Execution cancelled');
    return;
  }
  
  const result = await executeInTerminal(command, config.defaultShell);
  
  // Add to history if saveHistory is enabled
  if (config.settings.saveHistory) {
    await addToHistory(
      naturalLanguage || command,
      command,
      result.success,
      result.exitCode,
      result.output,
      result.error,
      []
    );
  }
  
  if (result.success) {
    if (result.output) {
      // Apply same formatting as executeInteractive for ls commands
      const formattedOutput = formatCommandOutput(command, result.output);
      console.log(formattedOutput);
    }
    printSuccess('Command executed successfully');
  } else {
    printError(`Command failed with exit code ${result.exitCode}`);
    if (result.error) {
      console.error(chalk.red(result.error));
    }
  }
}

/**
 * Browse command history and sessions
 */
async function browseHistory(): Promise<void> {
  pushMenu('history');
  
  while (true) {
    const result = await selectFromSubmenu<string>('📜 History Options:', [
      { name: chalk.green('👁️  View recent commands') + chalk.gray(' - Show last commands from all sessions'), value: 'recent' },
      { name: chalk.blue('📁 Browse sessions') + chalk.gray(' - View previous sessions and their commands'), value: 'sessions' },
      { name: chalk.blue('🔁 Reload/Continue Session') + chalk.gray(' - Load a previous session to continue adding commands'), value: 'reload' },
      { name: chalk.yellow('🔍 Search history') + chalk.gray(' - Search through command history'), value: 'search' },
      { name: chalk.cyan('📤 Export/Share') + chalk.gray(' - Export history to file'), value: 'export' },
      { name: chalk.magenta('🗑️  Manage') + chalk.gray(' - Clear history or delete sessions'), value: 'manage' }
    ]);
    
    if (result.action === 'back' || result.action === null) {
      popMenu();
      return;
    }
    
    if (result.action === 'main') {
      clearMenuStack();
      return;
    }
    
    if (result.action === 'select' && result.value) {
      switch (result.value) {
        case 'recent':
          await viewRecentCommands();
          break;
        case 'sessions':
          await browseSessions();
          break;
        case 'reload':
          await reloadSessionUI();
          break;
        case 'search':
          await searchHistoryMenu();
          break;
        case 'export':
          await exportHistoryMenu();
          break;
        case 'manage':
          await manageHistory();
          break;
      }
      if (isAtMainMenu()) {
        return;
      }
    }
  }
}

async function reloadSessionUI(): Promise<void> {
  const sessions = await getAllSessions();
  
  if (sessions.length === 0) {
    printWarning('No sessions available to reload');
    return;
  }
  
  console.log(chalk.bold('\n🔁 Select a session to reload:\n'));
  
  const choices = sessions.slice().reverse().map((session) => {
    const cmdCount = session.commands.length;
    const status = session.endTime ? chalk.gray('(ended)') : chalk.green('(active)');
    const date = formatUTC(session.startTime);
    return {
      name: `${session.name || 'Unnamed'} ${status} - ${cmdCount} commands - ${date}`,
      value: session
    };
  });
  
  const selected = await selectFromList<Session>('Select a session to reload:', choices);
  
  if (selected) {
    const session = await reloadSession(selected.id);
    
    if (session) {
      printSuccess(`Session '${session.name}' loaded with ${session.commands.length} commands`);
      
      if (session.commands.length > 0) {
        console.log(chalk.gray('\nPrevious commands in this session:\n'));
        session.commands.forEach((cmd, idx) => {
          console.log(`${idx + 1}. ${formatHistoryEntry(cmd)}`);
          if (cmd.output) {
            console.log(chalk.gray(`   Output: ${cmd.output.substring(0, 100)}${cmd.output.length > 100 ? '...' : ''}`));
          }
        });
      }
      
      console.log(chalk.gray('\n─────────────────────────────────────'));
      printInfo('You can now continue this session. The new commands will be added to this session.');
    } else {
      printError('Failed to reload session');
    }
  }
}

async function viewRecentCommands(): Promise<void> {
  const recent = await getRecentCommands(20);
  
  if (recent.length === 0) {
    printWarning('No command history yet');
    return;
  }
  
  console.log(chalk.bold('\n📜 Recent Commands:\n'));
  
  const choices = recent.map((cmd: CommandHistoryEntry, idx: number) => ({
    name: `${idx + 1}. ${formatHistoryEntryInline(cmd)}`,
    value: cmd
  }));
  
  const selected = await selectFromList<CommandHistoryEntry>('Select a command to run again:', choices);
  
  if (selected) {
    const shouldRun = await promptConfirm(`Run: "${selected.command}"?`, true);
    if (shouldRun) {
      await executeWithConfirmation(selected.command, selected.naturalLanguage);
    }
  }
}

async function browseSessions(): Promise<void> {
  pushMenu('browse-sessions');
  
  const sessions = await getAllSessions();
  const activeIds = getActiveSessions();
  
  if (sessions.length === 0) {
    printWarning('No saved sessions');
    popMenu();
    return;
  }
  
  console.log(chalk.bold('\n📁 Sessions:\n'));
  
  const choices: { name: string; value: Session }[] = [];
  
  for (const session of sessions.slice().reverse()) {
    const cmdCount = session.commands.length;
    const date = formatUTC(session.startTime);
    const isCurrent = session.id === getCurrentActiveSessionId();
    const isActiveInThisTerminal = activeIds.includes(session.id);
    
    // Check terminal ownership for more accurate status
    const isOwnedByCurrent = await isSessionOwnedByCurrentTerminal(session.id);
    const owner = await getSessionOwner(session.id);
    
    let status: string;
    let ownerInfo = '';
    
    if (isCurrent) {
      status = chalk.green('(current)');
    } else if (isActiveInThisTerminal) {
      status = chalk.yellow('(active)');
    } else if (session.endTime) {
      status = chalk.gray('(ended)');
    } else if (owner && !isOwnedByCurrent) {
      // Session is owned by another terminal but not ended
      status = chalk.red('(in use)');
      ownerInfo = ` - ${chalk.yellow(getTerminalDisplayName(owner))}`;
    } else {
      // Session has no endTime but isn't owned by anyone - it's orphaned/available
      status = chalk.gray('(available)');
    }
    
    choices.push({
      name: `${session.name || 'Unnamed'} ${status} - ${cmdCount} commands - ${date}${ownerInfo}`,
      value: session
    });
  }
  
  const result = await selectFromSubmenu<Session>('Select a session to view:', choices, true, true);
  
  if (result.action === 'back' || result.action === null) {
    popMenu();
    return;
  }
  
  if (result.action === 'main') {
    clearMenuStack();
    return;
  }
  
  if (result.action === 'select' && result.value) {
    await viewSessionCommands(result.value.id);
  }
  
  popMenu();
}

async function searchHistoryMenu(): Promise<void> {
  const query = await promptInput('Search for commands:');
  
  if (!query.trim()) {
    printWarning('No search query provided');
    return;
  }
  
  const results = await searchHistory(query);
  
  if (results.length === 0) {
    printWarning('No commands found matching your search');
    return;
  }
  
  printSuccess(`Found ${results.length} command(s)`);
  
  const choices = results.slice(0, 20).map((cmd: CommandHistoryEntry, idx: number) => ({
    name: `${idx + 1}. ${formatHistoryEntryInline(cmd)}`,
    value: cmd
  }));
  
  const selected = await selectFromList<CommandHistoryEntry>('Select a command to run again:', choices);
  
  if (selected) {
    const shouldRun = await promptConfirm(`Run: "${selected.command}"?`, true);
    if (shouldRun) {
      await executeWithConfirmation(selected.command, selected.naturalLanguage);
    }
  }
}

async function exportHistoryMenu(): Promise<void> {
  const format = await selectFromList<'json' | 'txt' | 'markdown'>('Select export format:', [
    { name: chalk.yellow('📄 JSON') + chalk.gray(' - Machine readable'), value: 'json' },
    { name: chalk.white('📝 Text') + chalk.gray(' - Human readable'), value: 'txt' },
    { name: chalk.blue('📘 Markdown') + chalk.gray(' - For sharing/documentation'), value: 'markdown' }
  ]);

  if (!format) return;

  const exportScope = await selectFromList<'all' | 'session' | 'select-session'>('Export scope:', [
    { name: chalk.cyan('📦 All history') + chalk.gray(' - All commands'), value: 'all' },
    { name: chalk.green('📁 Current session') + chalk.gray(' - Only this session'), value: 'session' },
    { name: chalk.magenta('📂 Select specific session') + chalk.gray(' - Choose a session'), value: 'select-session' }
  ]);

  if (!exportScope) return;

  let selectedSessionId: string | undefined;

  if (exportScope === 'select-session') {
    const sessions = await getAllSessions();
    if (sessions.length === 0) {
      printWarning('No sessions available to export');
      return;
    }

    const choices = sessions.slice().reverse().map((session, idx: number) => ({
      name: `${idx + 1}. ${session.name || 'Unnamed'} - ${session.commands.length} commands`,
      value: session.id
    }));

    const sessionResult = await selectFromList<string>('Select session to export:', choices);
    if (!sessionResult) return;
    selectedSessionId = sessionResult;
  }

  // Ask for export location
  const exportLocation = await selectFromList<'default' | 'custom'>('Export location:', [
    { name: chalk.cyan('📁 Default folder') + chalk.gray(' - ~/.nl-terminal-cli/sessions/'), value: 'default' },
    { name: chalk.yellow('📂 Custom folder') + chalk.gray(' - Choose your own path'), value: 'custom' }
  ]);

  if (!exportLocation) return;

  let customPath: string | undefined;
  if (exportLocation === 'custom') {
    const inputPath = await promptInput('Enter folder path:', '');
    if (!inputPath.trim()) {
      printWarning('No folder path provided, using default');
    } else {
      customPath = inputPath.trim();
    }
  }

  const defaultFilename = `nl-terminal-history-${new Date().toISOString().split('T')[0]}.${format}`;
  const filename = await promptInput('Export filename:', defaultFilename);

  if (!filename.trim()) {
    printWarning('No filename provided');
    return;
  }

  try {
    const fullPath = await exportHistory(
      filename,
      format,
      selectedSessionId,
      customPath
    );
    printSuccess(`History exported to: ${fullPath}`);

    // Offer to view markdown files with glow
    if (format === 'markdown' && fullPath.endsWith('.md')) {
      const viewWithGlow = await promptConfirm('View with glow (markdown renderer)?', true);
      if (viewWithGlow) {
        await executeEditor(`glow "${fullPath}"`);
      }
    }
  } catch (error) {
    printError(`Export failed: ${error}`);
  }
}

async function manageHistory(): Promise<void> {
  pushMenu('history-manage');
  
  while (true) {
    const result = await selectFromSubmenu<string>('History Management:', [
      { name: chalk.red('🗑️  Clear all history') + chalk.gray(' - Delete everything'), value: 'clear' },
      { name: chalk.yellow('📁 Delete session') + chalk.gray(' - Remove specific session'), value: 'delete-session' }
    ]);
    
    if (result.action === 'back' || result.action === null) {
      popMenu();
      return;
    }
    
    if (result.action === 'main') {
      clearMenuStack();
      return;
    }
    
    if (result.action === 'select' && result.value) {
      switch (result.value) {
        case 'clear':
          const confirmClear = await promptConfirm(
            chalk.red('⚠️  WARNING: This will delete ALL command history. Continue?'),
            false
          );
          if (confirmClear) {
            await clearHistory();
            printSuccess('History cleared');
          }
          break;
          
        case 'delete-session':
          const sessions = await getAllSessions();
          if (sessions.length === 0) {
            printWarning('No sessions to delete');
            break;
          }
          
          const choices = sessions.slice().reverse().map((session, idx: number) => ({
            name: `${idx + 1}. ${session.name || 'Unnamed'} - ${session.commands.length} commands`,
            value: session.id
          }));
          
          const sessionResult = await selectFromSubmenu<string>('Select session to delete:', choices, true, true);
          
          if (sessionResult.action === 'back') {
            break; // Go back to manage menu
          }
          
          if (sessionResult.action === 'main') {
            clearMenuStack();
            return;
          }
          
          if (sessionResult.action === 'select' && sessionResult.value) {
            const confirmDelete = await promptConfirm('Are you sure?', false);
            if (confirmDelete) {
              await deleteSession(sessionResult.value);
              printSuccess('Session deleted');
            }
          }
          if (isAtMainMenu()) {
            return;
          }
          break;
      }
      if (isAtMainMenu()) {
        return;
      }
    }
  }
}

async function viewSessionCommands(sessionId: string): Promise<void> {
  pushMenu('view-session-commands');
  
  const sessions = await getAllSessions();
  const session = sessions.find(s => s.id === sessionId);
  
  if (!session || session.commands.length === 0) {
    printWarning('Session not found or empty');
    popMenu();
    return;
  }
  
  console.log(chalk.bold(`\n📜 Session: ${session.name || 'Unnamed'}\n`));
  
  const choices = session.commands.map((cmd: CommandHistoryEntry, idx: number) => ({
    name: `${idx + 1}. ${formatHistoryEntryInline(cmd)}`,
    value: cmd
  }));
  
  const result = await selectFromSubmenu<CommandHistoryEntry>('Select a command to run again:', choices, true, true);
  
  if (result.action === 'back' || result.action === null) {
    popMenu();
    return;
  }
  
  if (result.action === 'main') {
    clearMenuStack();
    return;
  }
  
  if (result.action === 'select' && result.value) {
    const shouldRun = await promptConfirm(`Run: "${result.value.command}"?`, true);
    if (shouldRun) {
      await executeWithConfirmation(result.value.command, result.value.naturalLanguage);
    }
  }
  
  popMenu();
}
