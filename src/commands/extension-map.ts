const EXTENSION_MAPPINGS: Record<string, string[]> = {
  'typescript': ['.ts', '.tsx'],
  'ts': ['.ts', '.tsx'],
  'javascript': ['.js', '.jsx'],
  'js': ['.js', '.jsx'],
  'python': ['.py'],
  'py': ['.py'],
  'java': ['.java'],
  'html': ['.html', '.htm'],
  'htm': ['.html', '.htm'],
  'css': ['.css'],
  'scss': ['.scss'],
  'sass': ['.sass'],
  'json': ['.json'],
  'markdown': ['.md'],
  'md': ['.md'],
  'go': ['.go'],
  'golang': ['.go'],
  'rust': ['.rs'],
  'rs': ['.rs'],
  'php': ['.php'],
  'ruby': ['.rb'],
  'rb': ['.rb'],
  'c': ['.c', '.h'],
  'cpp': ['.cpp', '.hpp', '.cc', '.h'],
  'c++': ['.cpp', '.hpp', '.cc', '.h'],
  'csharp': ['.cs'],
  'c#': ['.cs'],
  'cs': ['.cs'],
  'swift': ['.swift'],
  'kotlin': ['.kt', '.kts'],
  'scala': ['.scala'],
  'r': ['.r'],
  'sql': ['.sql'],
  'yaml': ['.yaml', '.yml'],
  'yml': ['.yaml', '.yml'],
  'xml': ['.xml'],
  'dockerfile': ['Dockerfile'],
  'sh': ['.sh', '.bash'],
  'bash': ['.sh', '.bash'],
  'zsh': ['.zsh'],
  'fish': ['.fish'],
  'powershell': ['.ps1'],
  'ps1': ['.ps1'],
  'vim': ['.vim'],
  'lua': ['.lua'],
  'perl': ['.pl', '.pm'],
  'pl': ['.pl', '.pm'],
  'haskell': ['.hs'],
  'hs': ['.hs'],
  'clojure': ['.clj'],
  'clj': ['.clj'],
  'erlang': ['.erl'],
  'erl': ['.erl'],
  'elixir': ['.ex', '.exs'],
  'ex': ['.ex', '.exs'],
  'exs': ['.ex', '.exs'],
  'dart': ['.dart'],
  'flutter': ['.dart'],
  'julia': ['.jl'],
  'jl': ['.jl'],
  'matlab': ['.m'],
  'ocaml': ['.ml'],
  'ml': ['.ml'],
  'fsharp': ['.fs', '.fsx'],
  'fs': ['.fs', '.fsx'],
  'fsx': ['.fs', '.fsx'],
  'groovy': ['.groovy'],
  'gradle': ['.gradle'],
  'ini': ['.ini'],
  'toml': ['.toml'],
  'cfg': ['.cfg', '.conf', '.config'],
  'conf': ['.cfg', '.conf', '.config'],
  'config': ['.cfg', '.conf', '.config'],
  'log': ['.log'],
  'txt': ['.txt'],
  'csv': ['.csv'],
  'tsv': ['.tsv'],
  'pdf': ['.pdf'],
  'doc': ['.doc', '.docx'],
  'docx': ['.doc', '.docx'],
  'xls': ['.xls', '.xlsx'],
  'xlsx': ['.xls', '.xlsx'],
  'ppt': ['.ppt', '.pptx'],
  'pptx': ['.ppt', '.pptx'],
  'zip': ['.zip'],
  'tar': ['.tar', '.gz', '.tgz'],
  'gz': ['.gz', '.tgz'],
  'tgz': ['.gz', '.tgz'],
  'rar': ['.rar'],
  '7z': ['.7z'],
  'mp3': ['.mp3'],
  'mp4': ['.mp4'],
  'avi': ['.avi'],
  'mov': ['.mov'],
  'mkv': ['.mkv'],
  'jpg': ['.jpg', '.jpeg'],
  'jpeg': ['.jpg', '.jpeg'],
  'png': ['.png'],
  'gif': ['.gif'],
  'svg': ['.svg'],
  'ico': ['.ico'],
  'webp': ['.webp'],
  'bmp': ['.bmp'],
  'tiff': ['.tiff', '.tif'],
  'tif': ['.tiff', '.tif'],
  'wav': ['.wav'],
  'ogg': ['.ogg'],
  'flac': ['.flac'],
  'aac': ['.aac'],
  'wma': ['.wma'],
  'm4a': ['.m4a'],
  'webm': ['.webm'],
  'flv': ['.flv'],
  'wmv': ['.wmv']
};

export function detectExtensionFromQuery(query: string): string | null {
  const queryLower = query.toLowerCase();

  // Check for explicit extension mentions like ".ts", ".js", etc.
  const explicitExtensionMatch = queryLower.match(/\.(\w+)\s*(?:files?|docs?)?/);
  if (explicitExtensionMatch) {
    const ext = explicitExtensionMatch[1].toLowerCase();
    // Check if this extension exists in our mappings
    for (const [key, extensions] of Object.entries(EXTENSION_MAPPINGS)) {
      if (key === ext) {
        return extensions[0];
      }
    }
    // If not in mappings, return it as-is
    return `.${ext}`;
  }

  // Check for natural language mentions like "typescript files", "python files", etc.
  for (const [lang, extensions] of Object.entries(EXTENSION_MAPPINGS)) {
    // Match patterns like "typescript files", "typescript file", "ts files", etc.
    const pattern = new RegExp(`\\b${lang}\\s*(?:files?|docs?)?\\b`, 'i');
    if (pattern.test(queryLower)) {
      return extensions[0];
    }
  }

  return null;
}
