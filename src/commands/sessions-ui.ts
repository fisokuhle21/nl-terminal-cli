import chalk from 'chalk';
import { getAllSessions, getActiveSessions, switchActiveSession, createNewSession, getSessionInfo, closeSession, getCurrentActiveSessionId, getSessionsOwnedByOtherTerminals, getActiveTerminals, getTerminalDisplayName, isSessionOwnedByCurrentTerminal, getSessionOwner, getTerminalId, getSessionKey, getCurrentTerminalSessionKeys, takeoverSessionWithKey, createTakeoverRequest, getPendingTakeoverRequests, approveTakeoverRequest, denyTakeoverRequest, checkTakeoverRequestStatus, detachSession, formatUTC, Session, TerminalInfo, TakeoverRequest } from '../history.js';
import { clearMenuStack, isAtMainMenu, popMenu, pushMenu } from './menu-stack.js';
import { printError, printInfo, printSuccess, printWarning, promptConfirm, promptInput, selectFromList, selectFromSubmenu } from '../utils.js';
import { browseSessions, reloadSessionUI } from './history-ui.js';
import { banner } from '../cli.js';
import { clearScreen } from '../utils.js';

export async function manageSessions(): Promise<void> {
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

export async function reattachToSessionUI(): Promise<boolean> {
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
