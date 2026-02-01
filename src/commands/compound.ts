import chalk from 'chalk';
import { getConfig, getMappings } from '../config.js';
import {
  findBestMatch,
  findBestMatchFromDatabase,
  parseCommand,
  parseUserMapping,
  replacePlaceholders,
  calculateSimilarity
} from '../matcher.js';
import { executeInteractive, formatTable, promptInput, promptConfirm, printInfo, printSuccess, printError, printWarning } from '../utils.js';
import { addToHistory } from '../history.js';
import type { CommandMapping, DatabaseCommand, DatabaseMatchResult } from '../types.js';
import { checkRiskyCommandAndConfirm } from './risk.js';

// Compound command detection patterns
const COMPOUND_SEPARATORS = [
  { pattern: /\s+and\s+/i, name: 'and' },
  { pattern: /\s+then\s+/i, name: 'then' },
  { pattern: /\s+after\s+that\s+/i, name: 'after that' },
  { pattern: /\s+followed\s+by\s+/i, name: 'followed by' },
  { pattern: /\s*;\s*/, name: ';' },
  { pattern: /\s*&&\s*/, name: '&&' },
  { pattern: /\s*&\s*/i, name: '&' }
];

interface CompoundSegment {
  input: string;
  match: CommandMapping | DatabaseMatchResult | null;
  resolvedCommand?: string;
  finalArgs?: Record<string, string>;
  success?: boolean;
  output?: string;
  error?: string;
}

interface ParsedCompoundCommand {
  segments: CompoundSegment[];
  originalInput: string;
  separatorUsed: string | null;
}

/**
 * Checks if input matches a compound command alias from user mappings
 */
export function findCompoundAliasMatch(input: string, mappings: CommandMapping[]): CommandMapping | null {
  // Look for mappings that have compound commands (contain && or ; or multiple commands)
  const compoundAliases = mappings.filter(m =>
    m.command.includes(' && ') ||
    m.command.includes(';') ||
    m.command.includes(' || ')
  );

  // Find best match among compound aliases
  for (const mapping of compoundAliases) {
    const confidence = calculateSimilarity(input.toLowerCase(), mapping.naturalLanguage.toLowerCase());
    if (confidence >= 0.8) {
      return mapping;
    }
  }

  return null;
}

/**
 * Executes a compound command alias (single natural language phrase that maps to multiple commands)
 */
export async function executeCompoundAlias(input: string, mapping: CommandMapping): Promise<void> {
  printInfo(`Executing compound alias: "${chalk.cyan(mapping.naturalLanguage)}"`);
  printInfo(`Command sequence: ${chalk.yellow(mapping.command)}`);
  if (mapping.description) {
    console.log(chalk.gray(`Description: ${mapping.description}`));
  }

  let commandToExecute = mapping.command;

  // Handle placeholders if they exist
  if (mapping.placeholders && mapping.placeholders.length > 0) {
    const parsed = parseUserMapping(input, mapping);

    // Prompt for missing required placeholders
    const finalArgs = { ...parsed.extractedArgs };
    for (const placeholder of parsed.missingPlaceholders) {
      const prompt = placeholder.description + (placeholder.defaultValue ? ` (default: ${placeholder.defaultValue})` : '');
      const value = await promptInput(prompt, placeholder.defaultValue);
      if (value || placeholder.defaultValue) {
        finalArgs[placeholder.name] = value || placeholder.defaultValue || '';
      }
    }

    // Replace placeholders in command
    commandToExecute = replacePlaceholders(mapping.command, finalArgs);
    printInfo(`Command with placeholders resolved: ${chalk.yellow(commandToExecute)}`);
  }

  if (process.env.NL_TERMINAL_CLI_DRY_RUN === '1') {
    printInfo(`[dry-run] ${commandToExecute}`);
    return;
  }

  if (process.env.NL_TERMINAL_CLI_ASSUME_YES !== '1') {
    const confirm = await promptConfirm('Execute this compound command?', true);
    if (!confirm) {
      printInfo('Cancelled');
      return;
    }
  }

  // Check for risky commands (rm, sudo, etc.) and prompt for confirmation
  const shouldProceed = await checkRiskyCommandAndConfirm(commandToExecute);
  if (!shouldProceed) {
    printInfo('Execution cancelled');
    return;
  }

  // Execute the compound command as a single command
  const config = await getConfig();
  const result = await executeInteractive(commandToExecute, config.defaultShell);

  // Add to history if saveHistory is enabled
  if (config.settings.saveHistory) {
    await addToHistory(
      mapping.naturalLanguage,
      mapping.command,
      result.success,
      result.exitCode,
      result.output,
      result.error,
      []
    );
  }

  if (result.success) {
    printSuccess('Compound command completed!');
  } else {
    printError(`Compound command failed with exit code ${result.exitCode}`);
  }
}

/**
 * Parses a compound command into individual segments
 */
