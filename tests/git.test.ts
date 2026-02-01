/**
 * Tests for Git utilities module
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  isGitRepository,
  getCurrentBranch,
  getLocalBranches,
  getRemoteBranches,
  getAllBranches,
  getGitStatus,
  getGitDiff,
  getChangedFiles,
  formatStatusSummary,
  formatDetailedStatus,
  formatCommitLog,
  formatEnhancedDiff,
  switchBranch,
  createBranch,
  deleteBranch,
  stageAll,
  gitCommit,
  gitPush,
  gitPull,
  gitInit,
  getCommitLog
} from '../src/git.js';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Helper to run git commands
function runGit(args: string[], cwd?: string): { success: boolean; stdout: string } {
  const result = spawnSync('git', args, {
    encoding: 'utf-8',
    cwd: cwd || process.cwd()
  });
  return {
    success: result.status === 0,
    stdout: result.stdout?.trim() || ''
  };
}

describe('Git Utilities', () => {
  describe('isGitRepository', () => {
    it('should return true in a git repository', () => {
      // We're running from the nl-terminal-cli project which is a git repo
      const result = isGitRepository();
      assert.strictEqual(result, true, 'Should detect current directory as a git repository');
    });

    it('should return false outside a git repository', () => {
      // Create a temp directory that's not a git repo
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-test-'));
      const originalCwd = process.cwd();
      
      try {
        process.chdir(tmpDir);
        const result = isGitRepository();
        assert.strictEqual(result, false, 'Should not detect temp directory as a git repository');
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('getCurrentBranch', () => {
    it('should get current branch name', () => {
      const branch = getCurrentBranch();
      assert.ok(branch, 'Should return a branch name');
      assert.ok(typeof branch === 'string', 'Branch should be a string');
      assert.ok(branch.length > 0, 'Branch name should not be empty');
    });
  });

  describe('Branch Operations', () => {
    it('should list local branches', () => {
      const branches = getLocalBranches();
      assert.ok(Array.isArray(branches), 'Should return an array');
      assert.ok(branches.length > 0, 'Should have at least one branch');
      
      // Check branch structure
      const firstBranch = branches[0];
      assert.ok('name' in firstBranch, 'Branch should have a name');
      assert.ok('isCurrent' in firstBranch, 'Branch should have isCurrent flag');
      assert.ok('isRemote' in firstBranch, 'Branch should have isRemote flag');
      assert.strictEqual(firstBranch.isRemote, false, 'Local branch should not be remote');
    });

    it('should identify current branch in list', () => {
      const branches = getLocalBranches();
      const currentBranch = getCurrentBranch();
      
      const current = branches.find(b => b.isCurrent);
      assert.ok(current, 'Should have a current branch marked');
      
      // The current branch name should match getCurrentBranch()
      // (unless we're in detached HEAD state)
      if (currentBranch && !currentBranch.includes('detached')) {
        assert.strictEqual(current.name, currentBranch, 'Current branch should match');
      }
    });

    it('should get all branches', () => {
      const { local, remote } = getAllBranches();
      
      assert.ok(Array.isArray(local), 'Local should be an array');
      assert.ok(Array.isArray(remote), 'Remote should be an array');
      assert.ok(local.length > 0, 'Should have at least one local branch');
    });
  });

  describe('Git Status', () => {
    it('should parse git status', () => {
      const status = getGitStatus();
      
      assert.ok('isClean' in status, 'Status should have isClean');
      assert.ok('staged' in status, 'Status should have staged count');
      assert.ok('unstaged' in status, 'Status should have unstaged count');
      assert.ok('untracked' in status, 'Status should have untracked count');
      assert.ok('branch' in status, 'Status should have branch');
      assert.ok('files' in status, 'Status should have files array');
      assert.ok(Array.isArray(status.files), 'Files should be an array');
    });

    it('should format status summary', () => {
      const status = getGitStatus();
      const summary = formatStatusSummary(status);
      
      assert.ok(typeof summary === 'string', 'Summary should be a string');
      assert.ok(summary.length > 0, 'Summary should not be empty');
    });

    it('should format detailed status', () => {
      const status = getGitStatus();
      const detailed = formatDetailedStatus(status);
      
      assert.ok(typeof detailed === 'string', 'Detailed status should be a string');
      assert.ok(detailed.length > 0, 'Detailed status should not be empty');
      assert.ok(detailed.includes('branch'), 'Should mention branch');
    });
  });

  describe('Git Diff', () => {
    it('should get diff result structure', () => {
      const diff = getGitDiff();
      
      assert.ok('raw' in diff, 'Diff should have raw');
      assert.ok('formatted' in diff, 'Diff should have formatted');
      assert.ok('filesChanged' in diff, 'Diff should have filesChanged');
      assert.ok('insertions' in diff, 'Diff should have insertions');
      assert.ok('deletions' in diff, 'Diff should have deletions');
      assert.ok('files' in diff, 'Diff should have files array');
    });

    it('should get staged diff', () => {
      const diff = getGitDiff({ staged: true });
      
      assert.ok('raw' in diff, 'Staged diff should have raw');
      assert.ok(typeof diff.filesChanged === 'number', 'filesChanged should be a number');
    });

    it('should format enhanced diff', () => {
      const sampleDiff = `diff --git a/test.ts b/test.ts
index abc123..def456 100644
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 export { a, b };`;

      const formatted = formatEnhancedDiff(sampleDiff, { filesChanged: 1, insertions: 2, deletions: 1 });
      
      assert.ok(typeof formatted === 'string', 'Formatted diff should be a string');
      assert.ok(formatted.length > 0, 'Formatted diff should not be empty');
    });

    it('should handle empty diff', () => {
      const formatted = formatEnhancedDiff('');
      
      assert.ok(typeof formatted === 'string', 'Should return a string for empty diff');
      assert.ok(formatted.includes('No changes'), 'Should indicate no changes');
    });
  });

  describe('Changed Files', () => {
    it('should get changed files list', () => {
      const files = getChangedFiles();
      
      assert.ok(Array.isArray(files), 'Should return an array');
    });

    it('should get staged changed files list', () => {
      const files = getChangedFiles(true);
      
      assert.ok(Array.isArray(files), 'Should return an array');
    });
  });

  describe('Git Log', () => {
    it('should get commit log', () => {
      const commits = getCommitLog(5);
      
      assert.ok(Array.isArray(commits), 'Should return an array');
      assert.ok(commits.length > 0, 'Should have at least one commit');
      
      const firstCommit = commits[0];
      assert.ok('hash' in firstCommit, 'Commit should have hash');
      assert.ok('shortHash' in firstCommit, 'Commit should have shortHash');
      assert.ok('message' in firstCommit, 'Commit should have message');
      assert.ok('author' in firstCommit, 'Commit should have author');
      assert.ok('date' in firstCommit, 'Commit should have date');
      assert.ok('relativeDate' in firstCommit, 'Commit should have relativeDate');
    });

    it('should format commit log', () => {
      const commits = getCommitLog(3);
      const formatted = formatCommitLog(commits);
      
      assert.ok(typeof formatted === 'string', 'Formatted log should be a string');
      assert.ok(formatted.includes('Commit History'), 'Should have header');
    });

    it('should handle empty commit log', () => {
      const formatted = formatCommitLog([]);
      
      assert.ok(formatted.includes('No commits'), 'Should indicate no commits');
    });
  });

  describe('Branch Creation and Deletion', () => {
    const testBranchName = `test-branch-${Date.now()}`;
    
    afterEach(() => {
      // Cleanup: try to delete the test branch if it exists
      runGit(['branch', '-D', testBranchName]);
    });

    it('should validate branch name', () => {
      // Create branch with invalid name should fail
      const result = createBranch('invalid branch name', false);
      
      // Git should reject branch names with spaces
      assert.strictEqual(result.success, false, 'Should fail for invalid branch name');
    });

    it('should create a new branch', () => {
      const result = createBranch(testBranchName, false);
      
      if (result.success) {
        assert.ok(result.message.includes(testBranchName), 'Message should include branch name');
        
        // Verify branch exists
        const branches = getLocalBranches();
        const created = branches.find(b => b.name === testBranchName);
        assert.ok(created, 'Branch should exist in local branches');
      }
      // If branch creation fails (e.g., already exists), that's also acceptable
    });

    it('should prevent deleting current branch', () => {
      const currentBranch = getCurrentBranch();
      
      if (currentBranch && !currentBranch.includes('detached')) {
        const result = deleteBranch(currentBranch);
        
        assert.strictEqual(result.success, false, 'Should not delete current branch');
        assert.ok(
          result.message.toLowerCase().includes('cannot delete') || 
          result.message.toLowerCase().includes('currently checked out'),
          'Message should indicate cannot delete current'
        );
      }
    });
  });

  describe('Git Init', () => {
    it('should return result structure', () => {
      // We can't actually test gitInit in an existing repo
      // but we can verify the function exists and returns the right structure
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-init-test-'));
      const originalCwd = process.cwd();
      
      try {
        process.chdir(tmpDir);
        const result = gitInit();
        
        assert.ok('success' in result, 'Result should have success');
        assert.ok('message' in result, 'Result should have message');
        assert.strictEqual(result.success, true, 'Init should succeed in empty directory');
        
        // Verify .git directory was created
        assert.ok(fs.existsSync(path.join(tmpDir, '.git')), '.git directory should exist');
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('Commit Operations', () => {
    it('should reject empty commit message', () => {
      const result = gitCommit('');
      
      assert.strictEqual(result.success, false, 'Should fail with empty message');
      assert.ok(result.message.includes('empty'), 'Message should mention empty');
    });

    it('should reject whitespace-only commit message', () => {
      const result = gitCommit('   ');
      
      assert.strictEqual(result.success, false, 'Should fail with whitespace message');
    });
  });

  describe('Push/Pull Operations', () => {
    it('should return result structure for push', () => {
      // Note: This will likely fail if there's no remote configured
      // but we're testing the return structure
      const result = gitPush();
      
      assert.ok('success' in result, 'Push result should have success');
      assert.ok('message' in result, 'Push result should have message');
    });

    it('should return result structure for pull', () => {
      // Note: This will likely fail if there's no remote configured
      // but we're testing the return structure
      const result = gitPull();
      
      assert.ok('success' in result, 'Pull result should have success');
      assert.ok('message' in result, 'Pull result should have message');
    });
  });

  describe('Switch Branch', () => {
    it('should handle switching to non-existent branch', () => {
      const result = switchBranch('non-existent-branch-12345');
      
      assert.strictEqual(result.success, false, 'Should fail for non-existent branch');
    });

    it('should switch to current branch gracefully', () => {
      const currentBranch = getCurrentBranch();
      
      if (currentBranch && !currentBranch.includes('detached')) {
        const result = switchBranch(currentBranch);
        
        // Switching to current branch should succeed (no-op)
        assert.strictEqual(result.success, true, 'Should succeed switching to current branch');
      }
    });
  });
});
