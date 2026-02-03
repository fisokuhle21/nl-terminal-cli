import { spawn, execSync } from 'child_process';
import chalk from 'chalk';
import { openUrl } from './utils.js';

export type GitPlatform = 'github' | 'gitlab' | 'bitbucket';

export interface PullRequest {
  number: number;
  title: string;
  state: 'open' | 'closed';
  head: { ref: string; };
  base: { ref: string; };
  user: { login: string; };
  html_url: string;
  mergeable?: boolean;
  mergeable_state?: string;
}

export interface MergeResult {
  success: boolean;
  output: string;
  error?: string;
  hasConflicts?: boolean;
}

export interface PlatformResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Parse git remote URL to detect platform
 */
export function detectPlatform(remoteUrl?: string): GitPlatform | null {
  const url = remoteUrl || getGitRemoteUrl();
  if (!url) return null;

  if (url.includes('github.com') || url.includes('github:')) {
    return 'github';
  }
  if (url.includes('gitlab.com') || url.includes('gitlab:')) {
    return 'gitlab';
  }
  if (url.includes('bitbucket.org') || url.includes('bitbucket:')) {
    return 'bitbucket';
  }

  return null;
}

/**
 * Get the git remote URL
 */
function getGitRemoteUrl(): string | null {
  try {
    const result = execSync('git remote get-url origin', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
    return result?.toString().trim() || null;
  } catch {
    return null;
  }
}

/**
 * Get CLI command name for platform
 */
export function getCliCommand(platform: GitPlatform): string {
  switch (platform) {
    case 'github':
      return 'gh';
    case 'gitlab':
      return 'glab';
    case 'bitbucket':
      return 'bb';
    default:
      return 'gh';
  }
}

/**
 * Check if platform CLI is installed
 */
export async function isCliInstalled(platform: GitPlatform): Promise<boolean> {
  const cli = getCliCommand(platform);
  return new Promise((resolve) => {
    const child = spawn('which', [cli], { stdio: 'ignore' });
    child.on('close', (code) => resolve(code === 0));
  });
}

/**
 * Check if CLI is authenticated
 */
export async function isCliAuthenticated(platform: GitPlatform): Promise<boolean> {
  const cli = getCliCommand(platform);

  return new Promise((resolve) => {
    let output = '';
    const child = spawn(cli, ['auth', 'status'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    child.stdout?.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      // gh auth status returns 0 if logged in
      resolve(code === 0 && !output.includes('not logged'));
    });
  });
}

/**
 * Get repository owner and name from git remote
 */
export function getRepoInfo(): { owner: string; repo: string } | null {
  const url = getGitRemoteUrl();
  if (!url) return null;

  // Parse various URL formats
  // HTTPS: https://github.com/owner/repo.git
  // SSH: git@github.com:owner/repo.git
  let match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  match = url.match(/gitlab\.com[:/]([^/]+)\/([^/.]+)/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  match = url.match(/bitbucket\.org[:/]([^/]+)\/([^/.]+)/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  return null;
}

/**
 * Execute platform CLI command
 */
function execPlatformCli(
  platform: GitPlatform,
  args: string[],
  cwd?: string
): Promise<PlatformResult> {
  const cli = getCliCommand(platform);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const child = spawn(cli, args, {
      cwd: cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        success: code === 0,
        output: stdout || stderr,
        error: code !== 0 ? stderr : undefined
      });
    });
  });
}

/**
 * List pull requests
 */
