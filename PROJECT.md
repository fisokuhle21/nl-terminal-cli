# NL Terminal CLI - Project Documentation

## Overview

The **NL Terminal CLI** is a standalone command-line tool that turns natural language into real shell commands, with an emphasis on speed, transparency, and local-first storage.

### Design choices

- **Local-first by default:** Commands, history, and sessions live on disk under `~/.nl-terminal-cli` so the tool works offline and is easy to inspect or back up.
- **SQLite as the command brain:** A small built-in database keeps the command catalog fast to query and easy to extend without bundling a heavy model.
- **Two runtimes, one surface:** Node.js for compatibility and Bun for speed, with a thin runtime switch in the database layer.
- **Explicit execution:** Natural language is mapped to concrete commands you can see and confirm, keeping the CLI safe and predictable.
- **Session-aware UX:** Multi-session history mirrors real terminal workflows and makes it easy to return to prior work.
- **Git PR management:** Built-in PR workflows for GitHub (primary), with GitLab/Bitbucket support if their CLIs are installed.
- **Automation-friendly flags:** `--dry-run`, `--yes`, and `--no-color` make the CLI safe for scripts and CI.

---

## Project Structure

```
nl-terminal-cli/
├── dist/                      # Compiled JavaScript (auto-generated)
├── node_modules/             # Dependencies (auto-generated)
├── scripts/                  # Utility scripts
├── src/                      # TypeScript source code
│   ├── types/               # Type definitions
│   ├── history.ts           # Command history and session management module (~15KB)
│   └── *.ts                 # Core modules
├── tests/                    # Test files
├── .gitignore               # Git ignore patterns
├── package.json             # Project manifest
├── package-lock.json        # Dependency lock file
├── README.md                # User documentation
├── tsconfig.json            # TypeScript configuration
└── PROJECT.md              # This file
```

---

## Core Files Documentation

### 📁 `src/` - Source Code Directory

#### `cli.ts` (CLI Entry Point)
**Purpose:** Main entry point for the command-line interface using Commander.js.

**Key Functions:**
- `program` setup - Configures CLI commands and options
- `initializeApp()` - Initializes database and config on startup
- Command handlers for `run`, `search`, `list`, `config`, `init`

**CLI Commands:**
- `nl-terminal run [command]` - Execute natural language command
- `nl-terminal search [query]` - Search for files
- `nl-terminal list` - List all saved mappings
- `nl-terminal config` - Configure command mappings
- `nl-terminal init` - Initialize configuration

**ASCII Banner:**
- Displays stylized "NL TERMINAL" text on startup
- Uses Unicode box-drawing characters
- Cyan color theme with gray subtitle
- Reprinted when clearing screen

**Session Display:**
- Shows current session details in the menu header
- Updates dynamically when switching sessions

**Exported:**
- `banner` - ASCII art for reuse in clear screen

---

#### `terminal-session.ts` (Multi-Terminal Session Management)
**Purpose:** Manages cross-terminal session coordination, ownership tracking, and secure session takeover.
**Size:** ~12KB (400+ lines)

**Path Functions (dynamic for test isolation):**
- `getHistoryDir()` - Returns `~/.nl-terminal-cli` (evaluated at call time)
- `getTerminalRegistryFile()` - Returns terminal-registry.json path
- `getLockFile()` - Returns .registry.lock path

**Key Functions:**
- `getTerminalId()` - Returns unique terminal identifier (PID + TTY + timestamp)
- `generateSessionKey()` - Creates 8-character alphanumeric session key
- `claimSession()` - Claims ownership of a session for current terminal
- `releaseSession()` - Releases session ownership
- `isSessionOwnedByCurrentTerminal()` - Checks if current terminal owns session
- `getSessionOwner()` - Gets terminal info that owns a session
- `takeoverSessionWithKey()` - Takes over session using session key
- `createTakeoverRequest()` - Creates pending takeover request
- `approveTakeoverRequest()` - Approves incoming takeover request
- `denyTakeoverRequest()` - Denies incoming takeover request
- `checkSessionTakeover()` - Checks if current session was taken over
- `getPendingTakeoverRequests()` - Gets requests waiting for approval
- `getCurrentTerminalSessionKeys()` - Gets keys for all sessions owned by terminal

**Terminal Registry:**
```typescript
interface TerminalInfo {
  id: string;           // Unique terminal ID
  pid: number;          // Process ID
  ttyPath: string;      // TTY device path
  startTime: string;    // When terminal started
  lastHeartbeat: string; // Last activity timestamp
}

interface TakeoverRequest {
  id: string;
  sessionId: string;
  requestingTerminalId: string;
  ownerTerminalId: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  createdAt: string;
  expiresAt: string;    // 60 seconds from creation
}
```

**Storage:**
- `~/.nl-terminal-cli/terminal-registry.json` - Terminal and session ownership data
- Lock file mechanism for cross-process coordination
- Path resolution uses `getHistoryDir()` for dynamic HOME support (enables test isolation)

**Session Key Format:**
- 8 characters, alphanumeric (excludes confusing: 0, O, I, 1, L)
- Example: `A3K7NX9R`

**Heartbeat System:**
- 5-second heartbeat interval
- 15-second stale threshold
- Auto-releases sessions from stale terminals

---

#### `history.ts` (Session & History Management)
**Purpose:** Manages command history tracking and multi-session state.
**Size:** ~18KB (550+ lines)

**Path Functions (dynamic for test isolation):**
- `getHistoryDir()` - Returns `~/.nl-terminal-cli` (evaluated at call time)
- `getHistoryFile()` - Returns history.json path
- `getSessionsFile()` - Returns sessions.json path
- `getSessionsExportDir()` - Returns sessions export folder path

**Key Functions:**
- `createNewSession()` - Creates a new session and makes it active
- `getCurrentActiveSessionId()` - Returns the active session identifier
- `switchActiveSession()` - Switches to a different session
- `closeSession()` - Closes a session and switches to another when possible
- `getActiveSessions()` - Returns list of active session IDs
- `addToHistory()` - Records command with output, errors, and metadata
- `reloadSession()` - Reloads archived session from disk with full command history
- `exportHistory()` - Exports history to JSON/TXT/Markdown with full output (supports custom path)
- `searchHistory()` - Searches across all sessions by query or command
- `browseSessions()` - Interactive session browser with command counts
- `clearHistory()` - Removes all history and session data
- `deleteSession()` - Removes specific session by ID
- `detachSession()` - Removes session from active list without closing (for takeover)

**Session Types:**
```typescript
interface Session {
  id: string;                // Unique session ID (generated)
  name?: string;             // Optional session display name
  startTime: string;         // ISO timestamp
  endTime?: string;          // ISO timestamp if closed
  terminalId?: string;       // Terminal that owns this session
  lastTerminalId?: string;   // Previous terminal (for takeover tracking)
  isShared?: boolean;        // Whether session can be shared
  commands: CommandEntry[];  // All executed commands
}

interface CommandEntry {
  id: string;
  sessionId?: string;
  naturalLanguage: string;   // Original user query
  command: string;           // Executed command
  output?: string;           // Command output
  error?: string;            // Error output if any
  success: boolean;
  exitCode: number;
  timestamp: string;         // ISO timestamp
  tags?: string[];
}
```

**Storage:**
- `~/.nl-terminal-cli/sessions.json` - Persistent session metadata
- `~/.nl-terminal-cli/history.json` - Flat command history with full output
- `~/.nl-terminal-cli/sessions/` - Exported session files (default export location)
- Path resolution uses `getHistoryDir()` for dynamic HOME support (enables test isolation)

**Multi-Session Flow:**
1. CLI starts → `initMultiSession()` ensures an active session
2. Commands execute → `addToHistory()` captures output and errors
3. User presses 'q' → `closeSession()` ends current, switches to another
4. Last session closes → CLI exits completely

**History Menu Integration:**
- Accessed via 📜 Command History in main menu
- Options: View Recent, Browse Sessions, Search, Export, Manage
- Recent commands show last 20 with re-run capability
- Browse shows all sessions with command counts and timestamps
- Search supports fuzzy matching across natural language and commands
- Export creates timestamped files in `~/.nl-terminal-cli/sessions/`

