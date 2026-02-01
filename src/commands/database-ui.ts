import chalk from 'chalk';
import { addCommand as addDbCommand, deleteCommand as deleteDbCommand, findCommandsByCategory, getAllCommands, getDatabase, seedDatabase } from '../database.js';
import type { DatabaseCommand } from '../types.js';
import { printError, printInfo, printSuccess, printWarning, promptConfirm, promptInput, selectFromList, selectFromSubmenu } from '../utils.js';
import { clearMenuStack, isAtMainMenu, popMenu, pushMenu } from './menu-stack.js';
import { ensureDatabase } from './db-core.js';

export async function browseDatabase(): Promise<void> {
  await ensureDatabase();
  pushMenu('database');

  while (true) {
    const result = await selectFromSubmenu('Database Options:', [
      { name: '📋 List all commands by category', value: 'bycategory' },
      { name: '🔍 Search commands', value: 'search' },
      { name: '⭐ Show popular commands', value: 'popular' }
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
        case 'bycategory':
          await listCommandsByCategory();
          break;
        case 'search':
          await searchDatabaseCommands();
          break;
        case 'popular':
          await showPopularCommands();
          break;
      }
      if (isAtMainMenu()) {
        return;
      }
    }
  }
}

async function listCommandsByCategory(): Promise<void> {
  pushMenu('database-category');

  while (true) {
    const categories = ['file', 'git', 'npm', 'bun', 'system', 'docker', 'database', 'network', 'text'];
    const categoryResult = await selectFromSubmenu('Select category:', [
      ...categories.map(c => ({ name: `${getCategoryIcon(c)} ${c.charAt(0).toUpperCase() + c.slice(1)}`, value: c }))
    ]);

    if (categoryResult.action === 'back' || categoryResult.action === null) {
      popMenu();
      return;
    }

    if (categoryResult.action === 'main') {
      clearMenuStack();
      return;
    }

    if (categoryResult.action === 'select' && categoryResult.value) {
      const category = categoryResult.value;
      const commands = await findCommandsByCategory(category);
      if (commands.length === 0) {
        printWarning('No commands found in this category');
        continue;
      }

      printSuccess(`Found ${commands.length} command(s) in ${category}`);
      const choices = commands.map((cmd, idx) => ({
        name: `${idx + 1}. ${chalk.cyan(cmd.naturalLanguage[0])} → ${chalk.yellow(cmd.commandTemplate)}`,
        value: cmd
      }));

      const selectedResult = await selectFromSubmenu('Select a command to view details:', choices, true, true);

      if (selectedResult.action === 'back') {
        continue; // Go back to category selection
      }

      if (selectedResult.action === 'main') {
        clearMenuStack();
        return;
      }

      if (selectedResult.action === 'select' && selectedResult.value) {
        displayCommandDetails(selectedResult.value);
      }
      if (isAtMainMenu()) {
        return;
      }
    }
  }
}

async function searchDatabaseCommands(): Promise<void> {
  const query = await promptInput('Search for commands:');
  if (!query.trim()) {
    printWarning('No search query provided');
    return;
  }

  const { searchCommands } = await import('../database.js');
  const commands = await searchCommands(query);

  if (commands.length === 0) {
    printWarning('No commands found matching your query');
    return;
  }

  printSuccess(`Found ${commands.length} command(s)`);
  const choices = commands.map((cmd, idx) => ({
    name: `${idx + 1}. [${cmd.category}] ${chalk.cyan(cmd.naturalLanguage[0])} → ${chalk.yellow(cmd.commandTemplate)}`,
    value: cmd
  }));

  const selected = await selectFromSubmenu('Select a command to view details:', choices, true, true);

  if (selected.action === 'back' || selected.action === null) {
    return;
  }

  if (selected.action === 'main') {
    clearMenuStack();
    return;
  }

  if (selected.action === 'select' && selected.value) {
    displayCommandDetails(selected.value);
  }
}

async function showPopularCommands(): Promise<void> {
  const allCommands = await getAllCommands();

  // Curated list of popular commands - a mix of file, npm, and bun
  const popularTemplates = [
    // File commands
    'mkdir {folder_name}',
    'touch {file_name}',
    'ls -la',
    'rm {file_name}',
    'cp {source} {destination}',
    'mv {source} {destination}',
    'cat {file_name}',
    // npm commands
    'npm install',
    'npm install {package_name}',
    'npm run {script_name}',
    'npm start',
    'npm test',
    'npm run build',
    // bun commands
    'bun install',
    'bun add {package_name}',
    'bun run {script_name}',
    'bun start',
    'bun test',
    'bun run build',
    'bunx {package_name}'
  ];

  // Find commands matching our curated list
  const commands = popularTemplates
    .map(template => allCommands.find(cmd => cmd.commandTemplate === template))
    .filter((cmd): cmd is DatabaseCommand => cmd !== undefined);

  const choices = commands.map((cmd, idx) => ({
    name: `${idx + 1}. ${getCategoryIcon(cmd.category)} [${cmd.category}] ${chalk.cyan(cmd.naturalLanguage[0])}`,
    value: cmd
  }));

  const selected = await selectFromSubmenu('Select a command to view details:', choices, true, true);

  if (selected.action === 'back' || selected.action === null) {
    return;
  }

  if (selected.action === 'main') {
    clearMenuStack();
    return;
  }

  if (selected.action === 'select' && selected.value) {
    displayCommandDetails(selected.value);
  }
}

