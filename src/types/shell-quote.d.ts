declare module 'shell-quote' {
  export function quote(args: string[]): string;
  export function parse(command: string): string[];
}