**Session Reload Feature:**
- `reloadSession()` restores full session state from `sessions.json`
- All commands, outputs, and metadata are preserved
- User can continue appending new commands to reloaded session
- Reloaded sessions become active and participate in multi-session flow

---

#### `commands.ts` (Command Execution Engine)
**Purpose:** Main entrypoint that hosts the interactive loop, command execution, and re-exports public API.

**Size:** ~59KB (1700+ lines)

**Key Components:**

**Main Functions:**
- `executeCommand()` - Primary NL command execution with alias/chain detection
- `executeCommandFromMenu()` - Interactive menu-driven execution
- `mainLoop()` - Main interactive menu loop with session display

**Menu Functions:**
- `checkAndInstallEditors()` - Check editor installation status with indicators

**Split UI/Logic Modules:**
- `src/commands/config-ui.ts` - Mapping configuration flows (add/edit/delete/compound aliases)
- `src/commands/mappings-ui.ts` - List mappings summary
- `src/commands/database-ui.ts` - Database browsing + management menus
- `src/commands/history-ui.ts` - History browsing/search/export menus
- `src/commands/git-ui.ts` - Git interactive menu
- `src/commands/platform-ui.ts` - Git PR management menu (create/list/merge/checkout/actions)
- `src/commands/conflict-helper.ts` - Merge conflict resolution helper with resume support
- `src/commands/sessions-ui.ts` - Session management/takeover menus
- `src/commands/search.ts` - File search UI
- `src/commands/execute-core.ts` - Command execution + confirmation
- `src/commands/compound.ts` - Compound parsing/execution helpers
- `src/commands/menu-stack.ts` - Menu stack utilities
- `src/commands/db-core.ts` - Database initialization/ensure helpers

**Menu Style Functions:**
- `toggleMenuStyle()` - Switches between list and expand view
- `mainLoop()` - Adapts display based on `menuStyle` setting
- List view: Scrollable with arrow keys, full descriptions
- Expand view: Single-key shortcuts (e, s, l, m, d, h, v, x, c, q)
  - Git PRs option: `p`

**Compound Command Support:**
- `detectCompoundCommand()` - Detects chains using "and", "then", "&&", ";"
- `parseCompoundCommand()` - Splits input into segments
- `matchCompoundSegments()` - Matches each segment to database
- `resolveSegmentPlaceholders()` - Resolves arguments in each segment
- `displayCompoundBreakdown()` - Shows parsed command breakdown
- `displayExecutionSummary()` - Shows execution results

**Extension Detection:**
- `EXTENSION_MAPPINGS` - Maps 80+ language names to file extensions
- `detectExtensionFromQuery()` - Extracts extensions from search queries

**Editor Management:**
- `SUPPORTED_EDITORS` - List of supported editors with metadata (vim, nano, fresh, cat, glow)
- `checkAndInstallEditors()` - Interactive editor installation checker with status indicators
- Website links for installation guides
- `executeEditor()` - Function for editors requiring full terminal control
- Interactive editors use direct terminal access (`stdio: 'inherit'`)

**Glow Markdown Viewer:**
- Added `glow` (from charmbracelet/glow) to supported editors
- Installation info: https://github.com/charmbracelet/glow#installation
- Auto-offered when opening .md or .markdown files
- Option to view exported markdown history with glow
- Installation status indicators for all editors (❌ shown before editors not installed)
- Dynamic checks for vim, nano, fresh, glow (cat always shown as installed)

**Compound Command Output Formatting:**
- Beautiful `ls -la` formatting with colors and headers
- Human-readable file sizes (K, M, G suffixes)
- Colored permissions (green=read, yellow=write, red=execute)
- Directory highlighting (blue bold)
- File type color-coding by extension
- Column headers showing what each column means

**Session Integration:**
- Calls `history.addToHistory()` after each command
- Displays current session details in the menu header
- Handles session switching on exit
- Supports reloading previous sessions

**Exports:**
- `executeCommand()` - Main export for direct use
- `searchFiles()` - File search functionality
- `listMappings()` - List all mappings
- `configureMappings()` - Configuration interface
- `browseDatabase()` - Database browsing entrypoint
- `executeWithConfirmation()` - Execution helper (re-exported)
- `mainLoop()` - Interactive main menu
- `detectCompoundCommand()` - For testing
- `parseCompoundCommand()` - For testing

---

#### `config.ts` (Configuration Management)
**Purpose:** Manages user configuration and command mappings storage.

**Storage Location:**
- `~/.nl-terminal-cli/config.json` - User configuration
- `~/.nl-terminal-cli/commands.db` - SQLite database

**Key Functions:**
- `initConfig()` - Creates default configuration file
- `getConfig()` - Reads configuration
- `saveConfig()` - Saves configuration
- `getMappings()` - Retrieves user command mappings
- `addMapping()` - Adds new mapping
- `updateMapping()` - Updates existing mapping
- `deleteMapping()` - Deletes mapping
- `configExists()` - Checks if config exists

**Configuration Structure:**
```typescript
{
  defaultShell: string,
  settings: {
    confirmBeforeExecute: boolean,
    fuzzyMatchThreshold: number,
    saveHistory: boolean,
    maxHistoryItems: number,
    menuStyle: 'list' | 'expand'  // NEW: Menu display preference
  }
}
```

**Menu Style Setting:**
- Stored in configuration and persisted across sessions
- Default is 'list' view
- Toggle via main menu option or keyboard shortcut

**Default Mappings:**
- 12 pre-configured commands (ls, git, npm, etc.)
- Stored as JSON in config file

---

#### `database.ts` (SQLite Database)
**Purpose:** Manages SQLite database with 160+ pre-built commands.

**Size:** ~49KB (1200+ lines)

**Database Schema:**
- `commands` table - All built-in commands
- `command_history` table - Execution history

**Categories:**
- `file` - 16 commands (mkdir, cp, mv, rm, etc.)
- `git` - 25 commands (init, add, commit, push, pull, branch, etc.)
- `npm` - 17 commands (install, run, test, build, etc.)
- `bun` - 21 commands (install, add, run, test, build, bunx, etc.)
- `system` - 14 commands (ps, df, du, env, etc.)
- `docker` - 22 commands (build, run, ps, exec, etc.)
- `database` - 6 commands (migrate, seed, backup, etc.)
- `network` - 14 commands (curl, wget, ping, ssh, etc.)
- `text` - 23 commands (grep, awk, sed, cat, etc.)
- `git-platform` - PR workflows (create/list/merge/checkout/view)
  - Includes: comment, assign, request review, close, reopen

**Key Functions:**
- `initDatabase()` - Creates database tables
- `seedDatabase()` - Populates with default commands
- `getAllCommands()` - Retrieves all commands
- `findCommandsByCategory()` - Filter by category
- `searchCommands()` - Search within commands
- `addCommand()` - Add custom command
- `deleteCommand()` - Remove command
- `getDatabase()` - Get database instance
- `closeDatabase()` - Close connection

**Command Structure:**
```typescript
{
  id: number,
  category: string,
  naturalLanguage: string[],
  commandTemplate: string,
  description: string,
  placeholders: Placeholder[],
  examples: string[]
}
```

**Placeholder Support:**
- `{folder_name}` - Directory names
- `{file_name}` - File names
- `{message}` - Commit messages
- `{pattern}` - Search patterns
- `{package}` - Package names
- `{container}` - Container names
- `{branch}` - Git branches
- `{url}` - URLs
- And many more...

**Placeholder Format:**
Placeholders are defined using the format: `{name|description|required|default}`
- `name`: Parameter identifier used in command templates
- `description`: Human-readable description for prompts
- `required`: Boolean indicating if parameter must be provided
- `default`: Optional default value if not specified

---

#### `matcher.ts` (Matching Engine)
**Purpose:** Natural language matching algorithms for finding best command matches.

