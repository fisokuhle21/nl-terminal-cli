/**
 * Git utilities module for NL Terminal CLI
 * Provides functions for git operations: status, diff, branches, commit, push, pull
 */

import { spawnSync } from 'child_process';
import chalk from 'chalk';

// ============================================================================
// Types
// ============================================================================

export interface Branch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  remoteName?: string;  // e.g., 'origin' for 'origin/main'
}

export interface GitStatus {
  isClean: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  ahead: number;
  behind: number;
  branch: string | null;
  files: StatusFile[];
}

export interface StatusFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'copied';
  staged: boolean;
}

export interface DiffOptions {
  staged?: boolean;      // --staged
  file?: string;         // specific file
  stat?: boolean;        // --stat only
}

export interface DiffResult {
  raw: string;
  formatted: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: DiffFile[];
}

export interface DiffFile {
  path: string;
  insertions: number;
  deletions: number;
}

export interface Commit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  relativeDate: string;
}

export interface GitResult {
  success: boolean;
  message: string;
  error?: string;
}

// ============================================================================
// Core Git Functions
// ============================================================================

/**
 * Execute a git command and return the result
 */
function execGit(args: string[], options?: { cwd?: string }): { success: boolean; stdout: string; stderr: string } {
  const result = spawnSync('git', args, {
    encoding: 'utf-8',
    cwd: options?.cwd || process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe']
  });

  return {
    success: result.status === 0,
    stdout: result.stdout?.trim() || '',
    stderr: result.stderr?.trim() || ''
  };
}

/**
 * Check if the current directory is a git repository
 */
export function isGitRepository(): boolean {
  const result = execGit(['rev-parse', '--git-dir']);
  return result.success;
}

/**
 * Get the current branch name
 */
export function getCurrentBranch(): string | null {
  const result = execGit(['branch', '--show-current']);
  if (result.success && result.stdout) {
    return result.stdout;
  }
  
  // Fallback for detached HEAD state
  const headResult = execGit(['rev-parse', '--short', 'HEAD']);
  if (headResult.success) {
    return `(HEAD detached at ${headResult.stdout})`;
  }
  
  return null;
}

/**
 * Get list of local branches
 */
export function getLocalBranches(): Branch[] {
  const result = execGit(['branch', '--format=%(refname:short)|%(HEAD)']);
  if (!result.success) return [];

  return result.stdout.split('\n')
    .filter(line => line.trim())
    .map(line => {
      const [name, isCurrent] = line.split('|');
      return {
        name: name.trim(),
        isCurrent: isCurrent === '*',
        isRemote: false
      };
    });
}

/**
 * Get list of remote branches
 */
export function getRemoteBranches(): Branch[] {
  // First fetch to get latest remote refs (non-blocking, ignore errors)
  execGit(['fetch', '--prune', '--quiet']);
  
  const result = execGit(['branch', '-r', '--format=%(refname:short)']);
  if (!result.success) return [];

  return result.stdout.split('\n')
    .filter(line => line.trim() && !line.includes('HEAD'))
    .map(line => {
      const name = line.trim();
      const remoteName = name.split('/')[0];
      return {
        name,
        isCurrent: false,
        isRemote: true,
        remoteName
      };
    });
}

/**
 * Get all branches (local + remote)
 */
export function getAllBranches(): { local: Branch[]; remote: Branch[] } {
  return {
    local: getLocalBranches(),
    remote: getRemoteBranches()
  };
}

// ============================================================================
// Git Status
// ============================================================================

/**
 * Parse status code to human-readable status
 */
function parseStatusCode(code: string): 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'copied' {
  switch (code) {
    case 'M': return 'modified';
    case 'A': return 'added';
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    case 'C': return 'copied';
    case '?': return 'untracked';
    default: return 'modified';
  }
}

/**
 * Get parsed git status
 */
