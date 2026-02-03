import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import chalk from 'chalk';
import {
  GitPlatform,
  PullRequest,
  getPullRequestDetails,
  generateConflictUrl,
  getRepoInfo,
  openUrl
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
  checkEditorInstalled,
  executeEditor
} from '../utils.js';
import { getConfig, saveConfig } from '../config.js';
import { pushMenu, popMenu } from './menu-stack.js';

const CONFLICTS_DIR = '.conflicts';

interface ConflictSession {
  prNumber: number;
  prTitle: string;
  platform: GitPlatform;
  repoOwner: string;
  repoName: string;
  conflictedFiles: string[];
  startedAt: string;
  lastStep: 'checkout' | 'review' | 'edit' | 'resolve' | 'commit';
  preferredEditor?: 'nano' | 'vim' | 'fresh';
}

/**
 * Save conflict session to file
 */
export function saveConflictSession(session: ConflictSession): void {
  try {
    const configDir = process.env.HOME || process.env.USERPROFILE || '.';
    const conflictsDir = path.join(configDir, '.nl-terminal-cli', CONFLICTS_DIR);

    // Ensure directory exists
    fs.mkdirSync(conflictsDir, { recursive: true });

    const sessionFile = path.join(conflictsDir, `pr-${session.prNumber}.json`);
    fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));
  } catch (error) {
    console.error('Failed to save conflict session:', error);
  }
}

/**
 * Load conflict session for a specific PR
 */
export function loadConflictSession(prNumber?: number): ConflictSession | null {
  try {
    const configDir = process.env.HOME || process.env.USERPROFILE || '.';
    const conflictsDir = path.join(configDir, '.nl-terminal-cli', CONFLICTS_DIR);

    if (prNumber) {
      const sessionFile = path.join(conflictsDir, `pr-${prNumber}.json`);
      try {
        const data = fs.readFileSync(sessionFile, 'utf-8');
        return JSON.parse(data) as ConflictSession;
      } catch {
        return null;
      }
    } else {
      // Load most recent session
      const files = fs.readdirSync(conflictsDir);
      const sessionFiles = files.filter((f: string) => f.startsWith('pr-') && f.endsWith('.json'));

      if (sessionFiles.length === 0) return null;

      // Sort by modification time (most recent first)
      const sorted = sessionFiles.sort((a: string, b: string) => {
        const statA = fs.statSync(path.join(conflictsDir, a));
        const statB = fs.statSync(path.join(conflictsDir, b));
        return statB.mtime.getTime() - statA.mtime.getTime();
      });

      const mostRecent = sorted[0];
      const data = fs.readFileSync(path.join(conflictsDir, mostRecent), 'utf-8');
      return JSON.parse(data) as ConflictSession;
    }
  } catch {
    return null;
  }
}

/**
 * Check if there's an active conflict session
 */
export function hasActiveConflictSession(): boolean {
  return loadConflictSession() !== null;
}

/**
 * List all active conflict sessions
 */
export function listActiveConflictSessions(): ConflictSession[] {
  try {
    const configDir = process.env.HOME || process.env.USERPROFILE || '.';
    const conflictsDir = path.join(configDir, '.nl-terminal-cli', CONFLICTS_DIR);

    const files = fs.readdirSync(conflictsDir);
    const sessionFiles = files.filter((f: string) => f.startsWith('pr-') && f.endsWith('.json'));

    return sessionFiles.map((file: string) => {
      const data = fs.readFileSync(path.join(conflictsDir, file), 'utf-8');
      return JSON.parse(data) as ConflictSession;
    });
  } catch {
    return [];
  }
}

/**
 * Clear conflict session for a specific PR
 */
export function clearConflictSession(prNumber: number): void {
  try {
    const configDir = process.env.HOME || process.env.USERPROFILE || '.';
    const sessionFile = path.join(configDir, '.nl-terminal-cli', CONFLICTS_DIR, `pr-${prNumber}.json`);
    fs.unlinkSync(sessionFile);
  } catch {
    // File might not exist, that's fine
  }
}

/**
 * Main conflict resolution flow
 */
export async function conflictResolutionFlow(
  prNumber: number,
  prTitle: string,
  platform: GitPlatform
): Promise<void> {
  pushMenu('conflict-resolution');

  const repoInfo = getRepoInfo();
  if (!repoInfo) {
    printError('Could not determine repository information');
    popMenu();
    return;
  }

  // Create or load session
  let session = loadConflictSession(prNumber);

  if (!session) {
    // Get conflicted files
    const conflictedFiles = getConflictedFiles();

    session = {
      prNumber,
      prTitle,
      platform,
      repoOwner: repoInfo.owner,
      repoName: repoInfo.repo,
      conflictedFiles,
      startedAt: new Date().toISOString(),
      lastStep: 'checkout'
    };

    saveConflictSession(session);
  }

  // Show conflict resolution menu
  await showConflictMenu(session);

  popMenu();
}

