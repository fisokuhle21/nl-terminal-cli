import chalk from 'chalk';
import { addMapping, deleteMapping, getMappings, updateMapping } from '../config.js';
import type { CommandMapping, Placeholder } from '../types.js';
import { printError, printInfo, printSuccess, printWarning, promptConfirm, promptInput, selectFromList, selectFromSubmenu } from '../utils.js';
import { clearMenuStack, isAtMainMenu, popMenu, pushMenu } from './menu-stack.js';
import { listMappings } from './mappings-ui.js';

export async function configureMappings(): Promise<void> {
  pushMenu('config');

  while (true) {
    const result = await selectFromSubmenu('Configuration Options:', [
      { name: '➕ Add new mapping', value: 'add' },
      { name: '✏️  Edit existing mapping', value: 'edit' },
      { name: '🗑️  Delete mapping', value: 'delete' },
      { name: '📋 View all mappings', value: 'view' },
      { name: '🔗 Add compound command alias', value: 'compound' }
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
          await addNewMapping();
          break;
        case 'edit':
          await editMapping();
          break;
        case 'delete':
          await deleteMappingInteractive();
          break;
        case 'view':
          await listMappings();
          break;
        case 'compound':
          await addCompoundCommandAlias();
          break;
      }
      if (isAtMainMenu()) {
        return;
      }
    }
  }
}

async function addNewMapping(): Promise<void> {
  console.log(chalk.bold('\nAdd New Command Mapping\n'));

  const naturalLanguage = await promptInput('Natural language description:');
  if (!naturalLanguage.trim()) {
    printError('Natural language description is required');
    return;
  }

  const command = await promptInput('Terminal command:');
  if (!command.trim()) {
    printError('Command is required');
    return;
  }

  const description = await promptInput('Description (optional):');
  const tagsInput = await promptInput('Tags (comma-separated, optional):');
  const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(Boolean) : [];

  const placeholdersText = await promptInput('Placeholders (format: name|description|required|default, comma-separated, optional):');
  const placeholders: Placeholder[] = [];

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

  // Preview and confirm
  console.log(chalk.bold('\n📋 Preview:\n'));
  console.log(chalk.gray(`  Natural Language: ${chalk.cyan(naturalLanguage.trim())}`));
  console.log(chalk.gray(`  Command: ${chalk.yellow(command.trim())}`));
  if (description.trim()) {
    console.log(chalk.gray(`  Description: ${description.trim()}`));
  }
  if (tags.length > 0) {
    console.log(chalk.gray(`  Tags: ${tags.join(', ')}`));
  }
  if (placeholders.length > 0) {
    console.log(chalk.gray('  Placeholders:'));
    placeholders.forEach(ph => {
      const req = ph.required ? chalk.red('(required)') : chalk.gray('(optional)');
      const def = ph.defaultValue ? chalk.gray(`[default: ${ph.defaultValue}]`) : '';
      console.log(chalk.gray(`    • {${chalk.yellow(ph.name)}} ${ph.description} ${req} ${def}`));
    });
  }

  const confirm = await selectFromList('What would you like to do?', [
    { name: chalk.green('💾 Save mapping'), value: 'save' },
    { name: chalk.yellow('📝 Edit again'), value: 'edit' }
  ]);

  if (confirm === null) {
    printInfo('Cancelled - mapping not saved');
    return;
  }

  if (confirm === 'edit') {
    // Restart the process
    await addNewMapping();
    return;
  }

  await addMapping({
    naturalLanguage: naturalLanguage.trim(),
    command: command.trim(),
    description: description.trim() || undefined,
    tags,
    placeholders: placeholders.length > 0 ? placeholders : undefined
  });
  printSuccess('Mapping saved successfully!');
}

async function editMapping(): Promise<void> {
  const mappings = await getMappings();
  if (mappings.length === 0) {
    printWarning('No mappings to edit');
    return;
  }

  const choices = mappings.map((m, idx) => ({
    name: `${idx + 1}. "${m.naturalLanguage}" → ${m.command}`,
    value: m
  }));

  const selected = await selectFromList('Select mapping to edit:', choices);
  if (!selected) {
    printInfo('Cancelled');
    return;
  }

  await editMappingWithPreview(selected);
}

