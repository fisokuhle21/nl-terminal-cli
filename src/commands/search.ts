import chalk from 'chalk';
import path from 'path';
import fs from 'fs/promises';
import { getOra, getGlob } from '../lazy-modules.js';
import { checkEditorInstalled, executeEditor, formatTable, printError, printInfo, printSuccess, printWarning, promptConfirm, promptInput, promptInputWithAutocomplete, selectFromList } from '../utils.js';
import { getConfig } from '../config.js';
import type { SearchOptions } from '../types.js';
import { detectExtensionFromQuery } from './extension-map.js';

export async function searchFiles(query?: string, options?: SearchOptions): Promise<void> {
  try {
    let searchQuery: string;
    if (query) {
      searchQuery = query;
    } else {
      // Check if autocomplete is enabled in config
      const config = await getConfig();
      const useAutocomplete = config.settings.enableAutocomplete !== false;
      
      if (useAutocomplete) {
        const result = await promptInputWithAutocomplete('Search for files:', undefined, 'files');
        // Handle ESC cancellation (returns { cancelled: true })
        if (typeof result === 'object' && result !== null && 'cancelled' in result && result.cancelled === true) {
          return;
        }
        searchQuery = result as string;
      } else {
        const result = await promptInput('Search for files:');
        if (result === null) {
          return;
        }
        searchQuery = result;
      }
    }

    if (!searchQuery.trim()) {
      printWarning('No search query provided');
      return;
    }

    // Lazy load ora and glob
    const oraModule = await getOra();
    const globModule = await getGlob();
    const spinner = oraModule.default('Searching files...').start();
    const searchDir = options?.directory || process.cwd();
    let extension = options?.extension;
    const maxResults = options?.maxResults || 20;

    // Detect extension from natural language query if not provided via options
    let detectedExtension: string | null = null;
    if (!extension) {
      detectedExtension = detectExtensionFromQuery(searchQuery);
      if (detectedExtension) {
        extension = detectedExtension;
      }
    }

    let pattern = '**/*';
    if (extension) {
      pattern = extension.startsWith('.')
        ? `**/*${extension}`
        : `**/*.${extension}`;
    }

    if (searchQuery.includes('*') || searchQuery.includes('?')) {
      pattern = searchQuery;
    }

    // Debug output
    if (process.env.DEBUG || process.env.NL_CLI_DEBUG) {
      spinner.stop();
      printInfo(`Search directory: ${searchDir}`);
      printInfo(`Search pattern: ${pattern}`);
      if (detectedExtension) {
        printInfo(`Detected extension from query: ${detectedExtension}`);
      } else if (extension) {
        printInfo(`Extension filter: ${extension}`);
      }
      spinner.start('Searching files...');
    }

    try {
      const files = await globModule.glob(pattern, {
        cwd: searchDir,
        nodir: true,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**']
      });

      if (process.env.DEBUG || process.env.NL_CLI_DEBUG) {
        spinner.stop();
        printInfo(`Files found before filtering: ${files.length}`);
        spinner.start('Filtering results...');
      }

      let filteredFiles = files;

      // If we have an extension filter or detected extension, don't filter by name
      // Otherwise, filter by the search query
      if (!extension && !searchQuery.includes('*') && !searchQuery.includes('?')) {
        const queryLower = searchQuery.toLowerCase();
        filteredFiles = files.filter((file: string) =>
          file.toLowerCase().includes(queryLower) ||
          path.basename(file).toLowerCase().includes(queryLower)
        );
      }

      filteredFiles = filteredFiles.slice(0, maxResults);
      spinner.stop();

      if (filteredFiles.length === 0) {
        printWarning('No files found');
        if (extension) {
          printInfo(`Searching for pattern: ${pattern}`);
          printInfo(`Try searching without specifying file type or check if ${extension} files exist in this directory`);
        }
        return;
      }

      if (detectedExtension) {
        printSuccess(`Found ${filteredFiles.length} ${detectedExtension} file(s) (detected from query)`);
      } else if (extension) {
        printSuccess(`Found ${filteredFiles.length} ${extension} file(s)`);
      } else {
        printSuccess(`Found ${filteredFiles.length} file(s)`);
      }

      // Get file stats for each file
      const tableData = await Promise.all(filteredFiles.map(async (file: string, idx: number) => {
        const fullPath = path.resolve(searchDir, file);
        let size = 'N/A';
        let modified = 'N/A';

        try {
          const stats = await fs.stat(fullPath);
          // Format size
          const bytes = stats.size;
          if (bytes < 1024) size = `${bytes} B`;
          else if (bytes < 1024 * 1024) size = `${(bytes / 1024).toFixed(1)} KB`;
          else if (bytes < 1024 * 1024 * 1024) size = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
          else size = `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;

          // Format date
          const mtime = stats.mtime;
          const now = new Date();
          const diffMs = now.getTime() - mtime.getTime();
          const diffMins = Math.floor(diffMs / 60000);
          const diffHours = Math.floor(diffMs / 3600000);
          const diffDays = Math.floor(diffMs / 86400000);

          if (diffMins < 1) modified = 'just now';
          else if (diffMins < 60) modified = `${diffMins}m ago`;
          else if (diffHours < 24) modified = `${diffHours}h ago`;
          else if (diffDays < 7) modified = `${diffDays}d ago`;
          else modified = mtime.toLocaleDateString();
        } catch {
          // File might not be accessible
        }

        return {
          '#': idx + 1,
          'File': path.basename(file),
          'Size': size,
          'Modified': modified,
          'Directory': path.dirname(file)
        };
      }));

      console.log(formatTable(tableData));

      const shouldOpen = await promptConfirm('Would you like to open a file?');
      if (shouldOpen) {
        const fileChoices = filteredFiles.map((file: string, idx: number) => ({
          name: `${idx + 1}. ${file}`,
          value: file
        }));

        const selectedFile = await selectFromList<string>('Select a file to open:', fileChoices);
        if (selectedFile) {
          const fullPath = path.resolve(searchDir, selectedFile);
          const isMarkdown = selectedFile.toLowerCase().endsWith('.md') || selectedFile.toLowerCase().endsWith('.markdown');

          // Check which editors are installed
          const [vimInstalled, nanoInstalled, freshInstalled, glowInstalled] = await Promise.all([
            checkEditorInstalled('vim'),
            checkEditorInstalled('nano'),
            checkEditorInstalled('fresh'),
            isMarkdown ? checkEditorInstalled('glow') : Promise.resolve(false)
          ]);

          // Ask which editor to use - all options selectable, check installation when used
          const editorChoices: { name: string; value: string }[] = [
            { name: chalk.yellow('📄 cat') + chalk.gray(' - View file contents (always installed)'), value: 'cat' },
            {
              name: vimInstalled
                ? chalk.green('📝 vim') + chalk.gray(' - Edit with vim')
                : chalk.gray('📝 vim - Edit with vim (not installed)'),
              value: 'vim'
            },
            {
              name: nanoInstalled
                ? chalk.cyan('✏️  nano') + chalk.gray(' - Edit with nano')
                : chalk.gray('✏️  nano - Edit with nano (not installed)'),
              value: 'nano'
            },
            {
              name: freshInstalled
                ? chalk.magenta('🌟 fresh') + chalk.gray(' - Edit with Fresh editor')
                : chalk.gray('🌟 fresh - Edit with Fresh editor (not installed)'),
              value: 'fresh'
            }
          ];

          // Add glow option for markdown files
          if (isMarkdown) {
            editorChoices.unshift({
              name: glowInstalled
                ? chalk.magenta('🌸 glow') + chalk.gray(' - View with Glow (markdown renderer)')
                : chalk.gray('🌸 glow - View with Glow (markdown renderer) (not installed)'),
              value: 'glow'
            });
          }

          const editor = await selectFromList('Choose editor:', editorChoices);

          if (editor) {
            // Check if the selected editor is installed before trying to use it
            const isInstalled = editor === 'cat' ? true : await checkEditorInstalled(editor);

            if (!isInstalled) {
              printError(`${editor} is not installed on your system.`);
              printInfo(`Go to Extras menu to get installation instructions for ${editor}.`);
            } else {
              printInfo(`Opening with ${editor}...`);
              await executeEditor(`${editor} "${fullPath}"`);
            }
          }
        }
      }
    } catch (error) {
      spinner.stop();
      printError(`Search failed: ${error}`);
    }
  } catch (error) {
    printError(`Error searching files: ${error}`);
    throw error;
  }
}
