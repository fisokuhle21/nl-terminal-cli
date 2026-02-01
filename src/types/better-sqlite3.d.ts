declare module 'better-sqlite3' {
  export default class Database {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...args: any[]): { lastInsertRowid: number | bigint; changes: number };
      get(...args: any[]): any;
      all(...args: any[]): any[];
    };
    pragma(pragma: string): any;
    close(): void;
  }
}
