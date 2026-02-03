import chalk from 'chalk';
import {
  GitPlatform,
  PullRequest,
  detectPlatform,
  isCliInstalled,
  isCliAuthenticated,
  getCliCommand,
  getRepoInfo,
  listPullRequests,
  createPullRequest,
  mergePullRequest,
  checkoutPullRequest,
  getPullRequestDetails,
  checkMergeStatus,
  getSetupInstructions,
  openUrl,
  closePullRequest,
  reopenPullRequest,
  addAssignee,
  requestReview,
  addComment
} from '../git-platform.js';
import {
  printError,
  printInfo,
  printSuccess,
  printWarning,
  promptConfirm,
  promptInput,
  selectFromList,
  selectFromSubmenu,
  formatTable
} from '../utils.js';
import { pushMenu, popMenu, isAtMainMenu, clearMenuStack } from './menu-stack.js';
import {
  conflictResolutionFlow,
  hasActiveConflictSession,
  loadConflictSession
} from './conflict-helper.js';

/**
 * Main Git Platform menu (GitHub/GitLab/Bitbucket PR management)
 */
export async function platformMenu(): Promise<void> {
  pushMenu('git-platform');

  // Check for active conflict sessions first
  if (hasActiveConflictSession()) {
    const session = loadConflictSession();
    if (session) {
      const resume = await promptConfirm(
        chalk.yellow(`Resume conflict resolution for PR #${session.prNumber}: "${session.prTitle}"?`),
        true
      );
      if (resume) {
        await conflictResolutionFlow(session.prNumber, session.prTitle, session.platform);
        popMenu();
        return;
      }
    }
  }

  // Detect platform from git remote
  const platform = detectPlatform();

  if (!platform) {
    printError('Not a git repository or unsupported remote URL');
    printInfo('This feature requires a git repository with GitHub, GitLab, or Bitbucket remote');
    popMenu();
    return;
  }

  // Check platform setup
  const setup = await ensurePlatformSetup(platform);
  if (!setup.ready) {
    printError(setup.error || 'Platform CLI not properly configured');
    popMenu();
    return;
  }

  while (true) {
    const result = await selectFromSubmenu(
      `${getPlatformIcon(platform)} ${getPlatformName(platform)} PR Management:`,
      [
        { name: chalk.green('➕ Create PR') + chalk.gray(' - Open a new pull request'), value: 'create' },
        { name: chalk.blue('📋 List PRs') + chalk.gray(' - View open/closed pull requests'), value: 'list' },
        { name: chalk.yellow('🔀 Merge PR') + chalk.gray(' - Merge an open pull request'), value: 'merge' },
        { name: chalk.cyan('📥 Checkout PR') + chalk.gray(' - Checkout a PR locally'), value: 'checkout' },
        { name: chalk.magenta('🧭 PR Actions') + chalk.gray(' - Comment, assign, close, reopen'), value: 'actions' }
      ]
    );

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
          await createPullRequestFlow(platform);
          break;
        case 'list':
          await listPullRequestsFlow(platform);
          break;
        case 'merge':
          await mergePullRequestFlow(platform);
          break;
        case 'checkout':
          await checkoutPullRequestFlow(platform);
          break;
        case 'actions':
          await prActionsFlow(platform);
          break;
      }

      if (isAtMainMenu()) {
        return;
      }
    }
  }
}

/**
 * Additional PR actions flow
 */
async function prActionsFlow(platform: GitPlatform): Promise<void> {
  pushMenu('pr-actions');
  console.log(chalk.bold('\n🧭 PR Actions\n'));

  const prs = await listPullRequests(platform, 'all');

  if (prs.length === 0) {
    printWarning('No pull requests found');
    popMenu();
    return;
  }

  const choices = prs.map(pr => ({
    name: `${chalk.cyan(`#${pr.number}`)} ${pr.title} ${chalk.gray(`(${pr.state})`)}`,
    value: pr
  }));

  const selected = await selectFromList('Select PR:', choices);

  if (!selected || typeof selected !== 'object' || !('number' in selected)) {
    popMenu();
    return;
  }

  const pr = selected as PullRequest;

  const action = await selectFromSubmenu('Choose action:', [
    { name: chalk.cyan('💬 Add comment'), value: 'comment' },
    { name: chalk.blue('👤 Add assignee'), value: 'assign' },
    { name: chalk.yellow('🧑‍⚖️ Request review'), value: 'review' },
    { name: chalk.red('⛔ Close PR'), value: 'close' },
    { name: chalk.green('♻️ Reopen PR'), value: 'reopen' }
  ]);

  if (action.action !== 'select' || !action.value) {
    popMenu();
    return;
  }

  switch (action.value) {
    case 'comment':
      await addCommentFlow(platform, pr.number);
      break;
    case 'assign':
      await addAssigneeFlow(platform, pr.number);
      break;
    case 'review':
      await requestReviewFlow(platform, pr.number);
      break;
    case 'close':
      await closePullRequestFlow(platform, pr.number);
      break;
    case 'reopen':
      await reopenPullRequestFlow(platform, pr.number);
      break;
  }

  popMenu();
}