**Key Functions:**
- `findBestMatch()` - Finds best match from user mappings
- `findMultipleMatches()` - Returns top N matches
- `findBestMatchFromDatabase()` - Matches against SQLite database
- `findMultipleMatchesFromDatabase()` - Multiple database matches
- `calculateSimilarity()` - String similarity using string-similarity library
- `parseCommand()` - Extracts placeholders from input
- `replacePlaceholders()` - Substitutes values into templates

**Matching Strategies:**
1. **Exact Match** - Perfect string match
2. **Contains Match** - Input contains command phrase
3. **Fuzzy Match** - Similarity scoring with threshold
4. **Word Overlap** - Common keyword counting

**Confidence Scoring:**
- 0.0 - 1.0 scale
- Configurable threshold (default 0.7)
- Exact matches score 1.0

**Placeholder Extraction:**
- Detects "called {name}", "named {name}", "to {dest}"
- Extracts file extensions from queries
- Supports multiple placeholders per command
- Handles quoted strings (extracts content inside quotes)
- Removes connecting words ("with message X" → X)

### Placeholder Technical Implementation

The placeholder system is implemented across multiple modules:

#### Type Definitions (`types.ts`)

```typescript
interface Placeholder {
  name: string;        // Parameter name: "folder_name"
  description: string; // Human-readable: "folder name"
  required: boolean;   // Is this parameter required?
  default?: string;    // Optional default value
}

interface ParsedCommand {
  command: string;           // Final command with placeholders replaced
  placeholders: Placeholder[]; // List of extracted placeholders
  values: Map<string, string>; // Map of placeholder names to extracted values
}
```

#### Placeholder Extraction (`extractArguments()` in matcher.ts)

The `extractArguments()` function is the core of placeholder extraction:

```typescript
function extractArguments(
  input: string,
  placeholders: Placeholder[]
): Map<string, string>
```

**Extraction Process:**

1. **Quoted String Detection**
   - Searches for content inside single or double quotes
   - Strips quotes and uses content as argument value
   - Example: `"commit with message 'fix bug'"` → `fix bug`

2. **Connecting Word Patterns**
   Recognizes common connecting phrases and extracts the following word:
   
   | Pattern | Regex | Example Input | Extracted |
   |---------|-------|---------------|-----------|
   | "called X" | `/called\s+(\S+)/i` | "folder called test" | `test` |
   | "named X" | `/named\s+(\S+)/i` | "file named config" | `config` |
   | "with X" | `/with\s+(\S+)/i` | "with message fix" | `fix` |
   | "to X" | `/to\s+(\S+)/i` | "copy to backup" | `backup` |
   | "from X" | `/from\s+(\S+)/i` | "from nginx" | `nginx` |
   | "on X" | `/on\s+(\S+)/i` | "on branch main" | `main` |
   | "for X" | `/for\s+(\S+)/i` | "for production" | `production` |

3. **Smart Word Removal**
   Removes connecting words from extracted values:
   - "with message X" extracts `X` (not "message X")
   - "to branch X" extracts `X` (not "branch X")
   - "from image X" extracts `X` (not "image X")

4. **Multiple Placeholder Support**
   - Iterates through all placeholders in the template
   - Extracts values for each placeholder independently
   - Returns a Map of placeholder names to values

#### Placeholder Parsing (`parseUserMapping()` in matcher.ts)

Parses placeholder definitions from command templates:

```typescript
function parseUserMapping(
  naturalLanguage: string,
  commandTemplate: string
): { naturalLanguage: string; command: string; placeholders: Placeholder[] }
```

**Parsing Steps:**

1. **Template Analysis**
   - Scans command template for `{placeholder}` syntax
   - Extracts placeholder definitions with format: `{name|description|required|default}`

2. **Validation**
   - Ensures all placeholders in template are defined
   - Validates required vs optional parameters
   - Applies default values where specified

3. **Structure Creation**
   - Returns structured mapping with parsed placeholders
   - Used when saving user mappings to config

#### Placeholder Replacement (`replacePlaceholders()` in matcher.ts)

Replaces placeholders in command templates with extracted values:

```typescript
function replacePlaceholders(
  template: string,
  values: Map<string, string>
): string
```

**Replacement Logic:**

```typescript
// Template: "git commit -m \"{message}\""
// Values: { message: "fix bug" }
// Result: git commit -m "fix bug"

template.replace(/\{(\w+)\}/g, (match, name) => {
  return values.get(name) || match;
});
```

**Features:**
- Handles nested braces in quoted strings
- Preserves unmatched placeholders
- Supports multiple occurrences of same placeholder

#### Integration Points

**1. User Mappings (`addNewMapping` in commands/config-ui.ts)**

When users create custom mappings:
```typescript
// User input:
// Natural language: "create directory {folder_name}"
// Command template: "mkdir {folder_name}"

// Parse and store:
const mapping = parseUserMapping(nlInput, cmdTemplate);
// mapping.placeholders = [{ name: "folder_name", description: "folder name", required: true }]
```

**2. Compound Commands (`addCompoundCommandAlias` in commands/config-ui.ts)**

Placeholders work in compound commands:
```typescript
// "create folder temp and list files"
// Segment 1: "create folder temp" → mkdir temp
// Segment 2: "list files" → ls -la

// Each segment's placeholders extracted independently:
const segmentPlaceholders = extractArguments(segment, placeholders);
```

**3. Database Commands**

Database commands include pre-defined placeholders:
```typescript
// Database command entry:
{
  naturalLanguage: ["create directory {folder_name}", "make folder {folder_name}"],
  commandTemplate: "mkdir {folder_name}",
  placeholders: [
    { name: "folder_name", description: "folder name", required: true }
  ]
}
```

**4. Command Execution Flow**

```
User Input: "create folder called my-app"
         ↓
Matcher: findBestMatchFromDatabase()
         ↓
Extract: extractArguments("create folder called my-app", placeholders)
         ↓
Pattern Match: "called my-app" → folder_name = "my-app"
         ↓
Replace: replacePlaceholders("mkdir {folder_name}", { folder_name: "my-app" })
         ↓
Result: "mkdir my-app"
         ↓
Execute: executeInTerminal("mkdir my-app")
```

#### Extraction Pattern Examples

| Input | Template | Placeholders | Extracted Values | Result |
|-------|----------|--------------|------------------|--------|
| "create folder test" | "mkdir {folder_name}" | folder_name | `{folder_name: "test"}` | `mkdir test` |
| "commit with message 'fix'" | "git commit -m \"{msg}\"" | msg | `{msg: "fix"}` | `git commit -m "fix"` |
| "copy a.txt to backup" | "cp {source} {dest}" | source, dest | `{source: "a.txt", dest: "backup"}` | `cp a.txt backup` |
| "push to origin on main" | "git push {remote} {branch}" | remote, branch | `{remote: "origin", branch: "main"}` | `git push origin main` |

---

#### `utils.ts` (Utility Functions)
**Purpose:** Shared utility functions for CLI operations.

**Terminal Execution:**
- `executeInTerminal()` - Execute with spinner and capture output
- `executeInteractive()` - Execute with real-time output streaming
- `executeInTerminalWithOutput()` - Execute and display output immediately

**User Input:**
- `promptInput()` - Text input with optional default
- `promptConfirm()` - Yes/No confirmation
- `selectFromList()` - Single selection from list
- `promptEditor()` - Multi-line text editor input

**Output Formatting:**
- `formatLsOutput()` - Beautiful ls -la formatting with colors
- `formatTable()` - ASCII table generation
- `printSuccess()` - Green success message
- `printError()` - Red error message
- `printInfo()` - Blue info message
- `printWarning()` - Yellow warning message
- `printSeparator()` - Horizontal line separator

**System Utilities:**
- `checkEditorInstalled()` - Checks if editor exists (for installation indicators)
- `getPlatform()` - Detects OS (linux/mac/windows)
- `clearScreen()` - Clears terminal, optionally reprints banner
- `openUrl()` - Opens URL in default browser

**File Size Formatting:**
- `formatFileSize()` - Converts bytes to human-readable (K, M, G)
- Used in ls -la output formatting