export async function listPullRequests(
  platform: GitPlatform,
  state: 'open' | 'closed' | 'all' = 'open'
): Promise<PullRequest[]> {
  let args: string[];

  switch (platform) {
    case 'github':
      args = ['pr', 'list', '--json', 'number,title,state,head,base,user,html_url'];
      if (state !== 'all') {
        args.push('--state', state);
      }
      break;
    case 'gitlab':
      args = ['mr', 'list', '--output', 'json'];
      if (state !== 'all') {
        args.push('--state', state === 'open' ? 'opened' : state);
      }
      break;
    case 'bitbucket':
      args = ['pr', 'list', '--format', 'json'];
      if (state !== 'all') {
        args.push('--state', state);
      }
      break;
  }

  const result = await execPlatformCli(platform, args);

  if (!result.success) {
    return [];
  }

  try {
    const data = JSON.parse(result.output);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Create a pull request
 */
export async function createPullRequest(
  platform: GitPlatform,
  title: string,
  body?: string,
  base?: string
): Promise<PlatformResult> {
  let args: string[];

  switch (platform) {
    case 'github':
      args = ['pr', 'create', '--title', title];
      if (body) args.push('--body', body);
      if (base) args.push('--base', base);
      break;
    case 'gitlab':
      args = ['mr', 'create', '--title', title];
      if (body) args.push('--description', body);
      if (base) args.push('--target-branch', base);
      break;
    case 'bitbucket':
      args = ['pr', 'create', '--title', title];
      if (body) args.push('--description', body);
      if (base) args.push('--destination', base);
      break;
  }

  return execPlatformCli(platform, args);
}

/**
 * Merge a pull request
 */
export async function mergePullRequest(
  platform: GitPlatform,
  number: number,
  method: 'merge' | 'squash' | 'rebase' = 'merge'
): Promise<MergeResult> {
  let args: string[];

  switch (platform) {
    case 'github':
      args = ['pr', 'merge', number.toString(), `--${method}`];
      break;
    case 'gitlab':
      args = ['mr', 'merge', number.toString()];
      if (method === 'squash') args.push('--squash');
      break;
    case 'bitbucket':
      args = ['pr', 'merge', number.toString()];
      break;
  }

  const result = await execPlatformCli(platform, args);

  // Check for conflict indicators in output
  const hasConflicts =
    result.error?.toLowerCase().includes('conflict') ||
    result.output?.toLowerCase().includes('conflict') ||
    result.error?.toLowerCase().includes('merge conflict') ||
    result.output?.toLowerCase().includes('merge conflict');

  return {
    success: result.success && !hasConflicts,
    output: result.output,
    error: result.error,
    hasConflicts
  };
}

/**
 * Checkout a pull request locally
 */
export async function checkoutPullRequest(
  platform: GitPlatform,
  number: number
): Promise<PlatformResult> {
  const args: string[] = ['pr', 'checkout', number.toString()];
  return execPlatformCli(platform, args);
}

/**
 * Close a pull request
 */
export async function closePullRequest(
  platform: GitPlatform,
  number: number
): Promise<PlatformResult> {
  let args: string[] | null = null;

  switch (platform) {
    case 'github':
      args = ['pr', 'close', number.toString()];
      break;
    case 'gitlab':
      args = ['mr', 'close', number.toString()];
      break;
    case 'bitbucket':
      args = null;
      break;
  }

  if (!args) {
    return { success: false, output: '', error: 'Close not supported for this platform' };
  }

  return execPlatformCli(platform, args);
}

/**
 * Reopen a pull request
 */
export async function reopenPullRequest(
  platform: GitPlatform,
  number: number
): Promise<PlatformResult> {
  let args: string[] | null = null;

  switch (platform) {
    case 'github':
      args = ['pr', 'reopen', number.toString()];
      break;
    case 'gitlab':
      args = ['mr', 'reopen', number.toString()];
      break;
    case 'bitbucket':
      args = null;
      break;
  }

  if (!args) {
    return { success: false, output: '', error: 'Reopen not supported for this platform' };
  }

  return execPlatformCli(platform, args);
}

/**
 * Add assignee to a pull request
 */
export async function addAssignee(
  platform: GitPlatform,
  number: number,
  assignee: string
): Promise<PlatformResult> {
  let args: string[] | null = null;

  switch (platform) {
    case 'github':
      args = ['pr', 'edit', number.toString(), '--add-assignee', assignee];
      break;
    default:
      args = null;
      break;
  }

  if (!args) {
    return { success: false, output: '', error: 'Assign not supported for this platform' };
  }

  return execPlatformCli(platform, args);
}

/**
 * Request a review from a user
 */
export async function requestReview(
  platform: GitPlatform,
  number: number,
  reviewer: string
): Promise<PlatformResult> {
  let args: string[] | null = null;

  switch (platform) {
    case 'github':
      args = ['pr', 'edit', number.toString(), '--add-reviewer', reviewer];
      break;
    default:
      args = null;
      break;
  }

  if (!args) {
    return { success: false, output: '', error: 'Request review not supported for this platform' };
  }

  return execPlatformCli(platform, args);
}

/**
 * Add a comment to a pull request
 */
export async function addComment(
  platform: GitPlatform,
  number: number,
  body: string
): Promise<PlatformResult> {
  let args: string[] | null = null;

  switch (platform) {
    case 'github':
      args = ['pr', 'comment', number.toString(), '--body', body];
      break;
    default:
      args = null;
      break;
  }

  if (!args) {
    return { success: false, output: '', error: 'Comments not supported for this platform' };
  }

  return execPlatformCli(platform, args);
}

/**
 * Get pull request details
 */
export async function getPullRequestDetails(
  platform: GitPlatform,
  number: number
): Promise<PullRequest | null> {
  let args: string[];

  switch (platform) {
    case 'github':
      args = ['pr', 'view', number.toString(), '--json', 'number,title,state,head,base,user,html_url,mergeable,mergeableState'];
      break;
    case 'gitlab':
      args = ['mr', 'view', number.toString(), '--output', 'json'];
      break;
    case 'bitbucket':
      args = ['pr', 'view', number.toString(), '--format', 'json'];
      break;
  }

  const result = await execPlatformCli(platform, args);

  if (!result.success) {
    return null;
  }

  try {
    return JSON.parse(result.output);
  } catch {
    return null;
  }
}

/**
 * Generate conflict resolution URL
 */
export function generateConflictUrl(
  platform: GitPlatform,
  owner: string,
  repo: string,
  number: number
): string {
  switch (platform) {
    case 'github':
      return `https://github.com/${owner}/${repo}/pull/${number}/conflicts`;
    case 'gitlab':
      return `https://gitlab.com/${owner}/${repo}/merge_requests/${number}/conflicts`;
    case 'bitbucket':
      return `https://bitbucket.org/${owner}/${repo}/pull-requests/${number}/diff`;
    default:
      return `https://github.com/${owner}/${repo}/pull/${number}`;
  }
}

/**
 * Check if a PR has merge conflicts
 */
export async function checkMergeStatus(
  platform: GitPlatform,
  number: number
): Promise<{ hasConflicts: boolean; conflictUrl?: string; details?: PullRequest }> {
  const details = await getPullRequestDetails(platform, number);
  const repoInfo = getRepoInfo();

  if (!details) {
    return { hasConflicts: true };
  }

  // GitHub provides mergeable state
  if (platform === 'github' && details.mergeable === false) {
    return {
      hasConflicts: true,
      conflictUrl: repoInfo ? generateConflictUrl(platform, repoInfo.owner, repoInfo.repo, number) : undefined,
      details
    };
  }

  // For other platforms or uncertain state, try to merge and check
  return { hasConflicts: false, details };
}

/**
 * Get setup instructions for a platform CLI
 */
export function getSetupInstructions(platform: GitPlatform): string {
  switch (platform) {
    case 'github':
      return `
${chalk.bold('GitHub CLI (gh) Setup Instructions:')}

1. Install gh CLI:
   ${chalk.cyan('• macOS:')} brew install gh
   ${chalk.cyan('• Ubuntu/Debian:')} sudo apt install gh
   ${chalk.cyan('• Windows:')} winget install --id GitHub.cli
   ${chalk.cyan('• Other:')} https://github.com/cli/cli#installation

2. Authenticate:
   ${chalk.cyan('gh auth login')}

3. Verify:
   ${chalk.cyan('gh auth status')}
      `.trim();

    case 'gitlab':
      return `
${chalk.bold('GitLab CLI (glab) Setup Instructions:')}

1. Install glab CLI:
   ${chalk.cyan('• macOS:')} brew install glab
   ${chalk.cyan('• Linux:')} https://glab.readthedocs.io/installation/

2. Authenticate:
   ${chalk.cyan('glab auth login')}

3. Verify:
   ${chalk.cyan('glab auth status')}
      `.trim();

    case 'bitbucket':
      return `
${chalk.bold('Bitbucket CLI (bb) Setup Instructions:')}

1. Install bb CLI via npm:
   ${chalk.cyan('npm install -g bitbucket-cli')}

2. Authenticate:
   ${chalk.cyan('bb auth login')}

3. Verify:
   ${chalk.cyan('bb auth status')}
      `.trim();
  }
}

/**
 * Open URL in browser
 */
export { openUrl } from './utils.js';