async function addCommentFlow(platform: GitPlatform, number: number): Promise<void> {
  const body = await promptInput('Comment:');
  if (!body?.trim()) {
    printWarning('Comment cannot be empty');
    return;
  }

  const result = await addComment(platform, number, body.trim());
  if (result.success) {
    printSuccess('✅ Comment added');
  } else {
    printError(result.error || 'Failed to add comment');
  }
}

async function addAssigneeFlow(platform: GitPlatform, number: number): Promise<void> {
  const user = await promptInput('Assignee username:');
  if (!user?.trim()) {
    printWarning('Assignee cannot be empty');
    return;
  }

  const result = await addAssignee(platform, number, user.trim());
  if (result.success) {
    printSuccess('✅ Assignee added');
  } else {
    printError(result.error || 'Failed to add assignee');
  }
}

async function requestReviewFlow(platform: GitPlatform, number: number): Promise<void> {
  const user = await promptInput('Reviewer username:');
  if (!user?.trim()) {
    printWarning('Reviewer cannot be empty');
    return;
  }

  const result = await requestReview(platform, number, user.trim());
  if (result.success) {
    printSuccess('✅ Review requested');
  } else {
    printError(result.error || 'Failed to request review');
  }
}

async function closePullRequestFlow(platform: GitPlatform, number: number): Promise<void> {
  const confirm = await promptConfirm(`Close PR #${number}?`, false);
  if (!confirm) return;

  const result = await closePullRequest(platform, number);
  if (result.success) {
    printSuccess('✅ PR closed');
  } else {
    printError(result.error || 'Failed to close PR');
  }
}

async function reopenPullRequestFlow(platform: GitPlatform, number: number): Promise<void> {
  const confirm = await promptConfirm(`Reopen PR #${number}?`, false);
  if (!confirm) return;

  const result = await reopenPullRequest(platform, number);
  if (result.success) {
    printSuccess('✅ PR reopened');
  } else {
    printError(result.error || 'Failed to reopen PR');
  }
}

/**
 * Ensure platform CLI is installed and authenticated
 */
async function ensurePlatformSetup(platform: GitPlatform): Promise<{ ready: boolean; error?: string }> {
  const cli = getCliCommand(platform);

  // Check if CLI is installed
  const installed = await isCliInstalled(platform);
  if (!installed) {
    console.log(chalk.red(`\n❌ ${cli} CLI is not installed`));
    console.log(getSetupInstructions(platform));
    return { ready: false, error: `${cli} CLI not installed` };
  }

  // Check if authenticated
  const authenticated = await isCliAuthenticated(platform);
  if (!authenticated) {
    console.log(chalk.red(`\n❌ ${cli} CLI is not authenticated`));
    console.log(chalk.cyan(`\nRun: ${cli} auth login`));
    return { ready: false, error: `${cli} CLI not authenticated` };
  }

  return { ready: true };
}

/**
 * Flow for creating a new pull request
 */