/**
 * Show main conflict resolution menu
 */
async function showConflictMenu(session: ConflictSession): Promise<void> {
  const conflictUrl = generateConflictUrl(
    session.platform,
    session.repoOwner,
    session.repoName,
    session.prNumber
  );

  console.log(chalk.bold(`\n⚠️  Merge Conflict Detected\n`));
  console.log(`PR #${session.prNumber}: "${session.prTitle}" has conflicts that need resolution.\n`);

  if (session.conflictedFiles.length > 0) {
    console.log(chalk.yellow(`📁 Conflicted files (${session.conflictedFiles.length}):`));
    session.conflictedFiles.forEach(file => {
      console.log(`   ${chalk.red('✗')} ${file}`);
    });
    console.log();
  }

  while (true) {
    const result = await selectFromSubmenu('Choose resolution method:', [
      { name: chalk.blue('🔗 Open GitHub Conflict Resolver') + chalk.gray(' (web interface)'), value: 'web' },
      { name: chalk.cyan('📁 Resolve Locally') + chalk.gray(' (step-by-step guide)'), value: 'local' },
      { name: chalk.gray('📋 View Details'), value: 'details' },
      { name: chalk.red('❌ Cancel'), value: 'cancel' }
    ]);

    if (result.action !== 'select') {
      return;
    }

    switch (result.value) {
      case 'web':
        await resolveViaWeb(session, conflictUrl);
        return;
      case 'local':
        await resolveLocally(session);
        return;
      case 'details':
        await showConflictDetails(session);
        break;
      case 'cancel':
        await cancelMerge(session);
        return;
    }
  }
}

/**
 * Resolve conflicts via web interface
 */
async function resolveViaWeb(session: ConflictSession, conflictUrl: string): Promise<void> {
  console.log(chalk.blue(`\n🔗 Opening conflict resolver in browser...`));
  console.log(chalk.gray(`URL: ${conflictUrl}\n`));

  await openUrl(conflictUrl);

  printInfo('The GitHub conflict resolver has been opened in your browser.');
  printInfo('After resolving conflicts online, you can return here to complete the merge.');

  const done = await promptConfirm('Have you resolved the conflicts on GitHub?', false);

  if (done) {
    // Check if merge is now possible
    const pr = await getPullRequestDetails(session.platform, session.prNumber);

    if (pr && pr.mergeable !== false) {
      printSuccess('✅ Conflicts appear to be resolved!');

      const mergeNow = await promptConfirm('Attempt to merge the PR now?', true);

      if (mergeNow) {
        const { mergePullRequest } = await import('../git-platform.js');
        const result = await mergePullRequest(session.platform, session.prNumber, 'merge');

        if (result.success) {
          printSuccess(`✅ PR #${session.prNumber} merged successfully!`);
          clearConflictSession(session.prNumber);
        } else {
          printError('Still unable to merge. There may be remaining conflicts.');
        }
      }
    } else {
      printWarning('Conflicts may still exist. Please check the PR in your browser.');
    }
  }
}

/**
 * Resolve conflicts locally with step-by-step guide
 */