async function editMappingWithPreview(selected: CommandMapping): Promise<void> {
  console.log(chalk.bold('\nEdit Mapping (press Enter to keep current value)\n'));

  const naturalLanguage = await promptInput('Natural language:', selected.naturalLanguage);
  const command = await promptInput('Command:', selected.command);
  const description = await promptInput('Description:', selected.description || '');
  const tagsInput = await promptInput('Tags (comma-separated):', selected.tags?.join(', ') || '');
  const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(Boolean) : [];

  // Handle placeholders
  let placeholders = selected.placeholders || [];
  if (placeholders.length > 0) {
    console.log(chalk.gray('\nCurrent placeholders:'));
    placeholders.forEach((ph, idx) => {
      const req = ph.required ? chalk.red('(required)') : chalk.gray('(optional)');
      const def = ph.defaultValue ? chalk.gray(`[default: ${ph.defaultValue}]`) : '';
      console.log(chalk.gray(`  ${idx + 1}. {${chalk.yellow(ph.name)}} ${ph.description} ${req} ${def}`));
    });

    const editPlaceholders = await promptConfirm('Edit placeholders?', false);
    if (editPlaceholders) {
      const currentPlaceholdersText = placeholders.map(ph =>
        `${ph.name}|${ph.description}|${ph.required}|${ph.defaultValue || ''}`
      ).join(', ');

      const placeholdersText = await promptInput('Placeholders (format: name|description|required|default, comma-separated):', currentPlaceholdersText);

      if (placeholdersText.trim()) {
        placeholders = [];
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
    }
  } else if (command.includes('{') && command.includes('}')) {
    // New command has placeholders but mapping didn't have them defined
    const addPlaceholders = await promptConfirm('Command contains {placeholders}. Add placeholder definitions?', true);
    if (addPlaceholders) {
      const placeholdersText = await promptInput('Placeholders (format: name|description|required|default, comma-separated):');
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
    }
  }

  const updatedMapping: CommandMapping = {
    ...selected,
    naturalLanguage: naturalLanguage || selected.naturalLanguage,
    command: command || selected.command,
    description: description || undefined,
    tags,
    placeholders: placeholders.length > 0 ? placeholders : undefined,
    updatedAt: new Date().toISOString()
  };

  // Preview and confirm
  console.log(chalk.bold('\n📋 Preview of Changes:\n'));
  console.log(chalk.gray(`  Natural Language: ${chalk.cyan(updatedMapping.naturalLanguage)}`));
  console.log(chalk.gray(`  Command: ${chalk.yellow(updatedMapping.command)}`));
  if (updatedMapping.description) {
    console.log(chalk.gray(`  Description: ${updatedMapping.description}`));
  }
  if (tags.length > 0) {
    console.log(chalk.gray(`  Tags: ${tags.join(', ')}`));
  }
  if (placeholders.length > 0) {
    console.log(chalk.gray('  Placeholders:'));
    placeholders.forEach(ph => {
      const req = ph.required ? chalk.red('(required)') : chalk.gray('(optional)');
      const def = ph.defaultValue ? chalk.gray(`[default: ${ph.defaultValue}]`) : '';
      console.log(chalk.gray(`    • {${chalk.yellow(ph.name)}} ${ph.description} ${req} ${def}`));
    });
  }

  const confirm = await selectFromList('What would you like to do?', [
    { name: chalk.green('💾 Save changes'), value: 'save' },
    { name: chalk.yellow('📝 Edit again'), value: 'edit' }
  ]);

  if (confirm === null) {
    printInfo('Cancelled - changes not saved');
    return;
  }

  if (confirm === 'edit') {
    // Restart the edit process with current values
    await editMappingWithPreview(updatedMapping);
    return;
  }

  await updateMapping(selected.id, {
    naturalLanguage: updatedMapping.naturalLanguage,
    command: updatedMapping.command,
    description: updatedMapping.description,
    tags: updatedMapping.tags,
    placeholders: updatedMapping.placeholders
  });
  printSuccess('Mapping updated successfully!');
}

async function deleteMappingInteractive(): Promise<void> {
  const mappings = await getMappings();
  if (mappings.length === 0) {
    printWarning('No mappings to delete');
    return;
  }

  const choices = mappings.map((m, idx) => ({
    name: `${idx + 1}. "${m.naturalLanguage}" → ${m.command}`,
    value: m
  }));

  const selected = await selectFromList('Select mapping to delete:', choices);
  if (!selected) {
    printInfo('Cancelled');
    return;
  }

  const confirm = await promptConfirm(`Are you sure you want to delete "${selected.naturalLanguage}"?`, false);
  if (confirm) {
    await deleteMapping(selected.id);
  } else {
    printInfo('Deletion cancelled');
  }
}

/**
 * Add a compound command alias (sequence of commands as a single natural language phrase)
 */
async function addCompoundCommandAlias(): Promise<void> {
  console.log(chalk.bold('\n🔗 Add Compound Command Alias\n'));
  console.log(chalk.gray('Create a natural language shortcut for multiple commands.\n'));
  console.log(chalk.gray('Examples:'));
  console.log(chalk.gray('  - "deploy" → git add . && git commit -m "update" && git push'));
  console.log(chalk.gray('  - "fresh start" → npm ci && npm start'));
  console.log(chalk.gray('  - "update all" → git pull && npm install\n'));

  await addCompoundCommandWithPreview();
}

interface CompoundCommandPreview {
  naturalLanguage?: string;
  commands?: string[];
}

async function addCompoundCommandWithPreview(initialValues?: CompoundCommandPreview): Promise<void> {
  const naturalLanguage = await promptInput('Natural language phrase (e.g., "deploy", "update all"):', initialValues?.naturalLanguage);
  if (!naturalLanguage.trim()) {
    printError('Natural language phrase is required');
    return;
  }

  const commands: string[] = initialValues?.commands ? [...initialValues.commands] : [];
  let addMore = true;

  console.log(chalk.cyan('\nEnter the commands to execute in sequence:\n'));
  while (addMore) {
    const command = await promptInput(`Command ${commands.length + 1}:`);
    if (command.trim()) {
      commands.push(command.trim());
    }

    if (commands.length > 0) {
      addMore = await promptConfirm('Add another command?', false);
    } else if (!command.trim()) {
      printWarning('At least one command is required');
      return;
    }
  }

  if (commands.length === 0) {
    printWarning('No commands provided');
    return;
  }

  // Join commands with && for sequential execution
  const compoundCommand = commands.join(' && ');
  const description = await promptInput('Description (optional):');
  const tagsInput = await promptInput('Tags (comma-separated, optional):');
  const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(Boolean) : ['compound', 'alias'];

  const placeholdersText = await promptInput('Placeholders (format: name|description|required|default, comma-separated, optional):');
  const placeholders: Placeholder[] = [];

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

  // Preview and confirm
  console.log(chalk.bold('\n📋 Preview:\n'));
  console.log(chalk.gray(`  Natural Language: ${chalk.cyan(naturalLanguage.trim())}`));
  console.log(chalk.gray('  Command Sequence:'));
  commands.forEach((cmd, idx) => {
    console.log(chalk.gray(`    ${idx + 1}. ${chalk.yellow(cmd)}`));
  });
  console.log(chalk.gray(`  Full Command: ${chalk.yellow(compoundCommand)}`));
  if (description.trim()) {
    console.log(chalk.gray(`  Description: ${description.trim()}`));
  }
  if (tags.length > 0) {
    console.log(chalk.gray(`  Tags: ${tags.join(', ')}`));
  }
  if (placeholders.length > 0) {
    console.log(chalk.gray('  Placeholders:'));
    placeholders.forEach(ph => {
      const req = ph.required ? chalk.red('(required)') : chalk.gray('(optional)');
      const def = ph.defaultValue ? chalk.gray(`[default: ${ph.defaultValue}]`) : '';
      console.log(chalk.gray(`    • {${chalk.yellow(ph.name)}} ${ph.description} ${req} ${def}`));
    });
  }

  const confirm = await selectFromList('What would you like to do?', [
    { name: chalk.green('💾 Save mapping'), value: 'save' },
    { name: chalk.yellow('📝 Edit again'), value: 'edit' }
  ]);

  if (confirm === null) {
    printInfo('Cancelled - compound command not saved');
    return;
  }

  if (confirm === 'edit') {
    // Restart the process with current values
    await addCompoundCommandWithPreview({ naturalLanguage, commands });
    return;
  }

  await addMapping({
    naturalLanguage: naturalLanguage.trim(),
    command: compoundCommand,
    description: description.trim() || `Compound command: ${commands.length} step(s)`,
    tags,
    placeholders: placeholders.length > 0 ? placeholders : undefined
  });
  printSuccess(`Compound command alias "${naturalLanguage}" saved successfully!`);
}
