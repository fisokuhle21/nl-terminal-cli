#!/usr/bin/env node

/**
 * Database Seed Script
 * 
 * This script initializes the SQLite database and populates it with
 * the default set of terminal commands. It can be run manually or
 * will be automatically called on first run.
 */

import { initDatabase, seedDatabase, getAllCommands, closeDatabase } from '../src/database.js';
import chalk from 'chalk';

console.log(chalk.cyan('🌱 NL Terminal Database Seeder\n'));

try {
  // Initialize the database
  console.log(chalk.gray('Initializing database...'));
  await initDatabase();
  
  // Seed with default commands
  console.log(chalk.gray('Seeding database with default commands...'));
  await seedDatabase();
  
  // Verify the seeding
  const commands = await getAllCommands();
  
  // Count by category
  const categories: Record<string, number> = {};
  commands.forEach(cmd => {
    categories[cmd.category] = (categories[cmd.category] || 0) + 1;
  });
  
  console.log(chalk.green(`\n✓ Successfully seeded database with ${commands.length} commands!\n`));
  
  console.log(chalk.bold('Commands by category:'));
  Object.entries(categories).forEach(([category, count]) => {
    const icons: Record<string, string> = {
      file: '📁',
      git: '🌿',
      npm: '📦',
      bun: '🥟',
      system: '⚙️',
      docker: '🐳',
      database: '🗄️',
      network: '🌐',
      text: '📝'
    };
    console.log(`  ${icons[category] || '•'} ${category.padEnd(12)} ${chalk.cyan(count.toString())} commands`);
  });
  
  console.log(chalk.gray(`\nDatabase location: ~/.nl-terminal-cli/commands.db`));
  console.log(chalk.gray('You can now use the nl-terminal CLI with full database support!'));
  
  await closeDatabase();
  process.exit(0);
} catch (error) {
  console.error(chalk.red(`\n✗ Error seeding database: ${error}`));
  process.exit(1);
}
