import { findBestMatch as stringBestMatch } from 'string-similarity';
import type { CommandMapping, MatchResult, DatabaseCommand, DatabaseMatchResult, ParsedCommand, ParsedUserMapping, Placeholder } from './types.js';
import { getAllCommands } from './database.js';
import * as shellQuote from 'shell-quote';

export function findBestMatch(input: string, mappings: CommandMapping[]): MatchResult {
  if (mappings.length === 0) {
    return {
      mapping: null,
      confidence: 0,
      isExactMatch: false
    };
  }
  
  const exactMatch = mappings.find(m => 
    m.naturalLanguage.toLowerCase().trim() === input.toLowerCase().trim()
  );
  
  if (exactMatch) {
    return {
      mapping: exactMatch,
      confidence: 1,
      isExactMatch: true
    };
  }
  
  const naturalLanguageStrings = mappings.map(m => m.naturalLanguage);
  const matchResult = stringBestMatch(input, naturalLanguageStrings);
  
  if (matchResult.bestMatch && matchResult.bestMatch.rating > 0) {
    const bestMatch = mappings.find(m => m.naturalLanguage === matchResult.bestMatch.target);
    
    if (bestMatch) {
      return {
        mapping: bestMatch,
        confidence: matchResult.bestMatch.rating,
        isExactMatch: false
      };
    }
  }
  
  let bestAlternativeMatch: CommandMapping | null = null;
  let bestAlternativeScore = 0;
  
  for (const mapping of mappings) {
    let score = 0;
    
    if (mapping.tags) {
      for (const tag of mapping.tags) {
        const tagMatch = stringBestMatch(input, [tag]);
        if (tagMatch.bestMatch.rating > 0.7) {
          score = Math.max(score, tagMatch.bestMatch.rating * 0.8);
        }
      }
    }
    
    if (mapping.description) {
      const descMatch = stringBestMatch(input, [mapping.description]);
      if (descMatch.bestMatch.rating > 0.7) {
        score = Math.max(score, descMatch.bestMatch.rating * 0.7);
      }
    }
    
    const cmdMatch = stringBestMatch(input, [mapping.command]);
    if (cmdMatch.bestMatch.rating > 0.8) {
      score = Math.max(score, cmdMatch.bestMatch.rating * 0.9);
    }
    
    if (score > bestAlternativeScore) {
      bestAlternativeScore = score;
      bestAlternativeMatch = mapping;
    }
  }
  
  if (bestAlternativeMatch && bestAlternativeScore > 0.4) {
    return {
      mapping: bestAlternativeMatch,
      confidence: bestAlternativeScore,
      isExactMatch: false
    };
  }
  
  return {
    mapping: null,
    confidence: 0,
    isExactMatch: false
  };
}

export function calculateConfidenceScore(input: string, mapping: CommandMapping): number {
  const mainMatch = stringBestMatch(input, [mapping.naturalLanguage]);
  let score = mainMatch.bestMatch.rating;
  
  const inputWords = input.toLowerCase().split(/\s+/);
  const mappingWords = mapping.naturalLanguage.toLowerCase().split(/\s+/);
  
  let wordMatchCount = 0;
  for (const inputWord of inputWords) {
    if (mappingWords.some(mw => mw.includes(inputWord) || inputWord.includes(mw))) {
      wordMatchCount++;
    }
  }
  
  const wordMatchRatio = wordMatchCount / Math.max(inputWords.length, mappingWords.length);
  score = Math.max(score, wordMatchRatio * 0.9);
  
  return Math.min(score, 1);
}

export function findMultipleMatches(input: string, mappings: CommandMapping[], threshold = 0.3, maxResults = 5): MatchResult[] {
  const results: MatchResult[] = [];
  
  for (const mapping of mappings) {
    const confidence = calculateConfidenceScore(input, mapping);
    
    if (confidence >= threshold) {
      results.push({
        mapping,
        confidence,
        isExactMatch: confidence === 1
      });
    }
  }
  
  results.sort((a, b) => b.confidence - a.confidence);
  
  return results.slice(0, maxResults);
}