**Features:**
- Chalk for colored output
- Ora for spinners (lazy loaded)
- Inquirer for interactive prompts (lazy loaded)
- Cross-platform support

---

#### `lazy-modules.ts` (Lazy Loading Utilities)
**Purpose:** Provides lazy-loaded versions of heavy modules to optimize startup time and memory usage.

**Key Functions:**
- `getInquirer()` - Lazy loads inquirer module (~5MB saved on startup)
- `getOra()` - Lazy loads ora spinner module (~0.5MB saved)
- `getGlob()` - Lazy loads glob module (~0.5MB saved)
- `getChalk()` - Cached chalk reference (synchronous, lightweight)
- `preloadModules()` - Preloads heavy modules in background
- `isInquirerLoaded()` - Checks if inquirer is already loaded
- `isOraLoaded()` - Checks if ora is already loaded
- `isGlobLoaded()` - Checks if glob is already loaded

**Performance Impact:**
| Module | Memory Savings | When Loaded |
|--------|---------------|-------------|
| inquirer | ~5MB | First interactive prompt |
| ora | ~0.5MB | First spinner display |
| glob | ~0.5MB | First file search |

**Usage Pattern:**
```typescript
// Instead of: import inquirer from 'inquirer';
import { getInquirer } from './lazy-modules.js';

// Later, when needed:
const inquirer = await getInquirer();
const { answer } = await inquirer.default.prompt([...]);
```

---

#### `git.ts` (Git Utilities Module)
**Purpose:** Provides git operations for the Git menu including status, diff, branches, commit, push/pull.
**Size:** ~16KB (500+ lines)

**Core Types:**
```typescript
interface Branch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  remoteName?: string;
}

interface GitStatus {
  isClean: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  ahead: number;
  behind: number;
  branch: string | null;
  files: StatusFile[];
}

interface DiffResult {
  raw: string;
  formatted: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: DiffFile[];
}

interface GitResult {
  success: boolean;
  message: string;
  error?: string;
}
```

**Key Functions:**

| Function | Description |
|----------|-------------|
| `isGitRepository()` | Check if current directory is a git repo |
| `getCurrentBranch()` | Get current branch name |
| `getLocalBranches()` | List local branches |
| `getRemoteBranches()` | List remote branches (with fetch) |
| `getAllBranches()` | Get both local and remote branches |
| `getGitStatus()` | Get parsed status (staged, unstaged, untracked) |
| `getGitDiff(options?)` | Get diff with options (staged, file) |
| `formatEnhancedDiff()` | Color-coded diff formatting |
| `formatStatusSummary()` | Short status line |
| `formatDetailedStatus()` | Full status display |
| `switchBranch(name)` | Checkout to branch |
| `createBranch(name, checkout?)` | Create new branch |
| `deleteBranch(name, force?)` | Delete a branch |
| `stageAll()` | Stage all changes |
| `gitCommit(message)` | Commit staged changes |
| `gitPush(remote?, branch?)` | Push to remote |
| `gitPull(remote?, branch?)` | Pull from remote |
| `gitInit()` | Initialize new repository |
| `getCommitLog(count?)` | Get recent commits |
| `formatCommitLog()` | Format commit history |

**Enhanced Diff Output:**
```
┌─────────────────────────────────────────────────────────────┐
│ 📝 Git Diff: 3 files changed, +45 / -12 lines               │
└─────────────────────────────────────────────────────────────┘

📄 src/commands.ts (+30 -5)
───────────────────────────────────────────────────────────────
  45 │   const result = await selectFromList(...);
     │ - if (result === 'old') {                    ← RED
  46 │ + if (result === 'new') {                    ← GREEN
  47 │ + // Added new logic here                    ← GREEN
  48 │   return true;
```

---

#### `types.ts` (Type Definitions)
**Purpose:** Central TypeScript type definitions.

**Exported Types:**
- `CommandMapping` - User-defined NL → command mapping
- `SearchOptions` - File search options
- `ExecutionResult` - Command execution results
- `DatabaseCommand` - Database command structure
- `DatabaseMatchResult` - Match with confidence
- `ParsedCommand` - Parsed command with placeholders
- `Placeholder` - Placeholder definition
- `CompoundCommandSegment` - Compound command segment
- `ParsedCompoundCommand` - Full compound command
- `Session` - Session metadata (NEW)
- `CommandEntry` - History entry (NEW)
- `MenuStyle` - 'list' | 'expand' (NEW)

---

#### `index.ts` (Module Exports)
**Purpose:** Central export point for all modules.

**Exports:**
- All functions from `commands.ts`
- All functions from `config.ts`
- All functions from `database.ts`
- All functions from `matcher.ts`
- All functions from `utils.ts`
- All types from `types.ts`
- All functions from `history.ts` (NEW)

---

#### `types/string-similarity.d.ts` (Library Types)
**Purpose:** Type declarations for string-similarity npm package.

**Exports:**
- `compareTwoStrings()` - Compares two strings, returns 0-1 similarity
- `findBestMatch()` - Finds best match from target strings array

---

### 📁 `tests/` - Test Directory

#### `compound-commands.test.ts` (Test Suite)
**Purpose:** Unit tests for compound command functionality using Node.js built-in test runner.

**Test Coverage:**
- `detectCompoundCommand()` - Tests all separator types
  - "and", "then", "after that", "followed by"
  - "&&", "&", ";"
- `parseCompoundCommand()` - Tests parsing logic
  - Segment extraction
  - Separator detection
  - Edge cases

#### `benchmark.test.ts` (Performance Test Suite)
**Purpose:** Performance benchmarks comparing Node.js and Bun runtimes.

**Test Coverage:**
- **Startup Performance** - Tests `--help` and `--version` startup times
- **Command Execution** - Measures simple command execution time
- **Memory Usage** - Validates memory stays under thresholds (100MB Node, 80MB Bun)
- **Benchmark Statistics** - 5 iterations with min/max/avg/median/stdDev
- **Node.js vs Bun Comparison** - Side-by-side performance comparison

**Performance Results (with lazy loading optimizations):**
| Runtime | Startup | Memory | Notes |
|---------|---------|--------|-------|
| Bun (direct) | ~46ms | ~53MB | Fastest - runs TypeScript directly |
| Node.js | ~78ms | ~53MB | Requires build step |
| Bun (bundled) | ~161ms | ~53MB | 1.9MB self-contained bundle |

**Optimization Techniques:**
- **Lazy loading** - `inquirer`, `ora`, and `glob` load on-demand
- **Deferred imports** - Heavy modules only load when interactive features used
- **Cached modules** - Loaded modules are cached for reuse

**Bun Build Options:**
- `build:bun` - Full self-contained bundle (1.9MB)

**Test Framework:**
- Node.js built-in `node:test`
- Node.js built-in `assert`

**Usage:**
```bash
npm test              # Run all tests
npm run test:benchmark  # Run performance benchmarks only
```

---

### 📁 `scripts/` - Utility Scripts

**Purpose:** Contains helper scripts for development and database management.

**Scripts:**
- `seed.ts` - Database seeding script
- `perf-test.sh` - Interactive performance testing script

#### `perf-test.sh` (Performance Testing Script)
**Purpose:** Interactive menu for manual performance testing.

**Features:**
- Runtime detection (shows available Node.js and Bun builds)
- Quick benchmarks (5 iterations with min/max/avg)
- Detailed memory profiling
- Verbose timing with `/usr/bin/time -v`
- CPU profiling (generates `.cpuprofile` for Chrome DevTools)
- Node.js vs Bun comparison mode

**Usage:**
```bash
npm run perf           # Interactive menu
npm run perf:quick     # Quick benchmark of --help
./scripts/perf-test.sh "list files"  # Direct command benchmark
```

**Menu Options:**
1. Quick benchmark (--help)
2. Quick benchmark (--version)
3. Quick benchmark (custom command)
4. Detailed memory profile (--help)
5. Detailed memory profile (custom command)
6. Verbose timing with /usr/bin/time
7. CPU profiling (Node.js only)
8. Run all basic benchmarks
9. Interactive mode test
10. Node.js vs Bun comparison

