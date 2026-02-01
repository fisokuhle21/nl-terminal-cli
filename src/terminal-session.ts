/**
 * Terminal Session Manager
 * 
 * Handles multi-terminal session support by:
 * 1. Identifying unique terminals using TTY path, process ID, and environment
 * 2. Tracking active sessions across different terminal windows
 * 3. Using file-based locking for cross-process coordination
 * 4. Providing real-time session state synchronization
 * 5. Session keys for secure takeover authentication
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { EventEmitter } from 'events';

// Terminal identification info
export interface TerminalInfo {
  id: string;           // Unique terminal identifier
  pid: number;          // Process ID
  tty: string | null;   // TTY path (e.g., /dev/ttys001)
  startTime: string;    // When this terminal instance started
  hostname: string;     // Machine hostname
  user: string;         // Current user
  cwd: string;          // Current working directory
  shell: string;        // Shell being used
  sessionKey?: string;  // Random key for session takeover authentication
}

// Session ownership info
export interface SessionOwnership {
  sessionId: string;
  terminalId: string;
  pid: number;
  acquiredAt: string;
  lastHeartbeat: string;
  sessionKey: string;   // Random key required for takeover
}

// Takeover request info
export interface TakeoverRequest {
  id: string;
  sessionId: string;
  requestingTerminalId: string;
  owningTerminalId: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  expiresAt: string;
}

// Active terminals registry
export interface TerminalRegistry {
  terminals: Record<string, TerminalInfo>;
  sessionOwnership: Record<string, SessionOwnership>;
  takeoverRequests: Record<string, TakeoverRequest>;
  lastUpdated: string;
}

const HISTORY_DIR = path.join(os.homedir(), '.nl-terminal-cli');
const TERMINAL_REGISTRY_FILE = path.join(HISTORY_DIR, 'terminal-registry.json');
const LOCK_FILE = path.join(HISTORY_DIR, '.registry.lock');
const HEARTBEAT_INTERVAL = 5000; // 5 seconds
const STALE_THRESHOLD = 15000;   // 15 seconds - terminal considered dead if no heartbeat
const TAKEOVER_REQUEST_EXPIRY = 60000; // 60 seconds for takeover request to expire

// Current terminal's info (computed once at startup)
let currentTerminalInfo: TerminalInfo | null = null;

// Current terminal's session key (for display to user)
let currentSessionKey: string | null = null;

// Heartbeat interval handle
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

// Event emitter for session changes
export const sessionEvents = new EventEmitter();

/**
 * Generate a random session key (8 characters, alphanumeric, easy to type)
 */
function generateSessionKey(): string {
  // Use only uppercase letters and numbers, excluding confusing characters (0, O, I, 1, L)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let key = '';
  const randomBytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    key += chars[randomBytes[i] % chars.length];
  }
  return key;
}

/**
 * Generate a unique terminal identifier
 * Combines TTY path, PID, and timestamp for uniqueness
 */
function generateTerminalId(): string {
  const tty = getTtyPath();
  const pid = process.pid;
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  
  // Create a deterministic but unique ID
  return `term-${pid}-${timestamp}-${random}`;
}

/**
 * Get the TTY path for the current terminal
 */
function getTtyPath(): string | null {
  try {
    // Try to get TTY from stdin
    if (process.stdin.isTTY) {
      // On Unix-like systems
      if (typeof process.stdout.fd !== 'undefined') {
        try {
          const ttyname = require('tty').isatty(process.stdout.fd);
          if (ttyname) {
            // Try to read /dev/tty link
            return process.env.TTY || process.env.GPG_TTY || `/dev/tty-${process.pid}`;
          }
        } catch {
          // Fallback
        }
      }
    }
    
    // Fallback: use environment variables or construct from PID
    return process.env.TTY || process.env.GPG_TTY || null;
  } catch {
    return null;
  }
}

/**
 * Get current terminal information
 */
export function getCurrentTerminalInfo(): TerminalInfo {
  if (!currentTerminalInfo) {
    currentTerminalInfo = {
      id: generateTerminalId(),
      pid: process.pid,
      tty: getTtyPath(),
      startTime: new Date().toISOString(),
      hostname: os.hostname(),
      user: os.userInfo().username,
      cwd: process.cwd(),
      shell: process.env.SHELL || process.env.COMSPEC || 'unknown'
    };
  }
  return currentTerminalInfo;
}

