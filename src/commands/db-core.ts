import { initDatabase, seedDatabase } from '../database.js';

let isDatabaseInitialized = false;

export async function ensureDatabase(): Promise<void> {
  if (!isDatabaseInitialized) {
    await initDatabase();
    await seedDatabase();
    isDatabaseInitialized = true;
  }
}
