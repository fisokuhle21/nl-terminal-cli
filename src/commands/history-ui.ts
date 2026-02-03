import chalk from 'chalk';
import { getAllSessions, getRecentCommands, searchHistory, exportHistory, clearHistory, deleteSession, formatHistoryEntry, formatHistoryEntryInline, reloadSession, getActiveSessions, getCurrentActiveSessionId, getSessionInfo, getSessionOwner, isSessionOwnedByCurrentTerminal, getTerminalDisplayName } from '../history.js';
import type { CommandHistoryEntry, Session } from '../history.js';
import { executeWithConfirmation } from './execute-core.js';
import { formatUTC } from '../history.js';
import { clearMenuStack, isAtMainMenu, popMenu, pushMenu } from './menu-stack.js';
import { executeEditor, printError, printInfo, printSuccess, printWarning, promptConfirm, promptInput, promptInputWithAutocomplete, selectFromList, selectFromSubmenu } from '../utils.js';
import { getConfig } from '../config.js';

export async function browseHistory(): Promise<void> {
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

export async function reloadSessionUI(): Promise<void> {
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

export async function browseSessions(): Promise<void> {
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
  const config = await getConfig();
  const useAutocomplete = config.settings.enableAutocomplete !== false;
  
  let query: string;
  if (useAutocomplete) {
    const result = await promptInputWithAutocomplete('Search for commands:', undefined, 'commands');
    // Handle ESC cancellation (returns { cancelled: true })
    if (typeof result === 'object' && result !== null && 'cancelled' in result && result.cancelled === true) {
      return;
    }
    query = result as string;
  } else {
    const result = await promptInput('Search for commands:');
    if (result === null) {
      return;
    }
    query = result;
  }

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
