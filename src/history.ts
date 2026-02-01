import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

export interface CommandHistoryEntry {
  id: string;
  naturalLanguage: string;
  command: string;
  timestamp: string;
  success: boolean;
  exitCode: number;
  output?: string;
  error?: string;
  sessionId?: string;
  tags?: string[];
}

export interface Session {
  id: string;
  startTime: string;
  endTime?: string;
  commands: CommandHistoryEntry[];
  name?: string;
}

const HISTORY_DIR = path.join(os.homedir(), '.nl-terminal-cli');
const HISTORY_FILE = path.join(HISTORY_DIR, 'history.json');
const SESSIONS_FILE = path.join(HISTORY_DIR, 'sessions.json');
const SESSIONS_EXPORT_DIR = path.join(HISTORY_DIR, 'sessions');

let currentSessionId: string | null = null;
let activeSessions: Set<string> = new Set();
let currentActiveSessionId: string | null = null;

/**
 * Ensure history directory exists
 */
async function ensureHistoryDir(): Promise<void> {
  try {
    await fs.mkdir(HISTORY_DIR, { recursive: true });
  } catch {
    // Directory already exists
  }
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Start a new session (legacy - now delegates to createNewSession)
 */
export async function startSession(name?: string): Promise<string> {
  return createNewSession(name);
}

/**
 * End the current session (legacy - closes the current active session)
 */
export async function endSession(): Promise<void> {
  if (currentActiveSessionId) {
    await closeSession(currentActiveSessionId);
  } else if (currentSessionId) {
    await closeSession(currentSessionId);
  }
}

/**
 * Get all sessions
 */
async function getSessions(): Promise<Session[]> {
  try {
    const data = await fs.readFile(SESSIONS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

/**
 * Save sessions
 */
async function saveSessions(sessions: Session[]): Promise<void> {
  await ensureHistoryDir();
  await fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

/**
 * Get the current session ID
 */
export function getCurrentSessionId(): string | null {
  return currentSessionId;
}

/**
 * Add a command to history
 */
export async function addToHistory(
  naturalLanguage: string,
  command: string,
  success: boolean,
  exitCode: number,
  output?: string,
  error?: string,
  tags?: string[]
): Promise<void> {
  await ensureHistoryDir();
  
  // Ensure we have an active session
  if (!currentActiveSessionId) {
    await initMultiSession();
    // If still no active session, create one
    if (!currentActiveSessionId) {
      await createNewSession();
    }
  }
  
  const targetSessionId = currentActiveSessionId || currentSessionId;
  
  const entry: CommandHistoryEntry = {
    id: generateId(),
    naturalLanguage,
    command,
    timestamp: new Date().toISOString(),
    success,
    exitCode,
    output,
    error,
    sessionId: targetSessionId || undefined,
    tags
  };
  
  // Add to session
  const sessions = await getSessions();
  const session = sessions.find(s => s.id === targetSessionId);
  if (session) {
    session.commands.push(entry);
    await saveSessions(sessions);
  }
  
  // Also add to flat history file for easy access
  const history = await getHistory();
  history.push(entry);
  await saveHistory(history);
}

/**
 * Get all command history
 */
export async function getHistory(): Promise<CommandHistoryEntry[]> {
  try {
    const data = await fs.readFile(HISTORY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

/**
 * Save history
 */
async function saveHistory(history: CommandHistoryEntry[]): Promise<void> {
  await ensureHistoryDir();
  await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
}

/**
 * Get recent commands
 */
export async function getRecentCommands(limit: number = 10): Promise<CommandHistoryEntry[]> {
  const history = await getHistory();
  return history.slice(-limit).reverse();
}

/**
 * Get commands by session
 */
export async function getSessionCommands(sessionId: string): Promise<CommandHistoryEntry[]> {
  const sessions = await getSessions();
  const session = sessions.find(s => s.id === sessionId);
  return session?.commands || [];
}

/**
 * Get all sessions with command counts
 */
export async function getAllSessions(): Promise<Session[]> {
  return await getSessions();
}

/**
 * Set the current session by ID
 * Returns true if session exists and was set, false otherwise
 */
export function setCurrentSession(sessionId: string): boolean {
  // Note: This function only updates the in-memory currentSessionId
  // The actual existence check happens in reloadSession
  currentSessionId = sessionId;
  return true;
}

/**
 * Reload a session by ID
 * Sets it as the current active session and returns the session object
 */
export async function reloadSession(sessionId: string): Promise<Session | null> {
  const sessions = await getSessions();
  const session = sessions.find(s => s.id === sessionId);
  
  if (!session) {
    return null;
  }
  
  // Add to active sessions and make it the current active session
  activeSessions.add(sessionId);
  currentActiveSessionId = sessionId;
  currentSessionId = sessionId;
  
  // Remove endTime if session was previously ended
  if (session.endTime) {
    delete session.endTime;
    await saveSessions(sessions);
  }
  
  return session;
}

/**
 * Export history to a file
 * Saves to sessions folder by default
 */
export async function exportHistory(
  filename: string,
  format: 'json' | 'txt' | 'markdown' = 'json',
  sessionId?: string
): Promise<string> {
  // Ensure sessions export directory exists
  await fs.mkdir(SESSIONS_EXPORT_DIR, { recursive: true });
  
  // Build full filepath in sessions folder
  const fullFilename = filename.endsWith(`.${format}`) ? filename : `${filename}.${format}`;
  const filepath = path.join(SESSIONS_EXPORT_DIR, fullFilename);
  
  let commands: CommandHistoryEntry[];
  
  if (sessionId) {
    commands = await getSessionCommands(sessionId);
  } else {
    commands = await getHistory();
  }
  
  let content: string;
  
  switch (format) {
    case 'json':
      content = JSON.stringify(commands, null, 2);
      break;
    case 'txt':
      content = commands.map(cmd => {
        let entry = `[${new Date(cmd.timestamp).toLocaleString()}] ${cmd.naturalLanguage}\n` +
          `Command: ${cmd.command}\n` +
          `Status: ${cmd.success ? '✓' : '✗'} (exit code: ${cmd.exitCode})\n`;
        if (cmd.output) {
          entry += `Output:\n${cmd.output}\n`;
        }
        if (cmd.error) {
          entry += `Error:\n${cmd.error}\n`;
        }
        entry += `${'─'.repeat(60)}`;
        return entry;
      }).join('\n\n');
      break;
    case 'markdown':
      content = '# NL Terminal Command History\n\n' +
        commands.map(cmd => {
          let entry = `## ${cmd.naturalLanguage}\n\n` +
            `- **Command:** \`\`\`bash\n${cmd.command}\n\`\`\`\n` +
            `- **Time:** ${new Date(cmd.timestamp).toLocaleString()}\n` +
            `- **Status:** ${cmd.success ? '✅ Success' : '❌ Failed'}\n` +
            `- **Exit Code:** ${cmd.exitCode}\n`;
          if (cmd.output) {
            entry += `- **Output:** \`\`\`\n${cmd.output}\n\`\`\`\n`;
          }
          if (cmd.error) {
            entry += `- **Error:** \`\`\`\n${cmd.error}\n\`\`\`\n`;
          }
          return entry;
        }).join('\n---\n\n');
      break;
  }
  
  await fs.writeFile(filepath, content);
  return filepath;
}

/**
 * Search history
 */
export async function searchHistory(query: string): Promise<CommandHistoryEntry[]> {
  const history = await getHistory();
  const queryLower = query.toLowerCase();
  
  return history.filter(cmd => 
    cmd.naturalLanguage.toLowerCase().includes(queryLower) ||
    cmd.command.toLowerCase().includes(queryLower) ||
    cmd.tags?.some(tag => tag.toLowerCase().includes(queryLower))
  );
}

/**
 * Clear history
 */
export async function clearHistory(): Promise<void> {
  await ensureHistoryDir();
  await fs.writeFile(HISTORY_FILE, '[]');
  await fs.writeFile(SESSIONS_FILE, '[]');
}

/**
 * Delete a specific session
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  const sessions = await getSessions();
  const index = sessions.findIndex(s => s.id === sessionId);
  
  if (index === -1) return false;
  
  sessions.splice(index, 1);
  await saveSessions(sessions);
  
  // Also remove commands from flat history that belong to this session
  const history = await getHistory();
  const filtered = history.filter(cmd => cmd.sessionId !== sessionId);
  await saveHistory(filtered);
  
  return true;
}

/**
 * Format history entry for display
 */
export function formatHistoryEntry(entry: CommandHistoryEntry): string {
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const status = entry.success ? chalk.green('✓') : chalk.red('✗');
  const nl = chalk.cyan(entry.naturalLanguage);
  const cmd = chalk.yellow(entry.command);
  
  return `${chalk.gray(time)} ${status} ${nl}\n   ${chalk.gray('→')} ${cmd}`;
}

/**
 * Format history entry for single-line menu display
 */
export function formatHistoryEntryInline(entry: CommandHistoryEntry): string {
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const status = entry.success ? chalk.green('✓') : chalk.red('✗');
  const nl = chalk.cyan(entry.naturalLanguage);
  const cmd = chalk.yellow(entry.command);
  
  return `${chalk.gray(time)} ${status} ${nl} ${chalk.gray('→')} ${cmd}`;
}

/**
 * Multi-Session Management Functions
 */

/**
 * Get list of all active session IDs
 */
export function getActiveSessions(): string[] {
  return Array.from(activeSessions);
}

/**
 * Get the currently active session ID (the one receiving commands)
 */
export function getCurrentActiveSessionId(): string | null {
  return currentActiveSessionId;
}

/**
 * Switch the currently active session
 * Returns true if successful, false if session doesn't exist
 */
export async function switchActiveSession(sessionId: string): Promise<boolean> {
  const sessions = await getSessions();
  const session = sessions.find(s => s.id === sessionId);
  
  if (!session) {
    return false;
  }
  
  // If session was ended, reopen it
  if (session.endTime) {
    delete session.endTime;
    await saveSessions(sessions);
  }
  
  activeSessions.add(sessionId);
  currentActiveSessionId = sessionId;
  currentSessionId = sessionId; // Maintain backward compatibility
  
  return true;
}

/**
 * Create a new session and make it active
 */
export async function createNewSession(name?: string): Promise<string> {
  await ensureHistoryDir();
  
  const sessionId = generateId();
  const sessionName = name || `Session ${new Date().toLocaleString()}`;
  
  const session: Session = {
    id: sessionId,
    startTime: new Date().toISOString(),
    name: sessionName,
    commands: []
  };
  
  const sessions = await getSessions();
  sessions.push(session);
  await saveSessions(sessions);
  
  // Add to active sessions and make it the current active session
  activeSessions.add(sessionId);
  currentActiveSessionId = sessionId;
  currentSessionId = sessionId;
  
  return sessionId;
}

/**
 * Get session info by ID
 */
export async function getSessionInfo(sessionId: string): Promise<Session | null> {
  const sessions = await getSessions();
  const session = sessions.find(s => s.id === sessionId);
  return session || null;
}

/**
 * Close a specific session (marks it as ended but keeps history)
 * Returns true if successful, false if session not found
 */
export async function closeSession(sessionId: string): Promise<boolean> {
  const sessions = await getSessions();
  const session = sessions.find(s => s.id === sessionId);
  
  if (!session) {
    return false;
  }
  
  // Mark session as ended
  session.endTime = new Date().toISOString();
  await saveSessions(sessions);
  
  // Remove from active sessions
  activeSessions.delete(sessionId);
  
  // If this was the current active session, switch to another active session
  if (currentActiveSessionId === sessionId) {
    const remainingActive = Array.from(activeSessions);
    if (remainingActive.length > 0) {
      currentActiveSessionId = remainingActive[0];
      currentSessionId = remainingActive[0];
    } else {
      currentActiveSessionId = null;
      currentSessionId = null;
    }
  }
  
  return true;
}

/**
 * Check if a session is currently active
 */
export function isSessionActive(sessionId: string): boolean {
  return activeSessions.has(sessionId);
}

/**
 * Initialize multi-session support on startup
 * If no sessions exist, creates a default session
 */
export async function initMultiSession(): Promise<void> {
  const sessions = await getSessions();
  
  // If no sessions exist at all, create a default one
  if (sessions.length === 0) {
    await createNewSession('Default Session');
    return;
  }
  
  // If we have a currentSessionId but it's not active, add it
  if (currentSessionId && !activeSessions.has(currentSessionId)) {
    const session = sessions.find(s => s.id === currentSessionId);
    if (session && !session.endTime) {
      activeSessions.add(currentSessionId);
      if (!currentActiveSessionId) {
        currentActiveSessionId = currentSessionId;
      }
    }
  }
}
