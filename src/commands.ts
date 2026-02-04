import chalk from 'chalk';
import { getConfig, getMappings, addMapping, saveMenuStyle } from './config.js';
import { findBestMatch, findMultipleMatches, findBestMatchFromDatabase, findMultipleMatchesFromDatabase, parseCommand, parseUserMapping, replacePlaceholders, detectCompoundCommand } from './matcher.js';
// Re-export for testing
export { detectCompoundCommand };
import { isGitRepository } from './git.js';
import {
  promptInput,
  promptInputWithAutocomplete,
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
  shouldUsePlainMenu
} from './utils.js';
import { banner } from './cli.js';
import type { CommandMapping, DatabaseMatchResult } from './types.js';
import { getActiveSessions, createNewSession, getSessionInfo, closeSession, getCurrentActiveSessionId, initMultiSession, getActiveTerminals, getTerminalDisplayName, TerminalInfo, TakeoverRequest, checkSessionTakeover, detachSession, getPendingTakeoverRequests } from './history.js';
import { executeCompoundAlias, executeCompoundCommand, findCompoundAliasMatch, parseCompoundCommand } from './commands/compound.js';
export { parseCompoundCommand };
import { pushMenu, popMenu, isAtMainMenu, clearMenuStack } from './commands/menu-stack.js';
import { searchFiles } from './commands/search.js';
export { searchFiles };
import { browseHistory } from './commands/history-ui.js';
import { executeWithConfirmation } from './commands/execute-core.js';
export { executeWithConfirmation };
import { gitMenu } from './commands/git-ui.js';
import { manageSessions, reattachToSessionUI } from './commands/sessions-ui.js';
import { browseDatabase } from './commands/database-ui.js';
export { browseDatabase };
import { ensureDatabase } from './commands/db-core.js';
import { getAllCommands } from './database.js';
import { listMappings } from './commands/mappings-ui.js';
export { listMappings };
import { configureMappings } from './commands/config-ui.js';
import { platformMenu } from './commands/platform-ui.js';
import { hasActiveConflictSession, loadConflictSession, conflictResolutionFlow } from './commands/conflict-helper.js';
export { configureMappings };

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