// Database-based matching functions
export function findBestDatabaseMatch(input: string, commands: DatabaseCommand[]): DatabaseMatchResult | null {
  if (commands.length === 0) {
    return null;
  }
  
  const inputLower = input.toLowerCase().trim();
  
  // Check for exact phrase matches first
  for (const command of commands) {
    for (const phrase of command.naturalLanguage) {
      if (inputLower === phrase.toLowerCase().trim()) {
        return {
          command,
          confidence: 1,
          isExactMatch: true,
          matchedPhrase: phrase
        };
      }
    }
  }
  
  // Check for phrase inclusion (e.g., "create a folder called" in "create a folder called my-project")
  for (const command of commands) {
    for (const phrase of command.naturalLanguage) {
      const phraseLower = phrase.toLowerCase().trim();
      if (inputLower.startsWith(phraseLower) || inputLower.includes(phraseLower)) {
        return {
          command,
          confidence: 0.95,
          isExactMatch: false,
          matchedPhrase: phrase
        };
      }
    }
  }
  
  // Use string similarity for fuzzy matching
  let bestMatch: DatabaseCommand | null = null;
  let bestPhrase = '';
  let bestScore = 0;
  
  for (const command of commands) {
    for (const phrase of command.naturalLanguage) {
      const matchResult = stringBestMatch(inputLower, [phrase.toLowerCase()]);
      if (matchResult.bestMatch.rating > bestScore) {
        bestScore = matchResult.bestMatch.rating;
        bestMatch = command;
        bestPhrase = phrase;
      }
    }
  }
  
  if (bestMatch && bestScore > 0.4) {
    return {
      command: bestMatch,
      confidence: bestScore,
      isExactMatch: false,
      matchedPhrase: bestPhrase
    };
  }
  
  return null;
}

export function findMultipleDatabaseMatches(input: string, commands: DatabaseCommand[], threshold = 0.3, maxResults = 5): DatabaseMatchResult[] {
  const results: DatabaseMatchResult[] = [];
  const inputLower = input.toLowerCase().trim();
  
  for (const command of commands) {
    let bestScore = 0;
    let bestPhrase = '';
    
    for (const phrase of command.naturalLanguage) {
      // Exact match
      if (inputLower === phrase.toLowerCase().trim()) {
        bestScore = 1;
        bestPhrase = phrase;
        break;
      }
      
      // Inclusion match
      if (inputLower.includes(phrase.toLowerCase().trim())) {
        bestScore = Math.max(bestScore, 0.9);
        bestPhrase = phrase;
      }
      
      // Similarity match
      const matchResult = stringBestMatch(inputLower, [phrase.toLowerCase()]);
      if (matchResult.bestMatch.rating > bestScore) {
        bestScore = matchResult.bestMatch.rating;
        bestPhrase = phrase;
      }
    }
    
    if (bestScore >= threshold) {
      results.push({
        command,
        confidence: bestScore,
        isExactMatch: bestScore === 1,
        matchedPhrase: bestPhrase
      });
    }
  }
  
  results.sort((a, b) => b.confidence - a.confidence);
  return results.slice(0, maxResults);
}

