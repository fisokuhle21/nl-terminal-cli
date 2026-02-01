// Type declarations for bun:sqlite module
// This allows TypeScript to compile when using dynamic imports

declare module 'bun:sqlite' {
  export class Database {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...args: any[]): { lastInsertRowid: number | bigint; changes: number };
      get(...args: any[]): any;
      all(...args: any[]): any[];
    };
    close(): void;
  }
}
