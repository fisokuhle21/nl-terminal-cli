import chalk from 'chalk';
import { getConfig } from '../config.js';
import { addToHistory } from '../history.js';
import { executeInTerminal, formatCommandOutput, printError, printInfo, printSuccess, promptConfirm } from '../utils.js';
import { checkRiskyCommandAndConfirm } from './risk.js';

export async function executeWithConfirmation(command: string, naturalLanguage?: string): Promise<void> {
  const config = await getConfig();

  if (process.env.NL_TERMINAL_CLI_DRY_RUN === '1') {
    printInfo(`[dry-run] ${command}`);
    return;
  }

  if (config.settings.confirmBeforeExecute && process.env.NL_TERMINAL_CLI_ASSUME_YES !== '1') {
    const shouldExecute = await promptConfirm(`Execute: ${chalk.yellow(command)}?`);
    if (!shouldExecute) {
      printInfo('Execution cancelled');
      return;
    }
  }

  // Extra warning and confirmation for dangerous commands (rm, sudo, etc.)
  const shouldProceed = await checkRiskyCommandAndConfirm(command);
  if (!shouldProceed) {
    printInfo('Execution cancelled');
    return;
  }

  const result = await executeInTerminal(command, config.defaultShell);

  // Add to history if saveHistory is enabled
  if (config.settings.saveHistory) {
    await addToHistory(
      naturalLanguage || command,
      command,
      result.success,
      result.exitCode,
      result.output,
      result.error,
      []
    );
  }

  if (result.success) {
    if (result.output) {
      // Apply same formatting as executeInteractive for ls commands
      const formattedOutput = formatCommandOutput(command, result.output);
      console.log(formattedOutput);
    }
    printSuccess('Command executed successfully');
  } else {
    printError(`Command failed with exit code ${result.exitCode}`);
    if (result.error) {
      console.error(chalk.red(result.error));
    }
  }
}