function displayCommandDetails(command: DatabaseCommand): void {
  console.log(chalk.bold('\n📌 Command Details:'));
  console.log(chalk.gray(`Category: ${getCategoryIcon(command.category)} ${command.category}`));
  console.log(chalk.gray(`Template: ${chalk.yellow(command.commandTemplate)}`));
  console.log(chalk.gray(`Description: ${command.description || 'No description'}`));

  if (command.naturalLanguage.length > 0) {
    console.log(chalk.gray('\nNatural language phrases:'));
    command.naturalLanguage.forEach(phrase => {
      console.log(chalk.gray(`  • "${phrase}"`));
    });
  }

  if (command.placeholders.length > 0) {
    console.log(chalk.gray('\n📋 Placeholders:'));
    command.placeholders.forEach(ph => {
      const required = ph.required ? chalk.red('(required)') : chalk.gray('(optional)');
      const defaultVal = ph.defaultValue ? chalk.gray(` [default: ${ph.defaultValue}]`) : '';
      console.log(chalk.gray(`  {${chalk.cyan(ph.name)}} ${ph.description} ${required}${defaultVal}`));
    });
  }
}

function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    file: '📁',
    git: '⎇ ',
    npm: '📦',
    bun: '🥟',
    system: '⚙️',
    docker: '🐳',
    database: '🗄️',
    network: '🌐',
    text: '📝'
  };
  return icons[category] || '•';
}

export async function manageDatabaseCommands(): Promise<void> {
  await ensureDatabase();
  pushMenu('database-manage');

  while (true) {
    const result = await selectFromSubmenu('Database Management:', [
      { name: '➕ Add custom command', value: 'add' },
      { name: '🗑️  Delete custom command', value: 'delete' },
      { name: '📊 View database stats', value: 'stats' },
      { name: '🔄 Reset to defaults', value: 'reset' }
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
        case 'add':
          await addDatabaseCommand();
          break;
        case 'delete':
          await deleteDatabaseCommand();
          break;
        case 'stats':
          await showDatabaseStats();
          break;
        case 'reset':
          await resetDatabase();
          break;
      }
      if (isAtMainMenu()) {
        return;
      }
    }
  }
}

async function addDatabaseCommand(): Promise<void> {
  console.log(chalk.bold('\n➕ Add Custom Database Command\n'));

  const naturalLanguage = await promptInput('Natural language phrases (comma-separated):');
  if (!naturalLanguage.trim()) {
    printError('Natural language phrases are required');
    return;
  }

  const commandTemplate = await promptInput('Command template (use {placeholder} syntax):');
  if (!commandTemplate.trim()) {
    printError('Command template is required');
    return;
  }

  const description = await promptInput('Description (optional):');
  const categories = ['file', 'git', 'npm', 'bun', 'system', 'docker', 'database', 'network', 'text', 'custom'];
  const category = await selectFromList('Select category:', categories.map(c => ({ name: c, value: c })));

  if (!category) {
    printInfo('Cancelled');
    return;
  }

  // Parse placeholders
  const placeholdersText = await promptInput('Placeholders (format: name|description|required|default, comma-separated, optional):');
  const placeholders: { name: string; description: string; required: boolean; defaultValue?: string }[] = [];

  if (placeholdersText.trim()) {
    placeholdersText.split(',').forEach(p => {
      const parts = p.split('|').map(s => s.trim());
      if (parts[0]) {
        placeholders.push({
          name: parts[0],
          description: parts[1] || parts[0],
          required: parts[2] === 'true' || parts[2] === 'yes',
          defaultValue: parts[3]
        });
      }
    });
  }

  const command = await addDbCommand({
    naturalLanguage: naturalLanguage.split(',').map(s => s.trim()).filter(Boolean),
    commandTemplate: commandTemplate.trim(),
    description: description.trim() || '',
    category: category || 'custom',
    placeholders
  });

  printSuccess(`Command added with ID: ${command.id}`);
}

async function deleteDatabaseCommand(): Promise<void> {
  const commands = await getAllCommands();
  if (commands.length === 0) {
    printWarning('No commands to delete');
    return;
  }

  // Only show commands that are likely custom (high IDs typically indicate user-added)
  const customCommands = commands.filter(c => c.id > 100);
  if (customCommands.length === 0) {
    printWarning('No custom commands found to delete');
    printInfo('Built-in commands cannot be deleted');
    return;
  }

  const choices = customCommands.map((cmd, idx) => ({
    name: `${idx + 1}. [${cmd.category}] ${cmd.naturalLanguage[0]}`,
    value: cmd.id
  }));

  const idToDelete = await selectFromList('Select command to delete:', choices);
  if (idToDelete) {
    const confirm = await promptConfirm('Are you sure you want to delete this command?', false);
    if (confirm) {
      const success = await deleteDbCommand(idToDelete);
      if (success) {
        printSuccess('Command deleted');
      } else {
        printError('Failed to delete command');
      }
    }
  }
}

async function showDatabaseStats(): Promise<void> {
  const commands = await getAllCommands();
  const stats: Record<string, number> = {};
  commands.forEach(cmd => {
    stats[cmd.category] = (stats[cmd.category] || 0) + 1;
  });

  console.log(chalk.bold('\n📊 Database Statistics:'));
  console.log(chalk.gray(`Total commands: ${commands.length}`));
  console.log(chalk.gray('\nBy category:'));
  Object.entries(stats).forEach(([category, count]) => {
    console.log(chalk.gray(`  ${getCategoryIcon(category)} ${category}: ${count}`));
  });
}

async function resetDatabase(): Promise<void> {
  const confirm = await promptConfirm(chalk.red('⚠️  WARNING: This will delete all custom commands and reset to defaults. Continue?'), false);
  if (confirm) {
    const db = await getDatabase();
    db.exec('DELETE FROM commands');
    await seedDatabase();
    printSuccess('Database reset to defaults');
  }
}