/**
 * Get the current terminal's unique ID
 */
export function getTerminalId(): string {
  return getCurrentTerminalInfo().id;
}

/**
 * Ensure the history directory exists
 */
async function ensureDir(): Promise<void> {
  try {
    await fs.mkdir(HISTORY_DIR, { recursive: true });
  } catch {
    // Directory exists
  }
}

/**
 * Acquire a file lock for atomic operations
 */
async function acquireLock(timeout: number = 5000): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    try {
      // Try to create lock file exclusively
      await fs.writeFile(LOCK_FILE, `${process.pid}`, { flag: 'wx' });
      return true;
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        // Lock exists, check if it's stale
        try {
          const stat = await fs.stat(LOCK_FILE);
          const age = Date.now() - stat.mtimeMs;
          if (age > STALE_THRESHOLD) {
            // Stale lock, remove it
            await fs.unlink(LOCK_FILE);
            continue;
          }
        } catch {
          // Lock was removed, try again
          continue;
        }
        
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 50));
        continue;
      }
      throw err;
    }
  }
  
  return false;
}

/**
 * Release the file lock
 */
async function releaseLock(): Promise<void> {
  try {
    await fs.unlink(LOCK_FILE);
  } catch {
    // Lock already released or doesn't exist
  }
}

/**
 * Load the terminal registry
 */
async function loadRegistry(): Promise<TerminalRegistry> {
  try {
    const data = await fs.readFile(TERMINAL_REGISTRY_FILE, 'utf-8');
    const registry = JSON.parse(data);
    // Ensure takeoverRequests exists for backward compatibility
    if (!registry.takeoverRequests) {
      registry.takeoverRequests = {};
    }
    return registry;
  } catch {
    return {
      terminals: {},
      sessionOwnership: {},
      takeoverRequests: {},
      lastUpdated: new Date().toISOString()
    };
  }
}

/**
 * Save the terminal registry
 */