---

### 📁 `dist/` - Compiled Output (Auto-generated)

**Purpose:** Contains compiled JavaScript and type definitions.

**Files:**
- `src/*.js` - Compiled Node.js JavaScript
- `bun-cli.js` - Bundled Bun CLI (~1.88 MB)
- `*.d.ts` - TypeScript declarations
- `*.d.ts.map` - Source maps

**Generated by:**
```bash
npm run build       # Build Node.js version
npm run build:bun   # Build Bun version
npm run build:all   # Build both versions
```

---

## Configuration Files

### `package.json` (Project Manifest)
**Purpose:** NPM package configuration and CLI setup.

**Key Sections:**
- **name:** `nl-terminal-cli`
- **version:** `0.0.1`
- **type:** `module` (ES modules)
- **bin:** `nl-terminal` → `dist/src/cli.js`
- **scripts:**
  - `build` - Compile TypeScript
  - `dev` - Watch mode
  - `clean` - Remove dist/
  - `start` - Run CLI
  - `test` - Run tests

**Dependencies:**
- `chalk` - Terminal colors
- `commander` - CLI framework
- `glob` - File pattern matching
- `inquirer` - Interactive prompts
- `ora` - Spinners
- `string-similarity` - String comparison
- `better-sqlite3` - SQLite database

**Dev Dependencies:**
- `typescript` - TypeScript compiler
- `@types/*` - Type definitions

---

### `tsconfig.json` (TypeScript Configuration)
**Purpose:** TypeScript compiler settings.

**Settings:**
- Target: ES2020
- Module: NodeNext
- OutDir: `./dist`
- RootDir: `./`
- Strict: true
- ES Module Interop: true

---

### `.gitignore` (Git Ignore)
**Purpose:** Specifies files to exclude from Git.

**Patterns:**
- `dist/` - Compiled output
- `node_modules/` - Dependencies
- `*.log` - Log files
- `.env` - Environment variables
- `*.db` - Database files

---

## Key Features

### 1. **Natural Language Command Execution**
- Type "list files" → executes `ls -la`
- Fuzzy matching with confidence scores
- Supports 80+ file extensions

### 2. **Compound Commands**
- Chain commands: "create folder and list files"
- Separators: "and", "then", "&&", ";"
- Sequential execution with error handling
- Progress indicators
- Beautiful output formatting for each command

### 3. **SQLite Database**
- 165+ pre-built commands
- 9+ categories (file, git, git-platform, npm, bun, system, docker, database, network, text)
- Placeholder support for arguments with intelligent extraction
- Searchable command database

### 4. **File Search**
- Natural language queries: "find typescript files"
- Extension detection: ".ts files" → *.ts
- File stats (size, modification time)
- Editor integration (vim, nano, cat, fresh, glow)
- Installation status indicators: ❌ (red X) shown before editors not installed
- Checks vim, nano, fresh, glow dynamically (cat always shown as installed)

### 5. **Interactive CLI**
- Main menu with arrow key navigation
- Cancel/edit options on all operations
- Preview before saving
- Clear screen with banner preservation
- Current session display in menu header

### 6. **Editor Management**
- Check which editors are installed
- Get installation website links
- Open links in default browser
- Support for vim, nano, fresh, cat, glow
- Interactive editors now use direct terminal access with `stdio: 'inherit'`
- New `executeEditor()` function for editors requiring full terminal control
- Fixed delay issues by avoiding piped streams for interactive editors
- Installation indicators: ✅ for installed, ❌ for not installed

### 7. **Command History System** v0.0.1
- Automatic session tracking when CLI starts
- History menu (📜 Command History) with options:
  - View recent commands (last 20, can re-run any)
  - Browse sessions (view previous sessions with command counts)
  - Search history (search by natural language or command)
  - Export/Share (export to JSON/TXT/Markdown with full output)
  - Manage (clear all or delete specific sessions)
- All commands now capture output and errors
- Exported sessions saved to `~/.nl-terminal-cli/sessions/` folder (auto-created)
- Export shows full file path in success message
- Full session reload with command history and outputs

### 8. **Menu Style Selection** v0.0.1
- Two menu modes available:
  - List view (default): Scrollable with arrow keys, full descriptions
  - Expand view: Single-key shortcuts, compact display
- Toggle via "Switch Menu Style" option in main menu
- Stored in configuration and persisted across sessions

**Expand Menu Keyboard Shortcuts:**
| Key | Action |
|-----|--------|
| `e` | Execute command |
| `s` | Search files |
| `l` | List saved commands |
| `m` | Configure mappings |
| `d` | Database commands |
| `h` | Command History |
| `p` | Git PRs |
| `v` | Switch menu style |
| `x` | Check editors |
| `c` | Clear screen |
| `q` | Exit |

### 9. **Compound Command Output Formatting** v0.0.1
- When running ls -la (in compound queries or standalone), output is now beautifully formatted
- Features: colored permissions (green=read, yellow=write, red=execute), directories in blue bold, human-readable file sizes (K, M, G), file type color-coding by extension, column headers showing what each column means

### 10. **Multi-Session Support** v0.0.1
- Multiple active sessions can run simultaneously
- Each session has independent command history and context
- Current session details displayed in the menu header
- Smart exit behavior: 'q' closes current session, switches to another if multiple exist
- CLI only exits when closing the last session

### 11. **Multi-Terminal Session Management**
- Different terminal windows can have their own sessions
- Cross-terminal session coordination via file-based registry
- Session ownership tracking with heartbeat monitoring (5-second interval, 15-second stale threshold)
- **Session Keys**: Secure 8-character alphanumeric keys for session takeover authentication
- **Takeover Request System**: Request approval from session owner (60-second expiry)
- **Takeover Methods**:
  - Enter session key (instant access with valid key)
  - Request approval (waits up to 60 seconds for owner response)
- **Session Recovery**: "SESSION TAKEN OVER" and "SESSION TRANSFERRED" screens
- View session keys for sessions you own
- Handle pending takeover requests with approve/deny options
- Real-time notification badges for pending requests

### 12. **Reload/Continue Session** v0.0.1
- Load previous sessions with all commands and outputs
- Continue adding commands to reloaded sessions
- Session browser shows command counts and timestamps
- Full session state restoration including output history

### 13. **Glow Markdown Viewer** v0.0.1
- View markdown files with beautiful formatting
- Auto-offered when opening .md or .markdown files
- Can view exported markdown history files
- Installation status shown in editor check

### 14. **Dangerous Command Warnings**
- Extra warning prompts for risky commands (`rm`, `sudo`, etc.)
- Prominent warning box with specific danger explanations:
  - `rm`: "permanently deletes files, cannot be recovered from trash"
  - `sudo`: "runs with root privileges, can modify system files"
- Confirmation defaults to "No" to prevent accidental execution
- Works in single commands, compound commands, and compound aliases

### 15. **Custom Export Path**
- Export history to default folder (`~/.nl-terminal-cli/sessions/`) or custom folder
- Supports `~` expansion for home directory paths
- Creates destination folder if it doesn't exist

### 16. **Intelligent Placeholder System**
- Dynamic argument extraction from natural language
- Smart pattern matching for connecting words ("with", "to", "from", "on", etc.)
- Quoted string handling (extracts content inside quotes)
- Multiple placeholders per command support
- Default values for optional parameters
- Placeholder preservation when editing mappings
- Format: `{name|description|required|default}`

### 14. **Configuration**
- JSON-based user configuration
- Custom command mappings with placeholders
- Compound command aliases
- Fuzzy matching threshold
- Menu style preference
- PR conflict sessions saved per-PR in `~/.nl-terminal-cli/.conflicts/`
- Preferred editor for conflict resolution (nano/vim/fresh)

---

## Multi-Session Architecture

### Overview
The CLI now supports multiple concurrent sessions, each with isolated command histories and contexts. This allows users to work on different tasks simultaneously without mixing command histories.

### Session Management

