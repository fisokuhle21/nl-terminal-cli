import chalk from 'chalk';
import { getAllCommands } from '../database.js';
import { getMappings } from '../config.js';
import type { DatabaseCommand } from '../types.js';
import { formatTable, printError, printInfo, printSuccess, printWarning, selectFromSubmenu } from '../utils.js';
import { clearMenuStack, popMenu, pushMenu } from './menu-stack.js';
import { ensureDatabase } from './db-core.js';

export async function listMappings(): Promise<void> {
  pushMenu('view-mappings');

  try {
    // Get config mappings
    const configMappings = await getMappings();

    // Get database commands
    await ensureDatabase();
    const dbCommands = await getAllCommands();

    const totalConfig = configMappings.length;
    const totalDb = dbCommands.length;
    const total = totalConfig + totalDb;

    if (total === 0) {
      printWarning('No command mappings found');
      printInfo('Use "configure" to add mappings');
      popMenu();
      return;
    }

    printSuccess(`Found ${total} total command mappings:`);
    console.log(chalk.gray(`  • ${totalConfig} custom mappings (from config)`));
    console.log(chalk.gray(`  • ${totalDb} built-in commands`));

    // Show config mappings if any
    if (totalConfig > 0) {
      console.log(chalk.bold('\n📋 Custom Mappings (Config):\n'));
      const configTableData = configMappings.map((m, idx) => ({
        '#': idx + 1,
        'Natural Language': m.naturalLanguage,
        'Command': m.command,
        'Description': m.description || '-',
        'Tags': m.tags?.join(', ') || '-'
      }));
      console.log(formatTable(configTableData));
    }

    // Show database commands if any
    if (totalDb > 0) {
      console.log(chalk.bold('\n🗄️  Built-in Commands:\n'));
      // Group by category
      const byCategory: Record<string, DatabaseCommand[]> = {};
      dbCommands.forEach(cmd => {
        if (!byCategory[cmd.category]) {
          byCategory[cmd.category] = [];
        }
        byCategory[cmd.category].push(cmd);
      });

      // Show summary by category
      for (const [category, commands] of Object.entries(byCategory)) {
        console.log(chalk.cyan(`  ${category}:`) + chalk.gray(` ${commands.length} commands`));
      }
      console.log(chalk.gray('\n  (Use "Built-in commands" option to view all details)'));
    }

    // Show navigation options
    const result = await selectFromSubmenu('', [], true, true);

    if (result.action === 'back' || result.action === null) {
      popMenu();
      return;
    }

    if (result.action === 'main') {
      clearMenuStack();
      return;
    }
  } catch (error) {
    printError(`Error listing mappings: ${error}`);
    popMenu();
    throw error;
  }
}