async function saveRegistry(registry: TerminalRegistry): Promise<void> {
  await ensureDir();
  registry.lastUpdated = new Date().toISOString();
  await fs.writeFile(TERMINAL_REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

/**
 * Clean up stale terminals and sessions from the registry
 */
async function cleanupStaleEntries(registry: TerminalRegistry): Promise<TerminalRegistry> {
  const now = Date.now();
  const staleTerminals: string[] = [];
  
  // Find stale terminals
  for (const [termId, terminal] of Object.entries(registry.terminals)) {
    const lastActivity = new Date(terminal.startTime).getTime();
    
    // Check if process is still running (for local terminals)
    if (terminal.hostname === os.hostname()) {
      try {
        // Check if process exists
        process.kill(terminal.pid, 0);
      } catch {
        // Process doesn't exist, mark as stale
        staleTerminals.push(termId);
        continue;
      }
    }
    
    // Check ownership heartbeats
    const ownership = Object.values(registry.sessionOwnership).find(o => o.terminalId === termId);
    if (ownership) {
      const heartbeatAge = now - new Date(ownership.lastHeartbeat).getTime();
      if (heartbeatAge > STALE_THRESHOLD) {
        staleTerminals.push(termId);
      }
    }
  }
  
  // Remove stale terminals and their session ownerships
  for (const termId of staleTerminals) {
    delete registry.terminals[termId];
    
    // Release any sessions owned by stale terminals
    for (const [sessionId, ownership] of Object.entries(registry.sessionOwnership)) {
      if (ownership.terminalId === termId) {
        delete registry.sessionOwnership[sessionId];
      }
    }
  }
  
  return registry;
}

/**
 * Register the current terminal
 */
export async function registerTerminal(): Promise<void> {
  await ensureDir();
  
  const locked = await acquireLock();
  if (!locked) {
    console.error('Warning: Could not acquire lock for terminal registration');
    return;
  }
  
  try {
    let registry = await loadRegistry();
    registry = await cleanupStaleEntries(registry);
    
    const terminal = getCurrentTerminalInfo();
    registry.terminals[terminal.id] = terminal;
    
    await saveRegistry(registry);
  } finally {
    await releaseLock();
  }
}

/**
 * Unregister the current terminal (called on exit)
 */
export async function unregisterTerminal(): Promise<void> {
  const locked = await acquireLock();
  if (!locked) return;
  
  try {
    const registry = await loadRegistry();
    const terminalId = getTerminalId();
    
    // Remove terminal
    delete registry.terminals[terminalId];
    
    // Release all sessions owned by this terminal
    for (const [sessionId, ownership] of Object.entries(registry.sessionOwnership)) {
      if (ownership.terminalId === terminalId) {
        delete registry.sessionOwnership[sessionId];
        sessionEvents.emit('session-released', sessionId);
      }
    }
    
    await saveRegistry(registry);
  } finally {
    await releaseLock();
  }
}

/**
 * Claim ownership of a session for the current terminal
 */
export async function claimSession(sessionId: string): Promise<boolean> {
  const locked = await acquireLock();
  if (!locked) return false;
  
  try {
    let registry = await loadRegistry();
    registry = await cleanupStaleEntries(registry);
    
    const terminalId = getTerminalId();
    const existingOwnership = registry.sessionOwnership[sessionId];
    
    // Check if session is already owned by another active terminal
    if (existingOwnership && existingOwnership.terminalId !== terminalId) {
      const owningTerminal = registry.terminals[existingOwnership.terminalId];
      if (owningTerminal) {
        // Check if the owning terminal is still alive
        const heartbeatAge = Date.now() - new Date(existingOwnership.lastHeartbeat).getTime();
        if (heartbeatAge < STALE_THRESHOLD) {
          // Session is actively owned by another terminal
          return false;
        }
      }
    }
    
    // Claim the session with a new session key
    const sessionKey = generateSessionKey();
    registry.sessionOwnership[sessionId] = {
      sessionId,
      terminalId,
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      sessionKey
    };
    
    // Store the session key for this terminal
    currentSessionKey = sessionKey;
    
    await saveRegistry(registry);
    sessionEvents.emit('session-claimed', sessionId, terminalId);
    return true;
  } finally {
    await releaseLock();
  }
}

/**
 * Release ownership of a session
 */
export async function releaseSession(sessionId: string): Promise<boolean> {
  const locked = await acquireLock();
  if (!locked) return false;
  
  try {
    const registry = await loadRegistry();
    const terminalId = getTerminalId();
    
    const ownership = registry.sessionOwnership[sessionId];
    if (ownership && ownership.terminalId === terminalId) {
      delete registry.sessionOwnership[sessionId];
      await saveRegistry(registry);
      sessionEvents.emit('session-released', sessionId);
      return true;
    }
    
    return false;
  } finally {
    await releaseLock();
  }
}

/**
 * Check if a session is owned by the current terminal
 */
export async function isSessionOwnedByCurrentTerminal(sessionId: string): Promise<boolean> {
  try {
    const registry = await loadRegistry();
    const ownership = registry.sessionOwnership[sessionId];
    return ownership?.terminalId === getTerminalId();
  } catch {
    return false;
  }
}

/**
 * Get the terminal that owns a session
 */
export async function getSessionOwner(sessionId: string): Promise<TerminalInfo | null> {
  try {
    const registry = await loadRegistry();
    const ownership = registry.sessionOwnership[sessionId];
    
    if (ownership) {
      return registry.terminals[ownership.terminalId] || null;
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Get all active terminals
 */
export async function getActiveTerminals(): Promise<TerminalInfo[]> {
  try {
    let registry = await loadRegistry();
    registry = await cleanupStaleEntries(registry);
    return Object.values(registry.terminals);
  } catch {
    return [];
  }
}

/**
 * Get sessions owned by other terminals
 */
export async function getSessionsOwnedByOtherTerminals(): Promise<Array<{ sessionId: string; terminal: TerminalInfo }>> {
  try {
    const registry = await loadRegistry();
    const terminalId = getTerminalId();
    const result: Array<{ sessionId: string; terminal: TerminalInfo }> = [];
    
    for (const [sessionId, ownership] of Object.entries(registry.sessionOwnership)) {
      if (ownership.terminalId !== terminalId) {
        const terminal = registry.terminals[ownership.terminalId];
        if (terminal) {
          result.push({ sessionId, terminal });
        }
      }
    }
    
    return result;
  } catch {
    return [];
  }
}

/**
 * Get sessions owned by the current terminal
 */
export async function getCurrentTerminalSessions(): Promise<string[]> {
  try {
    const registry = await loadRegistry();
    const terminalId = getTerminalId();
    
    return Object.entries(registry.sessionOwnership)
      .filter(([_, ownership]) => ownership.terminalId === terminalId)
      .map(([sessionId]) => sessionId);
  } catch {
    return [];
  }
}

/**
 * Update heartbeat for owned sessions
 */
async function updateHeartbeat(): Promise<void> {
  const locked = await acquireLock(1000); // Short timeout for heartbeat
  if (!locked) return;
  
  try {
    const registry = await loadRegistry();
    const terminalId = getTerminalId();
    const now = new Date().toISOString();
    
    let updated = false;
    for (const ownership of Object.values(registry.sessionOwnership)) {
      if (ownership.terminalId === terminalId) {
        ownership.lastHeartbeat = now;
        updated = true;
      }
    }
    
    // Also update terminal info
    if (registry.terminals[terminalId]) {
      registry.terminals[terminalId].cwd = process.cwd();
      updated = true;
    }
    
    // Clean up expired takeover requests
    await cleanupExpiredRequests(registry);
    
    if (updated) {
      await saveRegistry(registry);
    }
  } finally {
    await releaseLock();
  }
}

/**
 * Start the heartbeat timer
 */
export function startHeartbeat(): void {
  if (heartbeatInterval) return;
  
  heartbeatInterval = setInterval(updateHeartbeat, HEARTBEAT_INTERVAL);
  
  // Don't prevent the process from exiting
  if (heartbeatInterval.unref) {
    heartbeatInterval.unref();
  }
}

/**
 * Stop the heartbeat timer
 */
export function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

/**
 * Initialize terminal session management
 * Call this at application startup
 */
export async function initTerminalSession(): Promise<void> {
  await registerTerminal();
  startHeartbeat();
  
  // Clean up on exit
  const cleanup = async () => {
    stopHeartbeat();
    await unregisterTerminal();
  };
  
  process.on('exit', () => {
    // Synchronous cleanup attempt
    stopHeartbeat();
  });
  
  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(0);
  });
  
  // Handle uncaught exceptions
  process.on('uncaughtException', async (err) => {
    console.error('Uncaught exception:', err);
    await cleanup();
    process.exit(1);
  });
}

/**
 * Get a display-friendly name for a terminal
 */
export function getTerminalDisplayName(terminal: TerminalInfo): string {
  const shortId = terminal.id.split('-').slice(-2).join('-');
  const ttyInfo = terminal.tty ? ` (${path.basename(terminal.tty)})` : '';
  return `Terminal ${shortId}${ttyInfo}`;
}

/**
 * Check if the current terminal is the only active one
 */
export async function isOnlyActiveTerminal(): Promise<boolean> {
  const terminals = await getActiveTerminals();
  return terminals.length <= 1;
}

/**
 * Get the session key for a session owned by the current terminal
 */
export async function getSessionKey(sessionId: string): Promise<string | null> {
  try {
    const registry = await loadRegistry();
    const ownership = registry.sessionOwnership[sessionId];
    
    if (ownership && ownership.terminalId === getTerminalId()) {
      return ownership.sessionKey;
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Get all session keys for sessions owned by the current terminal
 */
export async function getCurrentTerminalSessionKeys(): Promise<Record<string, string>> {
  try {
    const registry = await loadRegistry();
    const terminalId = getTerminalId();
    const keys: Record<string, string> = {};
    
    for (const [sessionId, ownership] of Object.entries(registry.sessionOwnership)) {
      if (ownership.terminalId === terminalId) {
        keys[sessionId] = ownership.sessionKey;
      }
    }
    
    return keys;
  } catch {
    return {};
  }
}

/**
 * Verify a session key for takeover
 */
export async function verifySessionKey(sessionId: string, providedKey: string): Promise<boolean> {
  try {
    const registry = await loadRegistry();
    const ownership = registry.sessionOwnership[sessionId];
    
    if (!ownership) {
      return false;
    }
    
    // Case-insensitive comparison
    return ownership.sessionKey.toUpperCase() === providedKey.toUpperCase();
  } catch {
    return false;
  }
}

/**
 * Take over a session using the session key
 * @param sessionId The session to take over
 * @param sessionKey The session key provided by the user
 * @returns true if takeover was successful
 */
export async function takeoverSessionWithKey(sessionId: string, sessionKey: string): Promise<boolean> {
  const locked = await acquireLock();
  if (!locked) return false;
  
  try {
    const registry = await loadRegistry();
    const ownership = registry.sessionOwnership[sessionId];
    
    if (!ownership) {
      return false;
    }
    
    // Verify the session key (case-insensitive)
    if (ownership.sessionKey.toUpperCase() !== sessionKey.toUpperCase()) {
      return false;
    }
    
    const terminalId = getTerminalId();
    
    // Generate a new session key for the new owner
    const newSessionKey = generateSessionKey();
    
    // Transfer ownership
    registry.sessionOwnership[sessionId] = {
      sessionId,
      terminalId,
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      sessionKey: newSessionKey
    };
    
    currentSessionKey = newSessionKey;
    
    await saveRegistry(registry);
    sessionEvents.emit('session-claimed', sessionId, terminalId);
    return true;
  } finally {
    await releaseLock();
  }
}

/**
 * Create a takeover request for a session
 * The owning terminal must approve this request
 */
export async function createTakeoverRequest(sessionId: string): Promise<TakeoverRequest | null> {
  const locked = await acquireLock();
  if (!locked) return null;
  
  try {
    const registry = await loadRegistry();
    const ownership = registry.sessionOwnership[sessionId];
    
    if (!ownership) {
      return null;
    }
    
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TAKEOVER_REQUEST_EXPIRY);
    
    const request: TakeoverRequest = {
      id: requestId,
      sessionId,
      requestingTerminalId: getTerminalId(),
      owningTerminalId: ownership.terminalId,
      requestedAt: now.toISOString(),
      status: 'pending',
      expiresAt: expiresAt.toISOString()
    };
    
    registry.takeoverRequests[requestId] = request;
    await saveRegistry(registry);
    
    sessionEvents.emit('takeover-requested', request);
    return request;
  } finally {
    await releaseLock();
  }
}

/**
 * Get pending takeover requests for sessions owned by the current terminal
 */
export async function getPendingTakeoverRequests(): Promise<TakeoverRequest[]> {
  try {
    const registry = await loadRegistry();
    const terminalId = getTerminalId();
    const now = Date.now();
    
    return Object.values(registry.takeoverRequests).filter(req => 
      req.owningTerminalId === terminalId &&
      req.status === 'pending' &&
      new Date(req.expiresAt).getTime() > now
    );
  } catch {
    return [];
  }
}

/**
 * Approve a takeover request
 */
export async function approveTakeoverRequest(requestId: string): Promise<boolean> {
  const locked = await acquireLock();
  if (!locked) return false;
  
  try {
    const registry = await loadRegistry();
    const request = registry.takeoverRequests[requestId];
    
    if (!request || request.status !== 'pending') {
      return false;
    }
    
    // Check if request has expired
    if (new Date(request.expiresAt).getTime() < Date.now()) {
      request.status = 'expired';
      await saveRegistry(registry);
      return false;
    }
    
    // Verify this terminal owns the session
    const ownership = registry.sessionOwnership[request.sessionId];
    if (!ownership || ownership.terminalId !== getTerminalId()) {
      return false;
    }
    
    // Transfer ownership to the requesting terminal
    const newSessionKey = generateSessionKey();
    registry.sessionOwnership[request.sessionId] = {
      sessionId: request.sessionId,
      terminalId: request.requestingTerminalId,
      pid: process.pid, // Will be updated by the new owner
      acquiredAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      sessionKey: newSessionKey
    };
    
    request.status = 'approved';
    await saveRegistry(registry);
    
    sessionEvents.emit('takeover-approved', request);
    return true;
  } finally {
    await releaseLock();
  }
}

/**
 * Deny a takeover request
 */
export async function denyTakeoverRequest(requestId: string): Promise<boolean> {
  const locked = await acquireLock();
  if (!locked) return false;
  
  try {
    const registry = await loadRegistry();
    const request = registry.takeoverRequests[requestId];
    
    if (!request || request.status !== 'pending') {
      return false;
    }
    
    request.status = 'denied';
    await saveRegistry(registry);
    
    sessionEvents.emit('takeover-denied', request);
    return true;
  } finally {
    await releaseLock();
  }
}

/**
 * Check if a takeover request was approved
 */
export async function checkTakeoverRequestStatus(requestId: string): Promise<TakeoverRequest | null> {
  try {
    const registry = await loadRegistry();
    return registry.takeoverRequests[requestId] || null;
  } catch {
    return null;
  }
}

/**
 * Clean up expired takeover requests
 */
async function cleanupExpiredRequests(registry: TerminalRegistry): Promise<void> {
  const now = Date.now();
  
  for (const [requestId, request] of Object.entries(registry.takeoverRequests)) {
    if (request.status === 'pending' && new Date(request.expiresAt).getTime() < now) {
      request.status = 'expired';
    }
    
    // Remove old requests (older than 1 hour)
    if (new Date(request.requestedAt).getTime() < now - 3600000) {
      delete registry.takeoverRequests[requestId];
    }
  }
}

/**
 * Force claim a session (only for dead terminals - no key required)
 * This should only be used when the owning terminal is confirmed dead
 */
export async function forceClaimSession(sessionId: string): Promise<boolean> {
  const locked = await acquireLock();
  if (!locked) return false;
  
  try {
    let registry = await loadRegistry();
    registry = await cleanupStaleEntries(registry);
    
    const ownership = registry.sessionOwnership[sessionId];
    
    // Only allow force claim if the owning terminal is dead
    if (ownership) {
      const owningTerminal = registry.terminals[ownership.terminalId];
      if (owningTerminal) {
        // Terminal is still registered and possibly alive
        const heartbeatAge = Date.now() - new Date(ownership.lastHeartbeat).getTime();
        if (heartbeatAge < STALE_THRESHOLD) {
          // Terminal is still alive, cannot force claim
          return false;
        }
      }
    }
    
    const terminalId = getTerminalId();
    const newSessionKey = generateSessionKey();
    
    // Force claim with new session key
    registry.sessionOwnership[sessionId] = {
      sessionId,
      terminalId,
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      sessionKey: newSessionKey
    };
    
    currentSessionKey = newSessionKey;
    
    await saveRegistry(registry);
    sessionEvents.emit('session-claimed', sessionId, terminalId);
    return true;
  } finally {
    await releaseLock();
  }
}

/**
 * Check if a session that was owned by this terminal has been taken over by another terminal
 * @param sessionId The session to check
 * @returns The terminal that took over, or null if not taken over
 */
export async function checkSessionTakeover(sessionId: string): Promise<TerminalInfo | null> {
  try {
    const registry = await loadRegistry();
    const terminalId = getTerminalId();
    const ownership = registry.sessionOwnership[sessionId];
    
    // If no ownership record, session is not owned by anyone
    if (!ownership) {
      return null;
    }
    
    // If still owned by current terminal, not taken over
    if (ownership.terminalId === terminalId) {
      return null;
    }
    
    // Session was taken over by another terminal
    const newOwner = registry.terminals[ownership.terminalId];
    return newOwner || null;
  } catch {
    return null;
  }
}

/**
 * Get a list of sessions that were previously owned by this terminal but have been taken over
 * @param previouslyOwnedSessionIds List of session IDs that this terminal previously owned
 * @returns Array of sessions that were taken over with the new owner info
 */
export async function getSessionsTakenOver(previouslyOwnedSessionIds: string[]): Promise<Array<{ sessionId: string; newOwner: TerminalInfo }>> {
  const takenOver: Array<{ sessionId: string; newOwner: TerminalInfo }> = [];
  
  for (const sessionId of previouslyOwnedSessionIds) {
    const newOwner = await checkSessionTakeover(sessionId);
    if (newOwner) {
      takenOver.push({ sessionId, newOwner });
    }
  }
  
  return takenOver;
}