#### Session Creation
- Session IDs are generated (not user-facing sequential numbers)
- Active session IDs are tracked in memory (Set<string>)
- Each session has unique ID, start time, and command history

#### Session Functions (from history.ts)

**Creating Sessions:**
```typescript
function createNewSession(name?: string): Promise<string>
// Creates new session and makes it active
// Returns session ID
```

**Getting Session Info:**
```typescript
function getCurrentActiveSessionId(): string | null
// Returns currently active session ID

function getActiveSessions(): string[]
// Returns array of active session IDs

function hasMultipleSessions(): boolean
// Returns true if more than one session is active
```

**Switching Sessions:**
```typescript
function setCurrentSessionId(id: number): void
// Switches to specified session ID
// Updates menu header display

function closeSession(): boolean
// Closes current session
// If multiple sessions exist, switches to another
// Returns true if CLI should exit (last session)
// Returns false if switched to another session
```

#### Smart Exit Behavior
```typescript
// Pseudo-code for exit logic in mainLoop()
if (hasMultipleSessions()) {
  closeCurrentSession();
  switchToAnotherSession();
  continueMainLoop(); // Show menu for new session
} else {
  exitCLI();
}
```

**Exit Flow:**
1. User presses 'q' in an active session
2. `closeSession()` marks the session inactive
3. If other active sessions exist, CLI switches to another active session
4. When last session closes, CLI fully exits

### Session History Integration

Every command execution automatically saves to history:

```typescript
// In commands.ts executeCommand()
const result = await executeInTerminal(command);
await addToHistory(
  userInput,
  executedCommand,
  result.success,
  result.exitCode,
  result.output,
  result.error
);
```

### Session Reload Feature

**Loading Previous Sessions:**
```typescript
async function reloadSession(sessionId: string): Promise<Session | null>
// Loads session from ~/.nl-terminal-cli/sessions.json
// Restores all commands with outputs
// Sets as active session
// Allows appending new commands
```

**Reload Flow:**
1. User selects "Reload/Continue Session" from History menu
2. Selects a session by name/ID
3. `reloadSession(id)` restores the session with all commands
4. New commands are appended to the reloaded session

### Technical Implementation

#### Session State Management
```typescript
interface Session {
  id: string;
  name?: string;
  startTime: string;
  endTime?: string;
  commands: CommandEntry[];
}

// Active sessions stored in memory
const activeSessions: Set<string> = new Set();
let currentSessionId: string | null = null;
```

#### Session Storage

**Runtime Storage:**
- **Memory only**: Active sessions stored in `Set<string>`
- **No persistence**: Active session list is in memory, full history persisted in JSON files
- **Exception**: Exported sessions saved to `~/.nl-terminal-cli/sessions/`

**Persistent Storage:**
- `~/.nl-terminal-cli/sessions.json` - Session metadata and command history
- Updated after every command execution
- Used for reloading previous sessions

### Multi-Session CLI Flow

```
Terminal 1: $ nl-terminal
  ↓ Creates a new session
  ↓ Current session details shown in menu
  ↓ Executes commands, saves to history

Terminal 2: $ nl-terminal
  ↓ Creates another session
  ↓ Current session details shown in menu
  ↓ Executes commands, saves to separate history

Terminal 3: $ nl-terminal
  ↓ Creates a new session
  ↓ Current session details shown in menu
  ↓ All 3 sessions now active

Terminal 2: Press 'q'
  ↓ Close current session
  ↓ Switch to another active session

Terminal 1: Press 'q'
  ↓ Close current session
  ↓ Switch to another active session

Terminal 3: Press 'q'
  ↓ Close current session
  ↓ No more sessions active
  ↓ CLI fully exits
```

---

## Command History System

### Overview
A comprehensive session-based command history tracking system that automatically captures all executed commands, their output, and execution status.

### Architecture

**History Module (`history.ts`):**
- Manages all history operations
- Handles session metadata
- Provides export/import functionality
- ~15KB, 450+ lines

### Features

#### 1. **Automatic Session Tracking**
- Session starts automatically when CLI launches
- Tracks all executed commands with timestamps
- Captures output and errors for every command
- Unique session IDs with start times

#### 2. **History Menu Options**
Access via 📜 Command History in main menu:

**View Recent Commands:**
- Shows last 20 commands
- Displays: natural language query, executed command, timestamp, status
- Can re-run any command directly from history
- Shows execution time for each command

**Browse Sessions:**
- View all sessions with command counts
- Shows: Session ID, command count, start time, last activity
- Select session to load and continue
- Delete sessions from browser

**Search History:**
- Search by natural language (the query you typed)
- Search by actual command executed
- Fuzzy matching across all history
- Shows matching commands with context

**Export/Share:**
- Export to JSON (structured data with full metadata)
- Export to TXT (plain text format)
- Export to Markdown (formatted report with code blocks)
- All exports include:
  - Full command output and errors
  - Timestamps and execution status
  - Natural language queries
  - Executed commands
  - Execution duration
- Saved to `~/.nl-terminal-cli/sessions/`
- Shows full file path in success message

**Manage History:**
- Clear all history (removes sessions.json and history.json)
- Delete specific sessions by ID
- Confirmation prompts for destructive actions

### Storage Structure

```
~/.nl-terminal-cli/
├── history.json       # Flat command history
├── sessions.json      # Session metadata with full command arrays
└── sessions/          # Exported session files (auto-created)
    ├── session-2026-01-30-10-30-45.json
    ├── session-2026-01-30-10-30-45.txt
    └── session-2026-01-30-10-30-45.md
```

**history.json format:**
```json
{
  "commands": [
    {
      "id": 1,
      "sessionId": 1,
      "naturalLanguage": "list all files",
      "command": "ls -la",
      "output": "drwxr-xr-x  5 user group  4096 Jan 30 10:00 .",
      "error": null,
      "status": "success",
      "timestamp": "2026-01-30T10:30:00Z",
      "executionTime": 150
    }
  ]
}
```

**sessions.json format:**
```json
{
  "sessions": [
    {
      "id": "1738415400000-abc123",
      "name": "Default Session",
      "startTime": "2026-01-30T10:30:00Z",
      "commands": [...]  // Full command entries
    }
  ]
}
```

### History Functions Reference

**Session Management:**
```typescript
createNewSession(name?: string): Promise<string>         // Create new session
getCurrentActiveSessionId(): string | null               // Get active session ID
switchActiveSession(id: string): Promise<boolean>        // Switch session
closeSession(id: string): Promise<boolean>               // Close session
getActiveSessions(): string[]                            // Get active session IDs
reloadSession(id: string): Promise<Session | null>       // Reload previous session
```

**Command Tracking:**
```typescript
addToHistory(nl, cmd, success, exitCode, output?, error?): Promise<void>
// Saves command with all metadata to history
// Automatically determines session from currentActiveSessionId
```

**History Browsing:**
```typescript
getRecentCommands(count?: number): CommandEntry[]     // Get last N commands
getSessionCommands(sessionId: string): CommandEntry[] // Get session commands
searchHistory(query: string): CommandEntry[]          // Search all history
browseSessions(): Promise<void>                       // Interactive browser
```

**Export Functions:**
```typescript
exportHistory(filename: string, format?: 'json' | 'txt' | 'markdown', sessionId?: string): Promise<string>
// Returns full path to exported file
// Creates ~/.nl-terminal-cli/sessions/ if needed
// Filename includes timestamp
```

**Management Functions:**
```typescript
clearHistory(): Promise<void>                 // Remove all history
deleteSession(sessionId: string): Promise<void> // Remove specific session
```

---

## Data Storage

### Configuration File
**Location:** `~/.nl-terminal-cli/config.json`

**Contents:**
- Default shell preference
- User command mappings
- Settings (confirmations, thresholds)
- Menu style preference (list/expand)

### Database File
**Location:** `~/.nl-terminal-cli/commands.db`

**Contents:**
- 158 built-in commands
- Command execution history (legacy)
- Custom user commands

### Session Files (New v0.0.1)
**Location:** `~/.nl-terminal-cli/sessions/`

