export interface CommandMapping {
  id: string;
  naturalLanguage: string;
  command: string;
  description?: string;
  tags?: string[];
  placeholders?: Placeholder[];
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseCommand {
  id: number;
  naturalLanguage: string[];
  commandTemplate: string;
  description: string;
  category: string;
  placeholders: Placeholder[];
  createdAt: string;
  updatedAt: string;
}

export interface Placeholder {
  name: string;
  description: string;
  required: boolean;
  defaultValue?: string;
}

export interface ParsedCommand {
  command: DatabaseCommand;
  extractedArgs: Record<string, string>;
  missingPlaceholders: Placeholder[];
}

export interface ParsedUserMapping {
  mapping: CommandMapping;
  extractedArgs: Record<string, string>;
  missingPlaceholders: Placeholder[];
}

export interface Config {
  schemaVersion: number;
  version: string;
  defaultShell: string;
  mappings: CommandMapping[];
  menuStyle: 'expand' | 'list';
  settings: {
    confirmBeforeExecute: boolean;
    saveHistory: boolean;
    fuzzyMatchThreshold: number;
    maxResults: number;
  };
}

export interface MatchResult {
  mapping: CommandMapping | null;
  confidence: number;
  isExactMatch: boolean;
}

export interface DatabaseMatchResult {
  command: DatabaseCommand;
  confidence: number;
  isExactMatch: boolean;
  matchedPhrase: string;
}

export interface SearchOptions {
  extension?: string;
  directory?: string;
  maxResults?: number;
  caseSensitive?: boolean;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
}