export function getGitStatus(): GitStatus {
  const result = execGit(['status', '--porcelain=v2', '--branch']);
  
  const status: GitStatus = {
    isClean: true,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    ahead: 0,
    behind: 0,
    branch: null,
    files: []
  };

  if (!result.success) return status;

  const lines = result.stdout.split('\n');
  
  for (const line of lines) {
    if (line.startsWith('# branch.head ')) {
      status.branch = line.replace('# branch.head ', '');
    } else if (line.startsWith('# branch.ab ')) {
      const match = line.match(/\+(\d+) -(\d+)/);
      if (match) {
        status.ahead = parseInt(match[1], 10);
        status.behind = parseInt(match[2], 10);
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      // Changed entries
      const parts = line.split(' ');
      const xy = parts[1]; // XY status codes
      const path = parts.slice(8).join(' ');
      
      const stagedCode = xy[0];
      const unstagedCode = xy[1];
      
      if (stagedCode !== '.') {
        status.staged++;
        status.files.push({
          path,
          status: parseStatusCode(stagedCode),
          staged: true
        });
      }
      
      if (unstagedCode !== '.') {
        status.unstaged++;
        status.files.push({
          path,
          status: parseStatusCode(unstagedCode),
          staged: false
        });
      }
      
      status.isClean = false;
    } else if (line.startsWith('? ')) {
      // Untracked files
      const path = line.substring(2);
      status.untracked++;
      status.files.push({
        path,
        status: 'untracked',
        staged: false
      });
      status.isClean = false;
    }
  }

  return status;
}

/**
 * Format status for display
 */
export function formatStatusSummary(status: GitStatus): string {
  if (status.isClean) {
    return chalk.green('Clean');
  }
  
  const parts: string[] = [];
  if (status.staged > 0) parts.push(chalk.green(`${status.staged} staged`));
  if (status.unstaged > 0) parts.push(chalk.yellow(`${status.unstaged} unstaged`));
  if (status.untracked > 0) parts.push(chalk.gray(`${status.untracked} untracked`));
  
  return parts.join(', ');
}

/**
 * Format detailed status for display
 */
export function formatDetailedStatus(status: GitStatus): string {
  const lines: string[] = [];
  
  // Branch info
  lines.push(chalk.bold(`On branch ${chalk.cyan(status.branch || 'unknown')}`));
  
  // Ahead/behind info
  if (status.ahead > 0 || status.behind > 0) {
    const parts: string[] = [];
    if (status.ahead > 0) parts.push(chalk.green(`${status.ahead} ahead`));
    if (status.behind > 0) parts.push(chalk.red(`${status.behind} behind`));
    lines.push(chalk.gray(`Your branch is ${parts.join(', ')}`));
  }
  
  lines.push('');
  
  if (status.isClean) {
    lines.push(chalk.green('Nothing to commit, working tree clean'));
    return lines.join('\n');
  }
  
  // Staged files
  const stagedFiles = status.files.filter(f => f.staged);
  if (stagedFiles.length > 0) {
    lines.push(chalk.green.bold('Changes to be committed:'));
    for (const file of stagedFiles) {
      const icon = getStatusIcon(file.status);
      lines.push(chalk.green(`  ${icon} ${file.status}: ${file.path}`));
    }
    lines.push('');
  }
  
  // Unstaged files
  const unstagedFiles = status.files.filter(f => !f.staged && f.status !== 'untracked');
  if (unstagedFiles.length > 0) {
    lines.push(chalk.yellow.bold('Changes not staged for commit:'));
    for (const file of unstagedFiles) {
      const icon = getStatusIcon(file.status);
      lines.push(chalk.yellow(`  ${icon} ${file.status}: ${file.path}`));
    }
    lines.push('');
  }
  
  // Untracked files
  const untrackedFiles = status.files.filter(f => f.status === 'untracked');
  if (untrackedFiles.length > 0) {
    lines.push(chalk.gray.bold('Untracked files:'));
    for (const file of untrackedFiles) {
      lines.push(chalk.gray(`  ? ${file.path}`));
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'modified': return 'M';
    case 'added': return 'A';
    case 'deleted': return 'D';
    case 'renamed': return 'R';
    case 'copied': return 'C';
    case 'untracked': return '?';
    default: return ' ';
  }
}

// ============================================================================
// Git Diff
// ============================================================================

/**
 * Get git diff
 */
export function getGitDiff(options?: DiffOptions): DiffResult {
  const args = ['diff'];
  
  if (options?.staged) {
    args.push('--staged');
  }
  
  if (options?.file) {
    args.push('--', options.file);
  }
  
  // Get the raw diff
  const diffResult = execGit(args);
  
  // Get the stat summary
  const statArgs = [...args, '--stat'];
  const statResult = execGit(statArgs);
  
  // Parse stats
  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;
  const files: DiffFile[] = [];
  
  if (statResult.success && statResult.stdout) {
    const statLines = statResult.stdout.split('\n');
    
    // Parse file stats
    for (const line of statLines) {
      // Match lines like: " src/file.ts | 10 ++++----"
      const fileMatch = line.match(/^\s*(.+?)\s*\|\s*(\d+)\s*([+-]*)/);
      if (fileMatch) {
        const filePath = fileMatch[1].trim();
        const changes = fileMatch[3] || '';
        const ins = (changes.match(/\+/g) || []).length;
        const del = (changes.match(/-/g) || []).length;
        files.push({ path: filePath, insertions: ins, deletions: del });
      }
      
      // Match summary line: " 3 files changed, 45 insertions(+), 12 deletions(-)"
      const summaryMatch = line.match(/(\d+)\s+files?\s+changed(?:,\s*(\d+)\s+insertions?\(\+\))?(?:,\s*(\d+)\s+deletions?\(-\))?/);
      if (summaryMatch) {
        filesChanged = parseInt(summaryMatch[1], 10);
        insertions = parseInt(summaryMatch[2] || '0', 10);
        deletions = parseInt(summaryMatch[3] || '0', 10);
      }
    }
  }
  
  return {
    raw: diffResult.stdout,
    formatted: formatEnhancedDiff(diffResult.stdout, { filesChanged, insertions, deletions }),
    filesChanged,
    insertions,
    deletions,
    files
  };
}

/**
 * Format diff with enhanced colors and display
 */
export function formatEnhancedDiff(diff: string, stats?: { filesChanged: number; insertions: number; deletions: number }): string {
  if (!diff.trim()) {
    return chalk.gray('No changes to display');
  }
  
  const lines: string[] = [];
  
  // Header
  if (stats && stats.filesChanged > 0) {
    lines.push(chalk.cyan('┌─────────────────────────────────────────────────────────────┐'));
    lines.push(chalk.cyan('│ ') + chalk.bold(`📝 Git Diff: ${stats.filesChanged} file${stats.filesChanged !== 1 ? 's' : ''} changed, `) +
      chalk.green(`+${stats.insertions}`) + chalk.gray(' / ') + chalk.red(`-${stats.deletions}`) + 
      chalk.gray(' lines') + chalk.cyan(' │'));
    lines.push(chalk.cyan('└─────────────────────────────────────────────────────────────┘'));
    lines.push('');
  }
  
  let currentFile = '';
  let lineNumber = 0;
  
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git')) {
      // File header
      const match = line.match(/diff --git a\/(.+) b\//);
      if (match) {
        currentFile = match[1];
        if (lines.length > 0) lines.push(''); // Add spacing between files
        lines.push(chalk.bold.blue(`📄 ${currentFile}`));
        lines.push(chalk.gray('─'.repeat(60)));
      }
    } else if (line.startsWith('@@')) {
      // Hunk header - extract line numbers
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
      if (match) {
        lineNumber = parseInt(match[2], 10);
        lines.push(chalk.cyan(line));
      }
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      // Addition
      const lineNum = String(lineNumber++).padStart(4, ' ');
      lines.push(chalk.green(`${lineNum} │ + ${line.substring(1)}`));
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // Deletion
      lines.push(chalk.red(`     │ - ${line.substring(1)}`));
    } else if (line.startsWith(' ')) {
      // Context line
      const lineNum = String(lineNumber++).padStart(4, ' ');
      lines.push(chalk.gray(`${lineNum} │   ${line.substring(1)}`));
    } else if (line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file')) {
      // Meta info - skip or show in gray
      lines.push(chalk.gray(line));
    } else if (line.startsWith('---') || line.startsWith('+++')) {
      // File path indicators - skip (we show our own header)
      continue;
    } else if (line.startsWith('Binary files')) {
      lines.push(chalk.yellow(line));
    }
  }
  
  return lines.join('\n');
}

/**
 * Get list of changed files (for file picker in diff)
 */
export function getChangedFiles(staged?: boolean): string[] {
  const args = ['diff', '--name-only'];
  if (staged) args.push('--staged');
  
  const result = execGit(args);
  if (!result.success) return [];
  
  return result.stdout.split('\n').filter(f => f.trim());
}

// ============================================================================
// Branch Operations
// ============================================================================

/**
 * Switch to a branch
 */
export function switchBranch(branchName: string): GitResult {
  // Check if it's a remote branch
  const isRemote = branchName.includes('/');
  
  let localBranchName = branchName;
  if (isRemote) {
    // Extract local branch name from remote (e.g., 'origin/feature' -> 'feature')
    localBranchName = branchName.split('/').slice(1).join('/');
  }
  
  // Try to checkout
  const result = execGit(['checkout', localBranchName]);
  
  if (result.success) {
    return {
      success: true,
      message: `Switched to branch '${localBranchName}'`
    };
  }
  
  // If failed and it's a remote branch, try to create tracking branch
  if (isRemote) {
    const trackResult = execGit(['checkout', '-b', localBranchName, '--track', branchName]);
    if (trackResult.success) {
      return {
        success: true,
        message: `Switched to new branch '${localBranchName}' tracking '${branchName}'`
      };
    }
    return {
      success: false,
      message: `Failed to checkout branch`,
      error: trackResult.stderr
    };
  }
  
  return {
    success: false,
    message: `Failed to switch to branch '${branchName}'`,
    error: result.stderr
  };
}

/**
 * Create a new branch
 */
export function createBranch(branchName: string, checkout: boolean = true): GitResult {
  const args = checkout 
    ? ['checkout', '-b', branchName]
    : ['branch', branchName];
  
  const result = execGit(args);
  
  if (result.success) {
    return {
      success: true,
      message: checkout 
        ? `Created and switched to new branch '${branchName}'`
        : `Created branch '${branchName}'`
    };
  }
  
  return {
    success: false,
    message: `Failed to create branch '${branchName}'`,
    error: result.stderr
  };
}

/**
 * Delete a branch
 */
export function deleteBranch(branchName: string, force: boolean = false): GitResult {
  const currentBranch = getCurrentBranch();
  
  if (branchName === currentBranch) {
    return {
      success: false,
      message: `Cannot delete the currently checked out branch '${branchName}'`,
      error: 'Switch to another branch first'
    };
  }
  
  const args = ['branch', force ? '-D' : '-d', branchName];
  const result = execGit(args);
  
  if (result.success) {
    return {
      success: true,
      message: `Deleted branch '${branchName}'`
    };
  }
  
  // Check if branch has unmerged changes
  if (result.stderr.includes('not fully merged')) {
    return {
      success: false,
      message: `Branch '${branchName}' has unmerged changes`,
      error: 'Use force delete to delete anyway'
    };
  }
  
  return {
    success: false,
    message: `Failed to delete branch '${branchName}'`,
    error: result.stderr
  };
}

// ============================================================================
// Commit Operations
// ============================================================================

/**
 * Stage all changes
 */
export function stageAll(): GitResult {
  const result = execGit(['add', '-A']);
  
  return {
    success: result.success,
    message: result.success ? 'Staged all changes' : 'Failed to stage changes',
    error: result.stderr || undefined
  };
}

/**
 * Stage specific files
 */
export function stageFiles(files: string[]): GitResult {
  const result = execGit(['add', '--', ...files]);
  
  return {
    success: result.success,
    message: result.success ? `Staged ${files.length} file(s)` : 'Failed to stage files',
    error: result.stderr || undefined
  };
}

/**
 * Commit staged changes
 */
export function gitCommit(message: string): GitResult {
  if (!message.trim()) {
    return {
      success: false,
      message: 'Commit message cannot be empty',
      error: 'Please provide a commit message'
    };
  }
  
  const result = execGit(['commit', '-m', message]);
  
  if (result.success) {
    // Extract commit hash from output
    const hashMatch = result.stdout.match(/\[.+\s+([a-f0-9]+)\]/);
    const hash = hashMatch ? hashMatch[1] : '';
    
    return {
      success: true,
      message: `Created commit ${hash}: ${message}`
    };
  }
  
  return {
    success: false,
    message: 'Failed to commit',
    error: result.stderr
  };
}

// ============================================================================
// Push / Pull Operations
// ============================================================================

/**
 * Push to remote
 */
export function gitPush(remote: string = 'origin', branch?: string): GitResult {
  const currentBranch = branch || getCurrentBranch();
  
  if (!currentBranch) {
    return {
      success: false,
      message: 'Could not determine current branch',
      error: 'No branch checked out'
    };
  }
  
  const result = execGit(['push', remote, currentBranch]);
  
  if (result.success) {
    return {
      success: true,
      message: `Pushed to ${remote}/${currentBranch}`
    };
  }
  
  // Check for common errors
  if (result.stderr.includes('no upstream branch')) {
    // Try pushing with -u flag
    const setUpstreamResult = execGit(['push', '-u', remote, currentBranch]);
    if (setUpstreamResult.success) {
      return {
        success: true,
        message: `Pushed to ${remote}/${currentBranch} (set upstream)`
      };
    }
  }
  
  return {
    success: false,
    message: `Failed to push to ${remote}/${currentBranch}`,
    error: result.stderr
  };
}

/**
 * Pull from remote
 */
export function gitPull(remote: string = 'origin', branch?: string): GitResult {
  const args = ['pull', remote];
  if (branch) args.push(branch);
  
  const result = execGit(args);
  
  if (result.success) {
    // Parse the output to give a meaningful message
    if (result.stdout.includes('Already up to date')) {
      return {
        success: true,
        message: 'Already up to date'
      };
    }
    
    return {
      success: true,
      message: `Pulled from ${remote}${branch ? '/' + branch : ''}`
    };
  }
  
  return {
    success: false,
    message: `Failed to pull from ${remote}`,
    error: result.stderr
  };
}

// ============================================================================
// Git Init
// ============================================================================

/**
 * Initialize a new git repository
 */
export function gitInit(): GitResult {
  const result = execGit(['init']);
  
  if (result.success) {
    return {
      success: true,
      message: 'Initialized empty Git repository'
    };
  }
  
  return {
    success: false,
    message: 'Failed to initialize repository',
    error: result.stderr
  };
}

// ============================================================================
// Git Log
// ============================================================================

/**
 * Get commit log
 */
export function getCommitLog(count: number = 10): Commit[] {
  const format = '%H|%h|%s|%an|%ai|%ar';
  const result = execGit(['log', `-${count}`, `--format=${format}`]);
  
  if (!result.success) return [];
  
  return result.stdout.split('\n')
    .filter(line => line.trim())
    .map(line => {
      const [hash, shortHash, message, author, date, relativeDate] = line.split('|');
      return {
        hash,
        shortHash,
        message,
        author,
        date,
        relativeDate
      };
    });
}

/**
 * Format commit log for display
 */
export function formatCommitLog(commits: Commit[]): string {
  if (commits.length === 0) {
    return chalk.gray('No commits found');
  }
  
  const lines: string[] = [];
  lines.push(chalk.bold('📜 Commit History'));
  lines.push(chalk.gray('─'.repeat(60)));
  lines.push('');
  
  for (const commit of commits) {
    lines.push(
      chalk.yellow(commit.shortHash) + ' ' +
      chalk.white(commit.message) + ' ' +
      chalk.gray(`(${commit.relativeDate})`)
    );
    lines.push(chalk.gray(`  by ${commit.author}`));
    lines.push('');
  }
  
  return lines.join('\n');
}