export function parseCompoundCommand(input: string): ParsedCompoundCommand {
  // Find the first matching separator
  let separatorUsed: string | null = null;
  let segments: string[] = [input];

  for (const sep of COMPOUND_SEPARATORS) {
    if (sep.pattern.test(input)) {
      separatorUsed = sep.name;
      segments = input
        .split(sep.pattern)
        .map(s => s.trim())
        .filter(s => s.length > 0);
      break;
    }
  }

  // Clean up segments (remove trailing punctuation, but preserve standalone dots like in "git add .")
  segments = segments.map(s => {
    const trimmed = s.trim();
    // Only remove trailing punctuation if it's not a standalone dot preceded by a space (like "git add .")
    if (trimmed.endsWith(' .')) {
      return trimmed; // Preserve "git add ." style commands
    }
    return trimmed.replace(/[.!?;:]+$/, '').trim();
  });

  return {
    segments: segments.map(input => ({ input, match: null })),
    originalInput: input,
    separatorUsed
  };
}

/**
 * Matches each segment to a command from database or user mappings
 */
async function matchCompoundSegments(parsed: ParsedCompoundCommand): Promise<ParsedCompoundCommand> {
  const mappings = await getMappings();

  for (const segment of parsed.segments) {
    // Try database match first
    const dbMatch = await findBestMatchFromDatabase(segment.input);
    if (dbMatch && dbMatch.confidence >= 0.4) {
      segment.match = dbMatch;
    } else {
      // Fall back to user mappings
      const match = findBestMatch(segment.input, mappings);
      if (match.mapping && match.confidence >= 0.4) {
        segment.match = match.mapping;
      }
    }
  }

  return parsed;
}

/**
 * Resolves placeholders for a segment
 */
async function resolveSegmentPlaceholders(segment: CompoundSegment): Promise<CompoundSegment> {
  if (!segment.match) return segment;

  let commandTemplate: string;
  let placeholders: { name: string; description: string; required: boolean; defaultValue?: string }[] = [];
  let parsed: { command: DatabaseCommand; extractedArgs: Record<string, string>; missingPlaceholders: { name: string; description: string; required: boolean; defaultValue?: string }[] };

  if ('command' in segment.match && typeof segment.match.command === 'object') {
    // Database match
    const dbMatch = segment.match as DatabaseMatchResult;
    commandTemplate = dbMatch.command.commandTemplate;
    placeholders = dbMatch.command.placeholders;
    parsed = parseCommand(segment.input, dbMatch);
  } else {
    // User mapping
    const userMapping = segment.match as CommandMapping;
    commandTemplate = userMapping.command;
    parsed = {
      command: {
        id: 0,
        naturalLanguage: [],
        commandTemplate: userMapping.command,
        description: userMapping.description || '',
        category: 'custom',
        placeholders: [],
        createdAt: '',
        updatedAt: ''
      },
      extractedArgs: {},
      missingPlaceholders: []
    };
  }

  let finalArgs = { ...parsed.extractedArgs };

  // Handle missing required placeholders
  if (parsed.missingPlaceholders.length > 0) {
    console.log(chalk.yellow(`\n⚠️  Missing arguments for "${segment.input}":`));
    for (const placeholder of parsed.missingPlaceholders) {
      const prompt = placeholder.description + (placeholder.defaultValue ? ` (default: ${placeholder.defaultValue})` : '');
      const value = await promptInput(prompt, placeholder.defaultValue);
      if (value) {
        finalArgs[placeholder.name] = value;
      }
    }
  }

  const resolvedCommand = replacePlaceholders(commandTemplate, finalArgs);

  return {
    ...segment,
    resolvedCommand,
    finalArgs
  };
}

/**
 * Displays the parsed compound command breakdown
 */
function displayCompoundBreakdown(parsed: ParsedCompoundCommand): void {
  console.log(chalk.bold(`\n🔄 Detected ${parsed.segments.length} commands (separated by "${parsed.separatorUsed}"):\n`));

  const tableData = parsed.segments.map((segment, idx) => {
    const match = segment.match;
    let command = '❌ No match found';
    let status = chalk.red('⚠️');

    if (match) {
      if ('command' in match && typeof match.command === 'object') {
        // Database match
        const dbMatch = match as DatabaseMatchResult;
        command = dbMatch.command.commandTemplate;
        status = chalk.green('✓');
      } else {
        // User mapping
        const userMapping = match as CommandMapping;
        command = userMapping.command;
        status = chalk.green('✓');
      }
    }

    return {
      '#': idx + 1,
      'Input': segment.input,
      'Command': command,
      'Status': status
    };
  });

  console.log(formatTable(tableData));
}

/**
 * Execute a compound command (multiple commands in sequence)
 */
