import chalk from 'chalk';
import {
  isGitRepository,
  getCurrentBranch,
  getAllBranches,
  getGitStatus,
  getGitDiff,
  getChangedFiles,
  formatStatusSummary,
  formatDetailedStatus,
  formatCommitLog,
  switchBranch,
  createBranch,
  deleteBranch,
  stageAll,
  gitCommit,
  gitPush,
  gitPull,
  gitInit,
  getCommitLog,
  type Branch
} from '../git.js';
import { clearMenuStack, isAtMainMenu, popMenu, pushMenu } from './menu-stack.js';
import { printError, printInfo, printSuccess, printWarning, promptConfirm, promptInput, selectFromList, selectFromSubmenu } from '../utils.js';

/**
 * Main Git menu handler
 */
export async function gitMenu(): Promise<void> {
  // Check if we're in a git repository
  if (!isGitRepository()) {
    console.log(chalk.yellow('\n⚠️  Not a git repository\n'));
    console.log(chalk.gray('This directory is not initialized as a Git repository.\n'));

    const shouldInit = await promptConfirm('Would you like to initialize one?');

    if (shouldInit) {
      const result = gitInit();
      if (result.success) {
        printSuccess(result.message);
      } else {
        printError(result.message);
        if (result.error) console.log(chalk.gray(result.error));
      }
    }
    return;
  }

  pushMenu('git');

  while (true) {
    const branch = getCurrentBranch();
    const status = getGitStatus();

    // Show current branch and status summary in header
    console.log(chalk.gray(`\n⎇  Branch: ${chalk.cyan(branch || 'unknown')} | ${formatStatusSummary(status)}\n`));

    const result = await selectFromSubmenu('Git Operations:', [
      { name: chalk.cyan('📊 Status') + chalk.gray(' - View working tree status'), value: 'status' },
      { name: chalk.green('📝 Diff') + chalk.gray(' - View changes'), value: 'diff' },
      { name: chalk.yellow('⎇  Branches') + chalk.gray(' - Switch, create, delete'), value: 'branches' },
      { name: chalk.magenta('📦 Commit') + chalk.gray(' - Stage and commit changes'), value: 'commit' },
      { name: chalk.blue('⬆️  Push') + chalk.gray(' - Push to remote'), value: 'push' },
      { name: chalk.blue('⬇️  Pull') + chalk.gray(' - Pull from remote'), value: 'pull' },
      { name: chalk.gray('📜 Log') + chalk.gray(' - View commit history'), value: 'log' }
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
        case 'status':
          await gitStatusView();
          break;
        case 'diff':
          await gitDiffMenu();
          break;
        case 'branches':
          await gitBranchMenu();
          break;
        case 'commit':
          await gitCommitFlow();
          break;
        case 'push':
          await gitPushFlow();
          break;
        case 'pull':
          await gitPullFlow();
          break;
        case 'log':
          await gitLogView();
          break;
      }
      if (isAtMainMenu()) {
        return;
      }
    }
  }
}

/**
 * Display detailed git status
 */
async function gitStatusView(): Promise<void> {
  const status = getGitStatus();
  console.log('\n' + formatDetailedStatus(status));

  // Wait for user to acknowledge
  await promptInput(chalk.gray('\nPress Enter to continue...'));
}

/**
 * Git diff submenu
 */
async function gitDiffMenu(): Promise<void> {
  pushMenu('git-diff');

  while (true) {
    const result = await selectFromSubmenu('View Diff:', [
      { name: chalk.green('📝 All changes') + chalk.gray(' - Unstaged changes'), value: 'all' },
      { name: chalk.yellow('📦 Staged changes') + chalk.gray(' - Changes ready to commit'), value: 'staged' },
      { name: chalk.blue('📄 Specific file') + chalk.gray(' - Diff for one file'), value: 'file' }
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
        case 'all':
          await showDiff({ staged: false });
          break;
        case 'staged':
          await showDiff({ staged: true });
          break;
        case 'file':
          await showFileDiff();
          break;
      }
      if (isAtMainMenu()) {
        return;
      }
    }
  }
}

/**
 * Show diff output
 */
async function showDiff(options: { staged: boolean }): Promise<void> {
  const diff = getGitDiff(options);

  if (!diff.raw.trim()) {
    printInfo(options.staged ? 'No staged changes' : 'No unstaged changes');
    return;
  }

  console.log('\n' + diff.formatted);

  // Wait for user to acknowledge
  await promptInput(chalk.gray('\nPress Enter to continue...'));
}

/**
 * Show diff for a specific file
 */
