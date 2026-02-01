declare module 'glob' {
  export function glob(pattern: string, options?: {
    cwd?: string;
    nodir?: boolean;
    ignore?: string | string[];
  }): Promise<string[]>;
}