**Contents:**
- Exported session files (JSON, TXT, Markdown)
- Auto-created when exporting history
- Named with timestamp: `session-2026-01-30-10-30-45.json`

### History Files (New v0.0.1)
**Location:** `~/.nl-terminal-cli/history.json`
**Location:** `~/.nl-terminal-cli/sessions.json`

**Contents:**
- Flat command history with output and timestamps
- Session metadata and command counts
- Full command arrays with outputs for session reload

---

## Build Process

### Development Workflow
```bash
# Install dependencies
npm install

# Compile TypeScript
npm run build
# or
npx tsc

# Watch mode (auto-recompile)
npm run dev

# Run CLI
npm start
# or
node dist/src/cli.js

# Run tests
npm test
```

### Global Installation
```bash
# Link for global access
npm link

# Now use anywhere
nl-terminal
nl-terminal run "list files"
nl-terminal search "typescript files"
```

---

## Usage Examples

### Basic Commands
```bash
# Run with menu
nl-terminal

# Execute directly
nl-terminal run "show git status"

# Search files
nl-terminal search "find all .ts files"

# List mappings
nl-terminal list

# Configure
nl-terminal config
```

### Interactive Mode
```bash
$ nl-terminal

💻 Current Session: Default Session (0 commands, 1 active session)

? What would you like to do?
  🚀 Execute a command
  🔍 Search for files
  📋 List saved commands
  ⚙️  Configure mappings
  📚 Database commands
  📜 Command History
  🔄 Switch Menu Style
  🧹 Clear screen
  🔧 Check Editors & Get Install Links
  ❌ Exit
```

### Multi-Session Usage
```bash
# Terminal 1
$ nl-terminal
💻 Current Session: Default Session (0 commands, 1 active session)
> Execute some commands
> Press 'q'
Session closed

# Terminal 2 (already running)
💻 Current Session: Another Session
> Continue working in the other terminal
```

---

## Differences from VS Code Extension

| Feature | VS Code Extension | CLI Version |
|---------|------------------|-------------|
| **Environment** | VS Code only | Any terminal |
| **AI/Copilot** | ✅ Full integration | ❌ Not available |
| **Storage** | VS Code settings | SQLite + JSON files |
| **Database** | In-memory | 160+ SQLite commands |
| **UI** | Sidebar + panels | Interactive CLI menus |
| **File Search** | VS Code search API | Node.js glob |
| **Terminal** | Integrated | System shell |
| **Editors** | VS Code editor | vim, nano, fresh, cat, glow |
| **Configuration** | Settings UI | JSON files + CLI |
| **Compound Cmds** | ✅ Supported | ✅ Supported |
| **Multi-Session** | ❌ Not available | ✅ Multiple sessions |
| **Session Reload** | ❌ Not available | ✅ Continue previous sessions |
| **Command History** | ❌ Basic | ✅ Full with export |
| **Menu Styles** | ❌ Not available | ✅ List + Expand view |
| **Glow Viewer** | ❌ Not available | ✅ Integrated |
| **Install Indicators** | ❌ Not available | ✅ Editor status checks |

---

## Dependencies Comparison

### CLI-Specific Dependencies (not in VS Code ext)
- `better-sqlite3` - SQLite database
- `commander` - CLI framework
- `inquirer` - Interactive prompts
- `ora` - Spinners
- `glob` - File search

### VS Code Extension Dependencies
- `vscode` - VS Code API
- `fuse.js` - Fuzzy search
- `compromise` - NLP library

---

## Architecture

### Data Flow
```
User Input (Natural Language)
    ↓
CLI Parser (commander.js)
    ↓
Command Router
    ↓
Matcher (fuzzy + similarity)
    ↓
Database/Config Lookup
    ↓
Placeholder Extraction (extractArguments)
    - Pattern matching for connecting words
    - Quoted string detection
    - Smart word removal
    ↓
Placeholder Resolution (replacePlaceholders)
    - Replace {placeholders} with extracted values
    - Handle multiple placeholders
    - Apply defaults for optional params
    ↓
Command Execution (child_process)
    ↓
Output Display / History Save
```

### Module Dependencies
```
cli.ts
  ↓ imports
commands.ts
  ↓ imports
config.ts, database.ts, matcher.ts, utils.ts, history.ts
  ↓ imports
package.json, tsconfig.json
```

---

## Output Formatting Implementation

### Beautiful ls -la Formatting

When the CLI detects an `ls -la` command execution, it applies enhanced formatting:

#### Formatting Pipeline
```typescript
// 1. Execute command and capture output
const output = executeCommand('ls -la');

// 2. Parse each line
const lines = output.split('\n');
const parsedFiles = lines.map(line => parseLsLine(line));

// 3. Apply formatting
parsedFiles.forEach(file => {
  file.permissions = colorizePermissions(file.permissions);
  file.size = humanReadableSize(file.sizeBytes);
  file.name = colorizeByType(file.name, file.type);
});

// 4. Render with headers
renderFormattedTable(parsedFiles);
```

#### Color Scheme
| Element | Color | Chalk Code |
|---------|-------|------------|
| Read permission (r) | Green | `chalk.green()` |
| Write permission (w) | Yellow | `chalk.yellow()` |
| Execute permission (x) | Red | `chalk.red()` |
| Directory | Blue Bold | `chalk.blue.bold()` |
| Hidden files | Gray | `chalk.gray()` |
| Executable files | Bright Green | `chalk.greenBright()` |

#### File Size Formatting
```typescript
function humanReadableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`;
}
```

### Compound Command Output

Each command in a compound chain gets its own formatted output section:

```
✅ Command 1/3: ls -la
─────────────────────────────────────
📁 Current Directory: /home/user/project
Type  Permissions    Size  Modified      Name
─────────────────────────────────────
📁    drwxr-xr-x     4.0K  Jan 30 09:30  src/
📄    -rw-r--r--     1.2K  Jan 30 09:15  README.md

✅ Command 2/3: git status
─────────────────────────────────────
On branch main
Your branch is up to date with 'origin/main'.

✅ Command 3/3: cat package.json
─────────────────────────────────────
{
  "name": "my-project",
  "version": "1.0.0"
}
```

---

## Menu Style Implementation

### Configuration
```typescript
// In config.ts
interface Config {
  settings: {
    menuStyle: 'list' | 'expand'
  }
}
```

### Toggle Function
```typescript
// In commands.ts
async function toggleMenuStyle(): Promise<void> {
  const config = getConfig();
  config.settings.menuStyle = config.settings.menuStyle === 'list' ? 'expand' : 'list';
  saveConfig(config);
  printSuccess(`Menu style switched to ${config.settings.menuStyle} view`);
}
```

### Main Loop Display
```typescript
// List View (default)
const choices = [
  { name: '🚀 Execute a command', value: 'execute' },
  { name: '🔍 Search for files', value: 'search' },
  // ... more options
];

// Expand View
console.log('e) 🚀 Execute a command');
console.log('s) 🔍 Search for files');
console.log('l) 📋 List saved commands');
console.log('m) ⚙️  Configure mappings');
console.log('d) 📚 Database commands');
console.log('h) 📜 Command History');
console.log('v) 🔄 Switch Menu Style');
console.log('x) 🔧 Check Editors');
console.log('c) 🧹 Clear screen');
console.log('q) ❌ Exit');