export async function mainLoop(): Promise<void> {
  await ensureDatabase();
  await initMultiSession();
  await loadMenuStyle();
  // Check for active PR conflict resolution sessions
  if (hasActiveConflictSession()) {
    const session = loadConflictSession();
    if (session) {
      const resume = await promptConfirm(
        chalk.yellow(`Resume conflict resolution for PR #${session.prNumber}: "${session.prTitle}"?`),
        true
      );
      if (resume) {
        await conflictResolutionFlow(session.prNumber, session.prTitle, session.platform);
      }
    }
  }
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
  
  async function getSessionDisplayInfo(): Promise<{ info: string; pendingRequests: TakeoverRequest[]; builtInCount: number }> {
    const currentSessionId = getCurrentActiveSessionId();
    const pendingRequests = await getPendingTakeoverRequests();
    
    if (!currentSessionId) return { info: chalk.gray('No active session'), pendingRequests, builtInCount: 0 };
    
    const session = await getSessionInfo(currentSessionId);
    if (!session) return { info: chalk.gray('No active session'), pendingRequests, builtInCount: 0 };
    
    const activeCount = getActiveSessions().length;
    const cmdCount = session.commands.length;
    let builtInCount = 0;
    try {
      const commands = await getAllCommands();
      builtInCount = commands.length;
    } catch {
      builtInCount = 0;
    }
    
    // Check for other terminals
    const otherTerminals = await getActiveTerminals();
    const otherCount = otherTerminals.length - 1; // Exclude current terminal
    
    let terminalInfo = '';
    if (otherCount > 0) {
      terminalInfo = chalk.yellow(` | ${otherCount} other terminal${otherCount !== 1 ? 's' : ''}`);
    }
    
    const info = `${chalk.cyan(session.name || 'Unnamed')} ${chalk.gray(`(${cmdCount} commands, ${activeCount} active session${activeCount !== 1 ? 's' : ''}${terminalInfo}, ${builtInCount} built-in commands)`)} `;
    
    return { info, pendingRequests, builtInCount };
  }
  
  async function showMenu(): Promise<string | null> {
    const { info: sessionInfo, pendingRequests, builtInCount } = await getSessionDisplayInfo();
    
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
      const shortcutLine2 = '(g)it | e(x)tras | (n)ew session | (c)lear | (t)oggle | (q)uit';
      const shortcutLine3 = '(h)elp | (p)Rs';
      console.log(chalk.gray(`Options: ${shortcutLine1}`));
      console.log(chalk.gray(`         ${shortcutLine2}`));
      console.log(chalk.gray(`         ${shortcutLine3}\n`));
      
      // Expand style: single-key shortcuts for quick access
      const isGitRepo = isGitRepository();
      const gitLabel = isGitRepo 
        ? chalk.green('Git') + chalk.gray(' - Diff, branches, commit, push/pull')
        : chalk.gray('Git') + chalk.gray(' - Not a git repository');
      
      const expandOptions = [
        { name: chalk.green('Execute a command') + chalk.gray(' - Type natural language to run'), value: 'execute', key: 'e' },
        { name: chalk.blue('Search for files') + chalk.gray(' - Find files by description'), value: 'search', key: 's' },
        { name: chalk.yellow('List saved commands') + chalk.gray(' - View your command mappings'), value: 'list', key: 'l' },
        { name: chalk.magenta('Configure mappings') + chalk.gray(' - Add/edit/delete commands'), value: 'config', key: 'm' },
        { name: chalk.cyan(`Built-in commands (${builtInCount})`) + chalk.gray(' - View pre-built command database'), value: 'database', key: 'b' },
        { name: chalk.green('Recent history') + chalk.gray(' - View and re-run previous commands'), value: 'history', key: 'r' },
        { name: chalk.blue('Git PRs') + chalk.gray(' - Create, merge, manage pull requests'), value: 'git-platform', key: 'p' },
        { name: gitLabel, value: 'git', key: 'g' },
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
      const isGitRepo = isGitRepository();
      const gitLabel = isGitRepo 
        ? chalk.green('⎇  Git') + chalk.gray(' - Diff, branches, commit, push/pull')
        : chalk.gray('⎇  Git') + chalk.gray(' - Not a git repository');
      
      const menuOptions = [
        { name: chalk.green('🚀 Execute a command') + chalk.gray(' - Type natural language to run'), value: 'execute' },
        { name: chalk.blue('🔍 Search for files') + chalk.gray(' - Find files by description'), value: 'search' },
        { name: chalk.yellow('📋 List saved commands') + chalk.gray(' - View your command mappings'), value: 'list' },
        { name: chalk.magenta('⚙️  Configure mappings') + chalk.gray(' - Add/edit/delete commands'), value: 'config' },
        { name: chalk.cyan(`📚 Built-in commands (${builtInCount})`) + chalk.gray(' - View pre-built command database'), value: 'database' },
        { name: chalk.green('📜 Recent history') + chalk.gray(' - View and re-run previous commands'), value: 'history' },
        { name: chalk.blue('🔀 Git PRs') + chalk.gray(' - Create, merge, manage pull requests'), value: 'git-platform' },
        { name: gitLabel, value: 'git' },
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
    
    if (isAtMainMenu()) {
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
      case 'git-platform':
        await platformMenu();
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
      case 'git':
        await gitMenu();
        break;
    }
  }
}

async function executeCommandFromMenu(): Promise<void> {
  console.log(chalk.gray('💡 Tip: You can chain multiple commands using:'));
  console.log(chalk.gray('   "and", "then", "after that", "followed by", ";", "&&"'));
  console.log(chalk.gray('   Example: "create folder test and list files"\n'));

  const config = await getConfig();
  const useAutocomplete = config.settings.enableAutocomplete !== false;

  let input = '';
  if (useAutocomplete) {
    const result = await promptInputWithAutocomplete(chalk.cyan('Enter your command in natural language:'), undefined, 'smart');
    if (typeof result === 'object' && result !== null && 'cancelled' in result && result.cancelled === true) {
      return;
    }
    input = result as string;
  } else {
    input = await promptInput(chalk.cyan('Enter your command in natural language:'));
  }

  if (!input || !input.trim()) {
    printWarning('No command provided');
    return;
  }

  await executeCommand(input);
}

/**
 * Manage sessions: create, switch, view, and close sessions
 */


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



// mappings UI moved to config-ui.ts

// compound alias UI moved to config-ui.ts

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