export async function executeCompoundCommand(input: string): Promise<void> {
  // Parse the compound command
  let parsed = parseCompoundCommand(input);

  // Match each segment
  parsed = await matchCompoundSegments(parsed);

  // Check if any segments couldn't be matched
  const unmatchedSegments = parsed.segments.filter(s => !s.match);
  if (unmatchedSegments.length > 0) {
    printError(`\n⚠️  Could not match ${unmatchedSegments.length} command(s):`);
    unmatchedSegments.forEach((s, idx) => {
      console.log(chalk.red(`  ${idx + 1}. "${s.input}"`));
    });

    const shouldContinue = await promptConfirm('Continue with matched commands anyway?', false);
    if (!shouldContinue) {
      printInfo('Cancelled compound command execution');
      return;
    }
  }

  // Display breakdown
  displayCompoundBreakdown(parsed);

  // Resolve placeholders for each segment
  const resolvedSegments: CompoundSegment[] = [];
  for (const segment of parsed.segments) {
    if (segment.match) {
      const resolved = await resolveSegmentPlaceholders(segment);
      resolvedSegments.push(resolved);
    }
  }

  // Filter out segments without matches
  const executableSegments = resolvedSegments.filter(s => s.resolvedCommand);

  if (executableSegments.length === 0) {
    printError('No executable commands found');
    return;
  }

  if (process.env.NL_TERMINAL_CLI_DRY_RUN === '1') {
    executableSegments.forEach((segment, index) => {
      if (segment.resolvedCommand) {
        printInfo(`[dry-run ${index + 1}/${executableSegments.length}] ${segment.resolvedCommand}`);
      }
    });
    return;
  }

  // Confirm execution
  if (process.env.NL_TERMINAL_CLI_ASSUME_YES !== '1') {
    const shouldExecute = await promptConfirm(`Execute ${executableSegments.length} command(s) in sequence?`, true);
    if (!shouldExecute) {
      const editOption = await promptConfirm('Would you like to edit the commands before executing?', false);
      if (editOption) {
        for (let i = 0; i < executableSegments.length; i++) {
          const segment = executableSegments[i];
          if (segment.resolvedCommand) {
            const edited = await promptInput(`Edit command ${i + 1}:`, segment.resolvedCommand);
            segment.resolvedCommand = edited;
          }
        }
      } else {
        printInfo('Cancelled');
        return;
      }
    }
  }

  // Execute each command sequentially
  const config = await getConfig();
  const results: CompoundSegment[] = [];
  let stopExecution = false;

  for (let i = 0; i < executableSegments.length; i++) {
    const segment = executableSegments[i];
    if (stopExecution || !segment.resolvedCommand) continue;

    console.log(chalk.cyan(`\n[${i + 1}/${executableSegments.length}] Executing: ${chalk.yellow(segment.resolvedCommand)}`));

    // Check for risky commands (rm, sudo, etc.) and prompt for confirmation
    const shouldProceed = await checkRiskyCommandAndConfirm(segment.resolvedCommand);
    if (!shouldProceed) {
      printInfo(`Skipping command ${i + 1}`);
      if (i < executableSegments.length - 1) {
        const continueExecution = await promptConfirm('Continue with remaining commands?', true);
        if (!continueExecution) {
          stopExecution = true;
          printInfo('Stopping execution');
        }
      }
      continue;
    }

    const result = await executeInteractive(segment.resolvedCommand, config.defaultShell);
    segment.success = result.success;
    segment.output = result.output;
    segment.error = result.error;
    results.push(segment);

    if (result.success) {
      printSuccess(`✓ Command ${i + 1} completed successfully`);
    } else {
      printError(`✗ Command ${i + 1} failed with exit code ${result.exitCode}`);
      if (result.error) {
        console.error(chalk.red(result.error));
      }

      // Ask whether to continue
      if (i < executableSegments.length - 1) {
        const continueExecution = await promptConfirm('Continue with remaining commands?', false);
        if (!continueExecution) {
          stopExecution = true;
          printInfo('Stopping execution');
        }
      }
    }
  }

  // Add each executed command to history
  if (config.settings.saveHistory) {
    for (const segment of results) {
      if (segment.resolvedCommand) {
        await addToHistory(
          segment.input,
          segment.resolvedCommand,
          segment.success ?? false,
          segment.success ? 0 : 1,
          segment.output,
          segment.error,
          []
        );
      }
    }
  }

  // Display summary
  displayExecutionSummary(results, stopExecution);
}

/**
 * Display execution summary for compound commands
 */
function displayExecutionSummary(results: CompoundSegment[], wasStopped: boolean): void {
  console.log(chalk.bold('\n📊 Execution Summary:\n'));

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  const tableData = results.map((result, idx) => {
    const status = result.success ? chalk.green('✓ Success') : chalk.red('✗ Failed');
    const command = result.resolvedCommand || 'N/A';

    return {
      '#': idx + 1,
      'Command': command.length > 40 ? command.substring(0, 37) + '...' : command,
      'Status': status
    };
  });

  console.log(formatTable(tableData));
  console.log(chalk.gray(`\nSuccessful: ${chalk.green(successful)} | Failed: ${chalk.red(failed)}`));

  if (wasStopped) {
    console.log(chalk.yellow('⚠️  Execution was stopped early'));
  }

  if (successful === results.length) {
    printSuccess('\n✅ All commands executed successfully!');
  } else if (failed > 0) {
    printWarning(`\n⚠️  ${failed} command(s) failed`);
  }
}
