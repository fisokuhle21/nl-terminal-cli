/**
 * Lazy loading utilities for heavy modules
 * This module provides lazy-loaded versions of inquirer, ora, and glob
 * to reduce startup time and memory usage for simple operations
 */

// Type definitions for lazy-loaded modules
type InquirerModule = typeof import('inquirer');
type OraModule = typeof import('ora');
type ChalkModule = typeof import('chalk');
type GlobModule = typeof import('glob');

// Cached module references
let _inquirer: InquirerModule | null = null;
let _ora: OraModule | null = null;
let _chalk: ChalkModule | null = null;
let _glob: GlobModule | null = null;

/**
 * Lazy load inquirer (saves ~5MB on startup)
 * Only loaded when interactive prompts are needed
 */
export async function getInquirer(): Promise<InquirerModule> {
  if (!_inquirer) {
    _inquirer = await import('inquirer');
  }
  return _inquirer;
}

/**
 * Lazy load ora spinner (saves ~0.5MB on startup)
 * Only loaded when spinners are needed
 */
export async function getOra(): Promise<OraModule> {
  if (!_ora) {
    _ora = await import('ora');
  }
  return _ora;
}

/**
 * Lazy load glob (saves ~0.5MB on startup)
 * Only loaded when file search is needed
 */
export async function getGlob(): Promise<GlobModule> {
  if (!_glob) {
    _glob = await import('glob');
  }
  return _glob;
}

/**
 * Get chalk - loaded synchronously as it's lightweight and used everywhere
 * Chalk is cached but loaded on first use
 */
export function getChalk(): ChalkModule {
  if (!_chalk) {
    // Use require for synchronous loading - chalk is lightweight
    _chalk = require('chalk') as ChalkModule;
  }
  return _chalk as ChalkModule;
}

/**
 * Preload heavy modules in background after startup
 * Call this after initial CLI parsing to warm up the cache
 */
export function preloadModules(): void {
  // Start loading in background without blocking
  setTimeout(() => {
    getInquirer().catch(() => {});
    getOra().catch(() => {});
  }, 0);
}

/**
 * Check if modules are already loaded
 */
export function isInquirerLoaded(): boolean {
  return _inquirer !== null;
}

export function isOraLoaded(): boolean {
  return _ora !== null;
}

export function isGlobLoaded(): boolean {
  return _glob !== null;
}
