import chalk from 'chalk';
import { promptConfirm } from '../utils.js';

/**
 * Check if a command is risky and prompt for confirmation if needed
 * Returns true if the command should proceed, false if cancelled
 */
export async function checkRiskyCommandAndConfirm(command: string): Promise<boolean> {
  if (process.env.NL_TERMINAL_CLI_ASSUME_YES === '1') {
    return true;
  }

  const isRmCommand = /(?:^|\s|;|&&|\|\|)rm\s+/i.test(command);
  const isSudoCommand = /(?:^|\s|;|&&|\|\|)sudo\s+/i.test(command);
  const isOtherRisky = /(?:^|\s)(chmod\s+777|chown\s+-R|mkfs\.|dd\s+if=|:>\s*\/|>\s*\/dev\/sda|:\(\)\s*\{\s*:\s*\|\s*:\s*;\s*\}\s*;\s*:)/i.test(command);
  const isRisky = isRmCommand || isSudoCommand || isOtherRisky;

  if (!isRisky) {
    return true;
  }

  console.log('');
  console.log(chalk.red.bold('╔════════════════════════════════════════════════════════════╗'));
  console.log(chalk.red.bold('║                       ⚠️ WARNING ⚠️                        ║ '));
  console.log(chalk.red.bold('╚════════════════════════════════════════════════════════════╝'));

  if (isRmCommand) {
    console.log(chalk.red('🗑️  This command uses ') + chalk.red.bold('rm') + chalk.red(' which permanently deletes files.'));
    console.log(chalk.red('   Deleted files cannot be recovered from the trash!'));
  }

  if (isSudoCommand) {
    console.log(chalk.red('🔐 This command uses ') + chalk.red.bold('sudo') + chalk.red(' which runs with root privileges.'));
    console.log(chalk.red('   It can modify system files and settings!'));
  }

  if (isOtherRisky) {
    console.log(chalk.red('💀 This command can cause serious damage to your system.'));
  }

  console.log('');
  console.log(chalk.yellow('Command: ') + chalk.white(command));
  console.log('');

  const shouldProceed = await promptConfirm(chalk.red.bold('Are you absolutely sure you want to run this command?'), false);
  return shouldProceed;
}