export function extractArguments(input: string, matchedPhrase: string, placeholders: Placeholder[]): Record<string, string> {
  const args: Record<string, string> = {};
  
  // Remove the matched phrase from input to get the argument part
  let remainingInput = input.toLowerCase();
  const phraseLower = matchedPhrase.toLowerCase();
  
  // Find and remove the matched phrase
  const phraseIndex = remainingInput.indexOf(phraseLower);
  if (phraseIndex !== -1) {
    remainingInput = remainingInput.slice(phraseIndex + phraseLower.length).trim();
  }
  
  // Get original case version of remaining input
  const originalRemaining = input.slice(phraseIndex + phraseLower.length).trim();
  
  // Common patterns for extraction
  const patterns = [
    // Quoted strings - "X" or 'X' - extract just the content inside quotes
    { regex: /^["']([^"']+)["']$/i, group: 1 },
    // "called X", "named X", "to X" - check for quoted string after
    { regex: /(?:called|named|to)\s+["']?([^"']+)["']?$/i, group: 1 },
    // "X and Y"
    { regex: /(.+?)\s+and\s+(.+)$/i, groups: [1, 2] },
    // "from X to Y"
    { regex: /(?:from|source)\s+(.+?)\s+(?:to|destination)\s+(.+)$/i, groups: [1, 2] },
    // "for X" - check for quoted string
    { regex: /(?:for)\s+["']?([^"']+)["']?$/i, group: 1 },
    // "with X" - check for quoted string or just the value
    { regex: /(?:with)\s+(?:[a-z\s]+\s+)?["']?([^"']+)["']?$/i, group: 1 },
    // "at X"
    { regex: /(?:at|in)\s+["']?([^"']+)["']?$/i, group: 1 },
    // Just the remaining text as the first argument
    { regex: /^["']?([^"']+)["']?$/i, group: 1 }
  ];
  
  // Try to extract based on placeholder count and patterns
  if (placeholders.length === 1) {
    // Single placeholder - use the entire remaining input
    for (const pattern of patterns) {
      const match = remainingInput.match(pattern.regex);
      if (match) {
        args[placeholders[0].name] = match[pattern.group as number].trim();
        break;
      }
    }
  } else if (placeholders.length >= 2) {
    // Multiple placeholders - try to split intelligently
    for (const pattern of patterns) {
      if ('groups' in pattern && pattern.groups) {
        const match = remainingInput.match(pattern.regex);
        if (match) {
          pattern.groups.forEach((groupIdx, idx) => {
            if (placeholders[idx]) {
              args[placeholders[idx].name] = match[groupIdx].trim();
            }
          });
          break;
        }
      }
    }
    
    // If no pattern matched, try splitting by common separators
    if (Object.keys(args).length === 0) {
      const parts = remainingInput.split(/\s+(?:and|to|into)\s+/i);
      placeholders.forEach((placeholder, idx) => {
        if (parts[idx]) {
          args[placeholder.name] = parts[idx].trim();
        }
      });
    }
  }
  
  return args;
}

export function replacePlaceholders(template: string, args: Record<string, string>): string {
  let result = template;
  
  for (const [key, value] of Object.entries(args)) {
    const placeholder = `{${key}}`;
    // Escape shell metacharacters to prevent command injection
    const escapedValue = shellQuote.quote([value]);
    result = result.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), escapedValue);
  }
  
  return result;
}

export function parseCommand(input: string, match: DatabaseMatchResult): ParsedCommand {
  const extractedArgs = extractArguments(input, match.matchedPhrase, match.command.placeholders);
  
  const missingPlaceholders = match.command.placeholders.filter(p => {
    if (!p.required) return false;
    const value = extractedArgs[p.name];
    return !value || value.trim() === '';
  });
  
  return {
    command: match.command,
    extractedArgs,
    missingPlaceholders
  };
}

export function parseUserMapping(input: string, mapping: CommandMapping): ParsedUserMapping {
  const extractedArgs = extractArguments(input, mapping.naturalLanguage, mapping.placeholders || []);
  
  const missingPlaceholders = (mapping.placeholders || []).filter(p => {
    if (!p.required) return false;
    const value = extractedArgs[p.name];
    return !value || value.trim() === '';
  });
  
  return {
    mapping,
    extractedArgs,
    missingPlaceholders
  };
}

export async function findBestMatchFromDatabase(input: string): Promise<DatabaseMatchResult | null> {
  const commands = await getAllCommands();
  return findBestDatabaseMatch(input, commands);
}

export async function findMultipleMatchesFromDatabase(input: string, threshold = 0.3, maxResults = 5): Promise<DatabaseMatchResult[]> {
  const commands = await getAllCommands();
  return findMultipleDatabaseMatches(input, commands, threshold, maxResults);
}

/**
 * Calculate similarity between two strings (0-1)
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const matchResult = stringBestMatch(str1, [str2]);
  return matchResult.bestMatch.rating;
}

/**
 * Detect if input contains compound command separators
 */
export function detectCompoundCommand(input: string): { isCompound: boolean; separator: string | null } {
  const COMPOUND_SEPARATORS = [
    { pattern: /\s+and\s+/i, name: 'and' },
    { pattern: /\s+then\s+/i, name: 'then' },
    { pattern: /\s+after\s+that\s+/i, name: 'after that' },
    { pattern: /\s+followed\s+by\s+/i, name: 'followed by' },
    { pattern: /\s*;\s*/, name: ';' },
    { pattern: /\s*&&\s*/, name: '&&' },
    { pattern: /\s*&\s*/i, name: '&' }
  ];

  for (const sep of COMPOUND_SEPARATORS) {
    if (sep.pattern.test(input)) {
      return { isCompound: true, separator: sep.name };
    }
  }

  return { isCompound: false, separator: null };
}