async function showFileDiff(): Promise<void> {
  // Get list of changed files (both staged and unstaged)
  const unstagedFiles = getChangedFiles(false);
  const stagedFiles = getChangedFiles(true);
  const allFiles = [...new Set([...unstagedFiles, ...stagedFiles])];

  if (allFiles.length === 0) {
    printInfo('No changed files to show diff for');
    return;
  }

  const choices = allFiles.map(file => {
    const isStaged = stagedFiles.includes(file);
    const isUnstaged = unstagedFiles.includes(file);
    let status = '';
    if (isStaged && isUnstaged) status = chalk.yellow(' (staged + unstaged)');
    else if (isStaged) status = chalk.green(' (staged)');
    else status = chalk.red(' (unstaged)');

    return { name: file + status, value: file };
  });

  const selectedFile = await selectFromList<string>('Select file to diff:', choices);

  if (!selectedFile) return;

  const diff = getGitDiff({ file: selectedFile });

  if (!diff.raw.trim()) {
    printInfo(`No changes in ${selectedFile}`);
    return;
  }

  console.log('\n' + diff.formatted);

  // Wait for user to acknowledge
  await promptInput(chalk.gray('\nPress Enter to continue...'));
}

/**
 * Git branch management submenu
 */
async function gitBranchMenu(): Promise<void> {
  pushMenu('git-branches');

  while (true) {
    const currentBranch = getCurrentBranch();
    console.log(chalk.gray(`\nCurrent branch: ${chalk.cyan(currentBranch || 'unknown')}\n`));

    const result = await selectFromSubmenu('Branch Operations:', [
      { name: chalk.green('🔄 Switch branch') + chalk.gray(' - Checkout existing branch'), value: 'switch' },
      { name: chalk.blue('➕ Create branch') + chalk.gray(' - Create and switch to new branch'), value: 'create' },
      { name: chalk.red('🗑️  Delete branch') + chalk.gray(' - Delete a local branch'), value: 'delete' },
      { name: chalk.gray('📋 List all branches') + chalk.gray(' - View local and remote'), value: 'list' }
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
        case 'switch':
          await gitBranchSwitch();
          break;
        case 'create':
          await gitBranchCreate();
          break;
        case 'delete':
          await gitBranchDelete();
          break;
        case 'list':
          await gitBranchList();
          break;
      }
      if (isAtMainMenu()) {
        return;
      }
    }
  }
}

/**
 * Interactive branch switcher
 */
async function gitBranchSwitch(): Promise<void> {
  const { local, remote } = getAllBranches();
  const currentBranch = getCurrentBranch();

  if (local.length === 0 && remote.length === 0) {
    printWarning('No branches found');
    return;
  }

  const choices: { name: string; value: string }[] = [];

  // Add local branches
  if (local.length > 0) {
    for (const branch of local) {
      const isCurrent = branch.name === currentBranch;
      const prefix = isCurrent ? chalk.green('● ') : chalk.gray('○ ');
      const suffix = isCurrent ? chalk.green(' (current)') : '';
      choices.push({
        name: prefix + branch.name + suffix,
        value: branch.name
      });
    }
  }

  // Add separator and remote branches
  if (remote.length > 0) {
    choices.push({ name: chalk.gray('─────────────── Remote ───────────────'), value: '__separator__' });
    for (const branch of remote) {
      choices.push({
        name: chalk.gray('○ ') + chalk.blue(branch.name) + chalk.gray(' (remote)'),
        value: branch.name
      });
    }
  }

  const selected = await selectFromList<string>('Select branch to switch to:', choices);

  if (!selected || selected === '__separator__') return;

  // Don't switch to current branch
  if (selected === currentBranch) {
    printInfo(`Already on branch '${selected}'`);
    return;
  }

  const result = switchBranch(selected);

  if (result.success) {
    printSuccess(result.message);
  } else {
    printError(result.message);
    if (result.error) console.log(chalk.gray(result.error));
  }
}

/**
 * Create a new branch
 */
async function gitBranchCreate(): Promise<void> {
  const branchName = await promptInput('Enter new branch name:');

  if (!branchName || !branchName.trim()) {
    printWarning('No branch name provided');
    return;
  }

  // Validate branch name (basic validation)
  const cleanName = branchName.trim();
  if (cleanName.includes(' ') || cleanName.includes('..') || cleanName.startsWith('-')) {
    printError('Invalid branch name. Branch names cannot contain spaces, "..", or start with "-"');
    return;
  }

  const result = createBranch(cleanName, true);

  if (result.success) {
    printSuccess(result.message);
  } else {
    printError(result.message);
    if (result.error) console.log(chalk.gray(result.error));
  }
}

/**
 * Delete a branch with confirmation
 */
async function gitBranchDelete(): Promise<void> {
  const { local } = getAllBranches();
  const currentBranch = getCurrentBranch();

  // Filter out current branch
  const deletableBranches = local.filter(b => b.name !== currentBranch);

  if (deletableBranches.length === 0) {
    printWarning('No branches available to delete (cannot delete current branch)');
    return;
  }

  const choices = deletableBranches.map(branch => ({
    name: branch.name,
    value: branch.name
  }));

  const selected = await selectFromList<string>('Select branch to delete:', choices);

  if (!selected) return;

  // Show warning
  console.log('');
  console.log(chalk.red.bold('╔════════════════════════════════════════════════════════════╗'));
  console.log(chalk.red.bold('║                       ⚠️ WARNING ⚠️                        ║'));
  console.log(chalk.red.bold('╚════════════════════════════════════════════════════════════╝'));
  console.log(chalk.red(`\n⎇  You are about to delete branch: ${chalk.bold(selected)}`));
  console.log(chalk.red('\nThis action cannot be undone. Any unmerged commits on this branch'));
  console.log(chalk.red('will be lost.\n'));

  const confirmed = await promptConfirm(`Are you sure you want to delete branch '${selected}'?`);

  if (!confirmed) {
    printInfo('Deletion cancelled');
    return;
  }

  let result = deleteBranch(selected, false);

  // If branch has unmerged changes, offer force delete
  if (!result.success && result.error?.includes('force delete')) {
    printWarning('Branch has unmerged changes');
    const forceDelete = await promptConfirm('Force delete anyway? (This will lose unmerged commits)');

    if (forceDelete) {
      result = deleteBranch(selected, true);
    } else {
      printInfo('Deletion cancelled');
      return;
    }
  }

  if (result.success) {
    printSuccess(result.message);
  } else {
    printError(result.message);
    if (result.error) console.log(chalk.gray(result.error));
  }
}

