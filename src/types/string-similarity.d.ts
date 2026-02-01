declare module 'string-similarity' {
  export interface BestMatch {
    target: string;
    rating: number;
  }

  export interface BestMatchResult {
    ratings: Array<{ target: string; rating: number }>;
    bestMatch: BestMatch;
    bestMatchIndex: number;
  }

  export function findBestMatch(mainString: string, targetStrings: string[]): BestMatchResult;
  export function compareTwoStrings(first: string, second: string): number;
}