const choice = await promptInput('Select option: ');
// Map single keys to actions
```

---

## Installation Indicators Implementation

### Editor Checking
```typescript
// In utils.ts
async function checkEditorInstalled(editor: string): Promise<boolean> {
  if (editor === 'cat') return true; // Always available
  
  try {
    const { execSync } = await import('child_process');
    execSync(`which ${editor}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
```

### Display Function
```typescript
// In commands.ts
async function checkAndInstallEditors(): Promise<void> {
  const editors = [
    { name: 'glow', description: 'Beautiful markdown viewer', url: 'https://github.com/charmbracelet/glow#installation' },
    { name: 'cat', description: 'Display file contents', url: null },
    { name: 'nano', description: 'Simple text editor', url: null },
    { name: 'vim', description: 'Advanced text editor', url: null },
    { name: 'fresh', description: 'Live-reloading viewer', url: 'https://github.com/pilu/fresh' }
  ];
  
  for (const editor of editors) {
    const installed = await checkEditorInstalled(editor.name);
    const status = installed ? '✅' : '❌';
    const statusText = installed ? 'Installed' : 'Not installed';
    console.log(`${status} ${editor.name.padEnd(10)} ${statusText.padEnd(15)} ${editor.url || ''}`);
  }
}
```

---

## Error Handling

### Graceful Degradation
- Missing config → Auto-initialize
- Missing database → Auto-create and seed
- No matches → Offer to create mapping
- Command fails → Ask to continue/stop
- Editor not installed → Show alternative options

### User Feedback
- Colored status messages
- Progress spinners
- Confirmation prompts
- Clear error messages
- Session indicator updates

---

## Future Enhancements

### Potential Additions
- [ ] OpenAI/Copilot integration option
- [ ] Plugin system for custom commands
- [ ] Scripting support (batch operations)
- [ ] GUI version (electron)
- [ ] Remote server mode
- [ ] Command sharing/sync
- [ ] Session sharing between users
- [ ] Web dashboard for history browsing

---

## Version History

### v0.0.2 (Current) - February 2026
Feature release with multi-terminal session management, safety improvements, and performance optimizations.

**New Features:**
- ✅ **Multi-Terminal Session Management** - Cross-terminal session coordination
  - File-based terminal registry (`~/.nl-terminal-cli/terminal-registry.json`)
  - Session ownership tracking with heartbeat monitoring
  - Session keys for secure takeover authentication (8-character alphanumeric)
  - Takeover request system with approve/deny workflow
  - Session recovery screens ("SESSION TAKEN OVER", "SESSION TRANSFERRED")
  - View session keys for owned sessions
  - Pending takeover request notifications with badges

- ✅ **Dangerous Command Warnings** - Extra safety for risky commands
  - Prominent warning box for `rm` and `sudo` commands
  - Specific danger explanations for each command type
  - Confirmation defaults to "No" to prevent accidents
  - Works across single, compound, and alias commands

- ✅ **Custom Export Path** - Export history to any folder
  - Choose between default folder and custom path
  - Supports `~` expansion for home directory
  - Auto-creates destination folder if needed

- ✅ **Performance Benchmarking** - Comprehensive performance testing
  - Automated benchmark test suite (`npm run test:benchmark`)
  - Interactive performance script (`npm run perf`)
  - Node.js vs Bun comparison
  - Memory usage and startup time measurements

- ✅ **Memory Optimization** - Lazy loading for fast startup
  - Lazy loading for `inquirer`, `ora`, and `glob` modules
  - Startup time reduced from ~177ms to ~57ms (Node.js)
  - Memory usage reduced from ~78MB to ~52MB
  - Heavy modules only load when interactive features used

- ✅ **Bun Build Optimization** - Self-contained bundle
  - Full bundle (1.9MB) - No dependencies needed
  - Bun direct from source is fastest (~46ms startup)

- ✅ **Git Integration** - Full-featured Git menu
  - Interactive Git menu (`g` in expand mode)
  - Enhanced color-coded diff viewer (all/staged/file)
  - Interactive branch switching (local + remote)
  - Branch creation and deletion with confirmation
  - Stage and commit flow
  - Push/pull operations
  - Commit history viewer
  - Git init support for non-git directories
  - Dangerous operation warnings (delete branch)

### v0.0.1 - January 30, 2026
Major feature release with multi-session support and command history system.

**New Features:**
- ✅ **Multi-Session Support** - Run multiple sessions simultaneously
  - Independent command histories per session
  - Session details displayed in the menu header
  - Smart exit behavior: 'q' closes one session at a time
  
- ✅ **Reload/Continue Session** - Restore previous sessions with full history
  - Load archived sessions from disk
  - Continue adding commands to reloaded sessions
  - Full state restoration including outputs
  
- ✅ **Command History System** - Comprehensive tracking and export
  - Automatic session tracking when CLI starts
  - History menu with 5 options:
    - View recent commands (last 20, can re-run any)
    - Browse sessions (view previous sessions with command counts)
    - Search history (search by natural language or command)
    - Export/Share (JSON/TXT/Markdown with full output)
    - Manage (clear all or delete specific sessions)
  - All commands capture output and errors
  - Sessions saved to `~/.nl-terminal-cli/sessions/`
  
- ✅ **Menu Style Selection** - Toggle between list and expand view
  - List view (default): Scrollable with arrow keys
  - Expand view: Single-key shortcuts for power users
  - Persisted in configuration
  
- ✅ **Keyboard Shortcuts** - Single key shortcuts in expand mode
  - e: Execute command
  - s: Search files
  - l: List saved commands
  - m: Configure mappings
  - d: Database commands
  - h: Command History
  - v: Switch menu style
  - x: Check editors
  - c: Clear screen
  - q: Exit/Switch session
  
- ✅ **Enhanced Output Formatting** - Beautiful ls -la with colors and headers
  - Colored permissions (green=read, yellow=write, red=execute)
  - Human-readable file sizes (K, M, G suffixes)
  - Directory highlighting (blue bold)
  - File type color-coding by extension
  - Column headers showing what each column means
  
- ✅ **Glow Markdown Viewer** - View markdown files with style
  - Added glow (charmbracelet/glow) to supported editors
  - Auto-offered for .md and .markdown files
  - Can view exported markdown history
  
- ✅ **Installation Indicators** - Shows which editors are installed
  - Dynamic checks for vim, nano, fresh, glow
  - ✅ (green) shown for installed editors
  - ❌ (red X) shown for editors not installed
  - Check Editors menu option with install links

### v1.0.0 - January 2026
Initial release with core functionality.

**Features:**
- ✅ SQLite database with 158 commands
- ✅ Compound command support
- ✅ File search with extension detection
- ✅ Interactive menu system
- ✅ Editor management (vim, nano, cat, fresh)
- ✅ Configuration management
- ✅ Natural language matching
- ✅ Placeholder extraction with intelligent argument parsing
- ✅ Test suite

---

## License

MIT License - See README.md for details

---

## Contributing

See README.md for contribution guidelines and development setup.

---

**Last Updated:** February 2026
**Status:** Production Ready
**Maintainer:** Development Team
**Node.js:** 20.12+
**Bun:** 1.0+
**License:** MIT

---

## Quick Reference

### File Sizes
| File | Size | Lines |
|------|------|-------|
| `commands.ts` | ~70KB | 2100+ |
| `database.ts` | ~49KB | 1200+ |
| `git.ts` | ~16KB | 500+ |
| `terminal-session.ts` | ~12KB | 400+ |
| `history.ts` | ~18KB | 550+ |
| `matcher.ts` | ~11KB | 350+ |
| `utils.ts` | ~8KB | 350+ |
| `config.ts` | ~5KB | 200+ |
| `cli.ts` | ~5KB | 200+ |
| `lazy-modules.ts` | ~2KB | 80+ |

### Test Files
| File | Purpose |
|------|---------|
| `git.test.ts` | Git utilities tests |
| `benchmark.test.ts` | Performance benchmarks (Node.js vs Bun) |
| `compound-commands.test.ts` | Compound command parsing tests |
| `integration-cli.test.ts` | CLI integration tests |
| `integration-history.test.ts` | History system tests |
| `security.test.ts` | Security and injection prevention tests |

### Total Source Code
- **~170KB** of TypeScript source
- **~5000+** lines of code
- **158** built-in commands with placeholders (9 categories including Bun)
- **80+** supported file extensions
- **Multi-session** architecture
- **Glow** markdown viewer support
- **Full command history** with export
- **Intelligent placeholder** extraction system

### Session Storage
```
~/.nl-terminal-cli/
├── history.json       # Flat command history
├── sessions.json      # Session metadata
└── sessions/          # Exported files
    ├── *.json
    ├── *.txt
    └── *.md
```

**Enjoy using NL Terminal CLI! 🚀**