async function resolveLocally(session: ConflictSession): Promise<void> {
  pushMenu('local-resolution');

  console.log(chalk.bold('\n📁 Local Conflict Resolution Guide\n'));

  // Step 1: Get preferred editor
  const editor = await getPreferredEditor();
  if (!editor) {
    printError('No editor selected. Cannot proceed with local resolution.');
    popMenu();
    return;
  }

  // Step 2: Checkout PR
  console.log(chalk.cyan('Step 1: Checkout the PR'));
  console.log(chalk.gray(`Command: gh pr checkout ${session.prNumber}\n`));

  const checkoutConfirm = await promptConfirm('Have you checked out the PR locally?', false);

  if (!checkoutConfirm) {
    const autoCheckout = await promptConfirm('Run checkout command automatically?', true);

    if (autoCheckout) {
      const { checkoutPullRequest } = await import('../git-platform.js');
      const result = await checkoutPullRequest(session.platform, session.prNumber);

      if (result.success) {
        printSuccess('✅ PR checked out successfully');
      } else {
        printError('Failed to checkout PR. Please run manually:');
        printInfo(`gh pr checkout ${session.prNumber}`);
      }
    }
  }

  session.lastStep = 'review';
  saveConflictSession(session);

  // Step 3: Review conflicts
  console.log(chalk.cyan('\nStep 2: Review conflicted files'));
  console.log(chalk.gray('Command: git status\n'));

  const showStatus = await promptConfirm('Show current git status?', true);

  if (showStatus) {
    const status = getGitStatus();
    console.log(chalk.gray('\n' + status + '\n'));
  }

  session.lastStep = 'edit';
  saveConflictSession(session);

  // Step 4: Open editor
  console.log(chalk.cyan('\nStep 3: Edit conflicted files'));

  if (session.conflictedFiles.length > 0) {
    console.log(chalk.gray('\nOpening files in editor...\n'));

    for (const file of session.conflictedFiles) {
      const openFile = await promptConfirm(`Open ${chalk.yellow(file)} in ${editor}?`, true);

      if (openFile) {
        await openWithEditor([file], editor);
      }
    }
  }

  // Show conflict marker explanation
  console.log(chalk.cyan('\n💡 Conflict markers look like this:'));
  console.log(chalk.gray(`
<<<<<<< HEAD
Your changes here
=======
Incoming changes from PR
>>>>>>> branch-name
`));
  console.log(chalk.gray('Edit the file to keep the code you want, then remove the markers.\n'));

  const editingDone = await promptConfirm('Have you resolved all conflicts in the files?', false);

  if (!editingDone) {
    printInfo('You can resume this session later. Run "Git PRs" again to continue.');
    popMenu();
    return;
  }

  session.lastStep = 'resolve';
  saveConflictSession(session);

  // Step 5: Mark as resolved
  console.log(chalk.cyan('\nStep 4: Mark files as resolved'));
  console.log(chalk.gray(`Command: git add ${session.conflictedFiles.join(' ')}\n`));

  const markResolved = await promptConfirm('Mark all conflicted files as resolved?', true);

  if (markResolved) {
    const success = markFilesAsResolved(session.conflictedFiles);

    if (success) {
      printSuccess('✅ Files marked as resolved');
    } else {
      printError('Failed to mark files as resolved. Please run manually:');
      printInfo(`git add ${session.conflictedFiles.join(' ')}`);
    }
  }

  session.lastStep = 'commit';
  saveConflictSession(session);

  // Step 6: Complete merge
  console.log(chalk.cyan('\nStep 5: Complete the merge'));
  console.log(chalk.gray(`Command: git commit -m "Merge PR #${session.prNumber}: ${session.prTitle}"\n`));

  const completeMerge = await promptConfirm('Complete the merge commit?', true);

  if (completeMerge) {
    const success = completeMergeCommit(session.prNumber, session.prTitle);

    if (success) {
      printSuccess('✅ Merge completed successfully!');

      // Offer to push
      await offerToPush(session);

      // Clear session
      clearConflictSession(session.prNumber);
    } else {
      printError('Failed to complete merge. Please run manually:');
      printInfo(`git commit`);
    }
  }

  popMenu();
}

/**
 * Show conflict details
 */
async function showConflictDetails(session: ConflictSession): Promise<void> {
  console.log(chalk.bold(`\n📋 Conflict Details for PR #${session.prNumber}\n`));
  console.log(`Title: ${session.prTitle}`);
  console.log(`Repository: ${session.repoOwner}/${session.repoName}`);
  console.log(`Platform: ${session.platform}`);
  console.log(`Started: ${new Date(session.startedAt).toLocaleString()}`);
  console.log(`Current Step: ${session.lastStep}\n`);

  if (session.conflictedFiles.length > 0) {
    console.log(chalk.yellow('Conflicted files:'));
    for (const file of session.conflictedFiles) {
      const status = getFileConflictStatus(file);
      const icon = status === 'conflict' ? chalk.red('✗') : status === 'resolved' ? chalk.green('✓') : chalk.gray('?');
      console.log(`  ${icon} ${file}`);
    }
    console.log();
  } else {
    console.log(chalk.gray('No conflicted files detected yet.\n'));
  }

  await promptInput('Press Enter to continue...');
}

/**
 * Cancel merge and abort
 */