async function createPullRequestFlow(platform: GitPlatform): Promise<void> {
  pushMenu('create-pr');
  console.log(chalk.bold('\n➕ Create New Pull Request\n'));

  try {
    // Get PR title
    const title = await promptInput('PR Title:');
    if (!title?.trim()) {
      printWarning('Title is required');
      popMenu();
      return;
    }

    // Get PR body (optional)
    const body = await promptInput('PR Description (optional):');

    // Select base branch
    const baseBranch = await selectBaseBranch(platform);
    if (!baseBranch) {
      printInfo('Cancelled');
      popMenu();
      return;
    }

    printInfo('Creating pull request...');

    const result = await createPullRequest(platform, title.trim(), body?.trim(), baseBranch);

    if (result.success) {
      printSuccess('Pull request created successfully!');
      // Extract PR URL from output
      const urlMatch = result.output.match(/(https:\/\/[^\s]+)/);
      if (urlMatch) {
        printInfo(`URL: ${chalk.cyan(urlMatch[1])}`);

        const open = await promptConfirm('Open in browser?', false);
        if (open) {
          await openUrl(urlMatch[1]);
        }
      }
    } else {
      printError('Failed to create pull request');
      if (result.error) {
        printError(result.error);
      }
    }
  } catch (error) {
    printError(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  popMenu();
}

/**
 * Flow for listing pull requests
 */
async function listPullRequestsFlow(platform: GitPlatform): Promise<void> {
  pushMenu('list-prs');
  console.log(chalk.bold('\n📋 Pull Requests\n'));

  // Select state filter
  const stateResult = await selectFromSubmenu('Filter by state:', [
    { name: chalk.green('● Open'), value: 'open' },
    { name: chalk.gray('○ Closed'), value: 'closed' },
    { name: chalk.blue('◉ All'), value: 'all' }
  ]);

  if (stateResult.action !== 'select' || !stateResult.value) {
    popMenu();
    return;
  }

  const state = stateResult.value as 'open' | 'closed' | 'all';

  printInfo('Fetching pull requests...');

  const prs = await listPullRequests(platform, state);

  if (prs.length === 0) {
    printWarning(`No ${state} pull requests found`);
    popMenu();
    return;
  }

  // Display PRs in table format
  const tableData = prs.map(pr => ({
    Number: `#${pr.number}`,
    Title: pr.title.slice(0, 40) + (pr.title.length > 40 ? '...' : ''),
    Author: `@${pr.user.login}`,
    Base: pr.base.ref,
    State: pr.state
  }));

  console.log('\n' + formatTable(tableData));

  // Allow user to select a PR for details or checkout
  const choices = [
    ...prs.map(pr => ({
      name: `${chalk.cyan(`#${pr.number}`)} ${pr.title.slice(0, 50)} ${chalk.gray(`@${pr.user.login}`)}`,
      value: pr
    })),
    { name: chalk.gray('─── Back ───'), value: null }
  ];

  const selected = await selectFromList('Select a PR to view or checkout:', choices);

  if (selected && typeof selected === 'object' && 'number' in selected) {
    const pr = selected as PullRequest;

    console.log(chalk.bold(`\n📋 PR #${pr.number}: ${pr.title}\n`));
    console.log(`Author: ${chalk.cyan(`@${pr.user.login}`)}`);
    console.log(`Branch: ${chalk.yellow(pr.head.ref)} → ${chalk.yellow(pr.base.ref)}`);
    console.log(`URL: ${chalk.blue(pr.html_url)}`);
    console.log(`State: ${pr.state === 'open' ? chalk.green('Open') : chalk.gray('Closed')}\n`);

    const action = await selectFromSubmenu('Actions:', [
      { name: chalk.cyan('📥 Checkout locally'), value: 'checkout' },
      { name: chalk.blue('🔗 Open in browser'), value: 'open' },
      { name: chalk.gray('← Back'), value: 'back' }
    ]);

    if (action.action === 'select') {
      if (action.value === 'checkout') {
        await checkoutPR(platform, pr.number);
      } else if (action.value === 'open') {
        await openUrl(pr.html_url);
      }
    }
  }

  popMenu();
}

/**
 * Flow for merging a pull request
 */
async function mergePullRequestFlow(platform: GitPlatform): Promise<void> {
  pushMenu('merge-pr');
  console.log(chalk.bold('\n🔀 Merge Pull Request\n'));

  // Get open PRs
  const prs = await listPullRequests(platform, 'open');

  if (prs.length === 0) {
    printWarning('No open pull requests to merge');
    popMenu();
    return;
  }

  // Show PRs to select
  const choices = prs.map(pr => ({
    name: `${chalk.cyan(`#${pr.number}`)} ${pr.title} ${chalk.gray(`@${pr.user.login} ← ${pr.head.ref}`)}`,
    value: pr
  }));

  const selected = await selectFromList('Select PR to merge:', choices);

  if (!selected || typeof selected !== 'object' || !('number' in selected)) {
    popMenu();
    return;
  }

  const pr = selected as PullRequest;

  // Confirm merge
  const confirm = await promptConfirm(
    `Merge PR #${pr.number}: "${pr.title}" using standard merge?`,
    false
  );

  if (!confirm) {
    popMenu();
    return;
  }

  printInfo(`Attempting to merge PR #${pr.number}...`);

  const result = await mergePullRequest(platform, pr.number, 'merge');

  if (result.success) {
    printSuccess(`✅ PR #${pr.number} merged successfully!`);
    printInfo(result.output);
  } else if (result.hasConflicts) {
    printWarning('⚠️  Merge conflicts detected!');
    printInfo('Launching conflict resolution helper...\n');

    // Save conflict session and launch helper
    await conflictResolutionFlow(pr.number, pr.title, platform);
  } else {
    printError('❌ Failed to merge pull request');
    if (result.error) {
      printError(result.error);
    }
  }

  popMenu();
}

/**
 * Flow for checking out a pull request
 */
async function checkoutPullRequestFlow(platform: GitPlatform): Promise<void> {
  pushMenu('checkout-pr');
  console.log(chalk.bold('\n📥 Checkout Pull Request\n'));

  // Get open PRs
  const prs = await listPullRequests(platform, 'open');

  if (prs.length === 0) {
    printWarning('No open pull requests to checkout');
    popMenu();
    return;
  }

  // Show PRs
  const choices = prs.map(pr => ({
    name: `${chalk.cyan(`#${pr.number}`)} ${pr.title} ${chalk.gray(`← ${pr.head.ref}`)}`,
    value: pr
  }));

  const selected = await selectFromList('Select PR to checkout:', choices);

  if (selected && typeof selected === 'object' && 'number' in selected) {
    const pr = selected as PullRequest;
    await checkoutPR(platform, pr.number);
  }

  popMenu();
}

/**
 * Checkout a specific PR
 */
async function checkoutPR(platform: GitPlatform, number: number): Promise<void> {
  printInfo(`Checking out PR #${number}...`);

  const result = await checkoutPullRequest(platform, number);

  if (result.success) {
    printSuccess(`✅ Checked out PR #${number}`);
    printInfo(result.output);
  } else {
    printError('❌ Failed to checkout pull request');
    if (result.error) {
      printError(result.error);
    }
  }
}

/**
 * Select base branch for PR creation
 */
async function selectBaseBranch(platform: GitPlatform): Promise<string | null> {
  // Try to detect default branch
  let defaultBranch = 'main';
  try {
    const { execSync } = await import('child_process');
    const result = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' });
    const currentBranch = result.trim();

    // Get remote branches
    const remoteResult = execSync('git branch -r', { encoding: 'utf-8' });
    const branches = remoteResult.split('\n').map(b => b.trim().replace('origin/', '')).filter(Boolean);

    // Common default branches
    if (branches.includes('main')) defaultBranch = 'main';
    else if (branches.includes('master')) defaultBranch = 'master';
    else if (branches.includes('develop')) defaultBranch = 'develop';
  } catch {
    // Default to main if detection fails
  }

  // Common base branches
  const commonBranches = ['main', 'master', 'develop', 'dev', 'staging'];

  const choices = [
    { name: `${chalk.green(defaultBranch)} ${chalk.gray('(detected default)')}`, value: defaultBranch },
    ...commonBranches
      .filter(b => b !== defaultBranch)
      .map(b => ({ name: b, value: b })),
    { name: chalk.gray('Other (specify)'), value: 'other' }
  ];

  const result = await selectFromList('Select base branch:', choices);

  if (result === 'other') {
    const custom = await promptInput('Enter base branch name:');
    return custom?.trim() || null;
  }

  return result;
}

/**
 * Get platform icon
 */
function getPlatformIcon(platform: GitPlatform): string {
  switch (platform) {
    case 'github':
      return '⚫';
    case 'gitlab':
      return '🦊';
    case 'bitbucket':
      return '🪣';
    default:
      return '🔀';
  }
}

/**
 * Get platform name
 */
function getPlatformName(platform: GitPlatform): string {
  switch (platform) {
    case 'github':
      return 'GitHub';
    case 'gitlab':
      return 'GitLab';
    case 'bitbucket':
      return 'Bitbucket';
    default:
      return 'Git';
  }
}
