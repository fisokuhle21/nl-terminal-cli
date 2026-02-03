import chalk from 'chalk';
import { getGlob } from './lazy-modules.js';
import { getAllCommands } from './database.js';
import { findMultipleMatchesFromDatabase } from './matcher.js';
import { getMappings } from './config.js';

// Cache for commands to avoid repeated database queries
let cachedCommands: string[] | null = null;

/**
 * Get all available command phrases from database and user mappings
 */
export async function getAllCommandPhrases(): Promise<string[]> {
  if (cachedCommands) {
    return cachedCommands;
  }

  const phrases: string[] = [];

  // Get database commands
  const dbCommands = await getAllCommands();
  for (const cmd of dbCommands) {
    phrases.push(...cmd.naturalLanguage);
  }

  // Get user mappings
  const mappings = await getMappings();
  for (const mapping of mappings) {
    phrases.push(mapping.naturalLanguage);
  }

  // Remove duplicates and sort
  cachedCommands = [...new Set(phrases)].sort();
  return cachedCommands;
}

/**
 * Clear the command cache (call when mappings are updated)
 */
export function clearCommandCache(): void {
  cachedCommands = null;
}

/**
 * Source function for command autocomplete
 * Searches both database commands and user mappings
 */
export async function commandAutocompleteSource(input: string): Promise<{ name: string; value: string }[]> {
  if (!input || input.trim().length === 0) {
    // Return top suggestions when no input
    const phrases = await getAllCommandPhrases();
    return phrases.slice(0, 10).map(phrase => ({
      name: chalk.cyan(phrase),
      value: phrase
    }));
  }

  const inputLower = input.toLowerCase().trim();

  // Get fuzzy matches from database
  const dbMatches = await findMultipleMatchesFromDatabase(input, 0.1, 15);

  // Get user mappings
  const mappings = await getMappings();
  const mappingMatches = mappings
    .filter(m => m.naturalLanguage.toLowerCase().includes(inputLower))
    .slice(0, 5);

  const suggestions: { name: string; value: string; priority: number }[] = [];

  // Add database matches with scoring
  for (const match of dbMatches) {
    const phrase = match.matchedPhrase;
    const isExact = phrase.toLowerCase().startsWith(inputLower);
    const includesPhrase = phrase.toLowerCase().includes(inputLower);

    let priority = match.confidence;
    if (isExact) priority += 0.5;
    if (includesPhrase) priority += 0.3;

    suggestions.push({
      name: chalk.cyan(phrase) + chalk.gray(` → ${match.command.commandTemplate}`),
      value: phrase,
      priority
    });
  }

  // Add user mapping matches
  for (const mapping of mappingMatches) {
    const isExact = mapping.naturalLanguage.toLowerCase().startsWith(inputLower);
    suggestions.push({
      name: chalk.yellow(mapping.naturalLanguage) + chalk.gray(` [custom] → ${mapping.command}`),
      value: mapping.naturalLanguage,
      priority: isExact ? 0.9 : 0.7
    });
  }

  // Sort by priority and remove duplicates
  suggestions.sort((a, b) => b.priority - a.priority);
  const seen = new Set<string>();
  const unique = suggestions.filter(s => {
    if (seen.has(s.value.toLowerCase())) return false;
    seen.add(s.value.toLowerCase());
    return true;
  });

  // Add "Create custom command" option if no good matches
  if (unique.length === 0 || input.length > 5) {
    unique.push({
      name: chalk.green('➜ Use: ') + chalk.white(input),
      value: input,
      priority: 0.1
    });
  }

  return unique.slice(0, 10).map(({ name, value }) => ({ name, value }));
}

/**
 * Source function for file path autocomplete
 * Searches files in current directory matching the input
 */
export async function fileAutocompleteSource(input: string): Promise<{ name: string; value: string }[]> {
  if (!input || input.trim().length === 0) {
    return [];
  }

  try {
    const glob = await getGlob();

    // Extract the directory part and file pattern
    const lastSlashIndex = input.lastIndexOf('/');
    let dir = '.';
    let pattern = input;

    if (lastSlashIndex !== -1) {
      dir = input.slice(0, lastSlashIndex) || '.';
      pattern = input.slice(lastSlashIndex + 1);
    }

    // Search for matching files
    const searchPattern = pattern ? `${dir}/*${pattern}*` : `${dir}/*`;
    const files = await glob.glob(searchPattern, {
      nodir: false
    });

    // Format suggestions
    const suggestions = files.slice(0, 15).map(file => {
      const isDir = file.endsWith('/');
      const display = file.replace(/^\.\//, '');
      const icon = isDir ? '📁' : '📄';
      const coloredDisplay = isDir ? chalk.blue(display) : chalk.white(display);

      return {
        name: `${icon} ${coloredDisplay}`,
        value: display
      };
    });

    // Add option to use raw input
    if (suggestions.length === 0 || pattern.length > 0) {
      suggestions.push({
        name: chalk.green('➜ Use: ') + chalk.white(input),
        value: input
      });
    }

    return suggestions;
  } catch {
    // Fallback to empty suggestions if glob fails
    return [{
      name: chalk.green('➜ Use: ') + chalk.white(input),
      value: input
    }];
  }
}

/**
 * Detect if the input looks like a file path query
 * Returns true if input contains path indicators
 */
export function isFilePathQuery(input: string): boolean {
  const fileIndicators = [
    './', '../', '~/', '/',
    'find file', 'search file', 'locate file',
    'cat ', 'edit ', 'open ', 'view ',
    '.js', '.ts', '.json', '.md', '.txt',
    '.py', '.rb', '.php', '.html', '.css',
    'file named', 'file called'
  ];

  const inputLower = input.toLowerCase();
  return fileIndicators.some(indicator => inputLower.includes(indicator.toLowerCase()));
}

/**
 * Combined autocomplete source that intelligently chooses between command and file suggestions
 */
export async function smartAutocompleteSource(input: string): Promise<{ name: string; value: string }[]> {
  if (!input || input.trim().length === 0) {
    // Show command suggestions by default when empty
    return commandAutocompleteSource('');
  }

  // Check if this looks like a file query
  if (isFilePathQuery(input)) {
    // Extract potential file path from input
    const words = input.split(/\s+/);
    const lastWord = words[words.length - 1];

    if (lastWord.includes('/') || lastWord.startsWith('.')) {
      // Get file suggestions for the path part
      const fileSuggestions = await fileAutocompleteSource(lastWord);

      // Combine with command context
      const prefix = words.slice(0, -1).join(' ');
      return fileSuggestions.map(s => ({
        name: s.name,
        value: prefix ? `${prefix} ${s.value}` : s.value
      }));
    }
  }

  // Default to command suggestions
  return commandAutocompleteSource(input);
}