async function cancelMerge(session: ConflictSession): Promise<void> {
  console.log(chalk.yellow('\n⚠️  Cancelling merge resolution...\n'));

  const confirm = await promptConfirm('Abort the merge and return to previous state?', false);

  if (confirm) {
    try {
      execSync('git merge --abort', { stdio: 'ignore' });
      printSuccess('✅ Merge aborted');
    } catch {
      printInfo('No merge to abort (already clean)');
    }

    clearConflictSession(session.prNumber);
    printInfo('Conflict resolution session cleared');
  }
}

/**
 * Get preferred editor with persistence
 */
async function getPreferredEditor(): Promise<'nano' | 'vim' | 'fresh' | null> {
  const config = await getConfig();

  // Check if we have a saved preference
  if (config.settings.preferredEditor) {
    const isInstalled = await checkEditorInstalled(config.settings.preferredEditor);
    if (isInstalled) {
      printInfo(`Using preferred editor: ${config.settings.preferredEditor}`);
      return config.settings.preferredEditor;
    }
  }

  // Filter to allowed editors only
  const allowedEditors: Array<'nano' | 'vim' | 'fresh'> = ['nano', 'vim', 'fresh'];

  // Check which editors are installed
  const installedEditors = await Promise.all(
    allowedEditors.map(async name => {
      const installed = await checkEditorInstalled(name);
      return { name, installed };
    })
  );

  const available = installedEditors.filter(e => e.installed);

  if (available.length === 0) {
    printError('No supported editors found (nano, vim, or fresh)');
    printInfo('Please install one of these editors first');
    return null;
  }

  // Prompt user to select
  const choices = available.map(e => ({
    name: `${e.name} ${chalk.gray(`(${getEditorDescription(e.name)})`)}`,
    value: e.name
  }));

  const selected = await selectFromList(
    'Select your preferred editor for conflict resolution:',
    choices
  );

  if (selected && (selected === 'nano' || selected === 'vim' || selected === 'fresh')) {
    // Save preference
    config.settings.preferredEditor = selected;
    await saveConfig(config);
    printSuccess(`Saved ${selected} as your preferred editor`);
    return selected;
  }

  return null;
}

/**
 * Get editor description
 */
function getEditorDescription(name: string): string {
  const descriptions: Record<string, string> = {
    nano: 'Simple text editor',
    vim: 'Powerful modal editor',
    fresh: 'Modern Rust-based editor'
  };
  return descriptions[name] || 'Text editor';
}

/**
 * Open files with selected editor
 */
async function openWithEditor(files: string[], editor: string): Promise<void> {
  try {
    const command = `${editor} ${files.map(f => `"${f}"`).join(' ')}`;
    await executeEditor(command);
  } catch (error) {
    printError(`Failed to open editor: ${error}`);
  }
}

/**
 * Get conflicted files from git status
 */
function getConflictedFiles(): string[] {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf-8' });
    const lines = status.split('\n');

    return lines
      .filter(line => line.startsWith('UU') || line.startsWith('AA') || line.startsWith('DD') || line.startsWith('AU') || line.startsWith('UA'))
      .map(line => line.slice(3).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Get file conflict status
 */
function getFileConflictStatus(file: string): 'conflict' | 'resolved' | 'unknown' {
  try {
    const status = execSync(`git status --porcelain "${file}"`, { encoding: 'utf-8' });
    const line = status.trim();

    if (line.startsWith('UU') || line.startsWith('AA') || line.startsWith('AU') || line.startsWith('UA')) {
      return 'conflict';
    } else if (line.startsWith('M') || line.startsWith('A') || line === '') {
      return 'resolved';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Get git status
 */
function getGitStatus(): string {
  try {
    return execSync('git status', { encoding: 'utf-8' });
  } catch {
    return 'Unable to get git status';
  }
}

/**
 * Mark files as resolved
 */
function markFilesAsResolved(files: string[]): boolean {
  try {
    execSync(`git add ${files.map(f => `"${f}"`).join(' ')}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Complete merge commit
 */
function completeMergeCommit(prNumber: number, prTitle: string): boolean {
  try {
    execSync(`git commit -m "Merge PR #${prNumber}: ${prTitle}"`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Offer to push resolved merge
 */
async function offerToPush(session: ConflictSession): Promise<void> {
  const pushNow = await promptConfirm('Push the resolved merge to remote?', true);

  if (pushNow) {
    printInfo('Pushing to remote...');

    try {
      execSync('git push', { stdio: 'inherit' });
      printSuccess('✅ Changes pushed successfully!');
    } catch (error) {
      printError('Failed to push changes');
      printInfo('You can push manually later with: git push');
    }
  } else {
    printInfo('You can push later with: git push');
  }
}