/**
 * List all branches
 */
async function gitBranchList(): Promise<void> {
  const { local, remote } = getAllBranches();
  const currentBranch = getCurrentBranch();

  console.log(chalk.bold('\n📋 Branches\n'));

  // Local branches
  console.log(chalk.yellow.bold('Local branches:'));
  if (local.length === 0) {
    console.log(chalk.gray('  No local branches'));
  } else {
    for (const branch of local) {
      const isCurrent = branch.name === currentBranch;
      const prefix = isCurrent ? chalk.green('● ') : chalk.gray('  ');
      const suffix = isCurrent ? chalk.green(' (current)') : '';
      console.log(prefix + branch.name + suffix);
    }
  }

  // Remote branches
  console.log(chalk.blue.bold('\nRemote branches:'));
  if (remote.length === 0) {
    console.log(chalk.gray('  No remote branches'));
  } else {
    for (const branch of remote) {
      console.log(chalk.gray('  ') + chalk.blue(branch.name));
    }
  }

  console.log('');
  await promptInput(chalk.gray('Press Enter to continue...'));
}

/**
 * Git commit flow
 */
async function gitCommitFlow(): Promise<void> {
  const status = getGitStatus();

  // Show current status
  console.log('\n' + formatDetailedStatus(status));

  if (status.isClean) {
    printInfo('Nothing to commit');
    return;
  }

  // Ask if user wants to stage all changes
  if (status.unstaged > 0 || status.untracked > 0) {
    const stageAllChanges = await promptConfirm('Stage all changes before committing?');

    if (stageAllChanges) {
      const stageResult = stageAll();
      if (stageResult.success) {
        printSuccess(stageResult.message);
      } else {
        printError(stageResult.message);
        return;
      }
    }
  }

  // Check if there's anything staged
  const updatedStatus = getGitStatus();
  if (updatedStatus.staged === 0) {
    printWarning('No changes staged for commit');
    return;
  }

  // Get commit message
  const message = await promptInput('Enter commit message:');

  if (!message || !message.trim()) {
    printWarning('Commit cancelled - no message provided');
    return;
  }

  const result = gitCommit(message.trim());

  if (result.success) {
    printSuccess(result.message);
  } else {
    printError(result.message);
    if (result.error) console.log(chalk.gray(result.error));
  }
}

/**
 * Git push flow
 */
async function gitPushFlow(): Promise<void> {
  const branch = getCurrentBranch();
  const status = getGitStatus();

  console.log(chalk.gray(`\nCurrent branch: ${chalk.cyan(branch || 'unknown')}`));

  if (status.ahead === 0) {
    printInfo('No commits to push (branch is up to date with remote)');
    const pushAnyway = await promptConfirm('Push anyway?');
    if (!pushAnyway) return;
  } else {
    console.log(chalk.gray(`Commits to push: ${chalk.yellow(status.ahead)}\n`));
  }

  const confirmed = await promptConfirm(`Push to origin/${branch}?`);

  if (!confirmed) {
    printInfo('Push cancelled');
    return;
  }

  printInfo('Pushing...');
  const result = gitPush();

  if (result.success) {
    printSuccess(result.message);
  } else {
    printError(result.message);
    if (result.error) console.log(chalk.gray(result.error));
  }
}

/**
 * Git pull flow
 */
async function gitPullFlow(): Promise<void> {
  const branch = getCurrentBranch();
  const status = getGitStatus();

  console.log(chalk.gray(`\nCurrent branch: ${chalk.cyan(branch || 'unknown')}`));

  if (status.behind > 0) {
    console.log(chalk.gray(`Commits behind: ${chalk.yellow(status.behind)}\n`));
  }

  const confirmed = await promptConfirm(`Pull from origin/${branch}?`);

  if (!confirmed) {
    printInfo('Pull cancelled');
    return;
  }

  printInfo('Pulling...');
  const result = gitPull();

  if (result.success) {
    printSuccess(result.message);
  } else {
    printError(result.message);
    if (result.error) console.log(chalk.gray(result.error));
  }
}

/**
 * View git commit log
 */
async function gitLogView(): Promise<void> {
  const commits = getCommitLog(15);
  console.log('\n' + formatCommitLog(commits));

  await promptInput(chalk.gray('Press Enter to continue...'));
}
