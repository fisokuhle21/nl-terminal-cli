# NL Terminal CLI

## TL;DR

Talk to your terminal like a teammate. It translates natural language into real shell commands, remembers what you like, and keeps the gritty stuff (flags, pipes, placeholders) out of your head. Under the hood, it is a fast SQLite brain plus a friendly CLI face.

### Why it exists

- Turn "list all files" into `ls -la` without thinking.
- Teach it your own shortcuts once, then reuse them forever.
- Explore files, run commands, and review history without leaving the terminal.

## Quick start

> **Note:** Published npm and Bun registry installs are coming soon. For now, install from source (see below).

```bash
git clone https://github.com/fisokuhle21/nl-terminal-cli.git
cd nl-terminal-cli
bun run ./src/cli.ts
```

## Prerequisites

- Node.js 20.12+ or Bun 1.0+
- A terminal with TTY support for interactive menus
- GitHub CLI (`gh`) for PR features (GitLab `glab` / Bitbucket `bb` supported if installed)

## Install options

### From source (recommended for now)

Run directly:

```bash
git clone https://github.com/fisokuhle21/nl-terminal-cli.git
cd nl-terminal-cli
bun run ./src/cli.ts
```

Build a single-file binary:

```bash
git clone https://github.com/fisokuhle21/nl-terminal-cli.git
cd nl-terminal-cli
bun build ./src/cli.ts --outfile ./dist/bun-cli.js --target bun
```

### Node.js (from source)

```bash
git clone https://github.com/fisokuhle21/nl-terminal-cli.git
cd nl-terminal-cli
npm install
npm run build
npm link
```

### Curl (auto-detect npm or bun)

```bash
curl -fsSL https://raw.githubusercontent.com/fisokuhle21/nl-terminal-cli/main/install.sh | bash
```

## Sample commands

```bash
nl-terminal run "list all files"
nl-terminal run "create a folder called my-project"
nl-terminal run "copy file readme.md to backup/readme.md"
nl-terminal search "find all config files"
nl-terminal run "create pull request"
nl-terminal run "merge pull request 42"
nl-terminal run "comment on pull request 42 with Looks good to me"
nl-terminal run "assign pull request 42 to octocat"
nl-terminal run "request review from octocat on pull request 42"
nl-terminal run "close pull request 42"
nl-terminal run "reopen pull request 42"
```

### Safety and automation

```bash
nl-terminal run "list all files" --dry-run
nl-terminal run "install package lodash" --yes
nl-terminal --no-color
```

## Core features

- Natural language to shell command translation
- Built-in command database with placeholders
- Custom mappings and interactive menus
- Search, history, and multi-session support
- Multi-terminal session management with secure takeover
- Dangerous command warnings (rm, sudo) with confirmation prompts
- Export history to custom folders
- **Git integration** - Interactive diff viewer, branch switching, commit/push/pull
- **Git PRs** - Create, list, merge, checkout PRs with conflict resolution helpers (GitHub-first)
- Runs on Node.js or Bun

## Git Integration

The CLI includes a dedicated Git menu (`g` in expand mode) for common operations:

| Feature | Description |
|---------|-------------|
| **Status** | View working tree status with file counts |
| **Diff** | Enhanced color-coded diff viewer (all/staged/file) |
| **Branches** | Interactive branch switching (local + remote), create, delete |
| **Commit** | Stage changes and commit with message |
| **Push/Pull** | Sync with remote repository |
| **Log** | View commit history |

When not in a git repository, the menu offers to initialize one with `git init`.

## Git PRs

The CLI includes a dedicated Git PRs menu for GitHub (and GitLab/Bitbucket if their CLIs are installed):

| Feature | Description |
|---------|-------------|
| **Create PR** | Prompt for title/description and base branch (auto-detected) |
| **List PRs** | View open/closed PRs and open in browser |
| **Merge PR** | Merge with conflict detection and guided resolution |
| **Checkout PR** | Checkout PR locally using the platform CLI |
| **PR Actions** | Comment, assign, request review, close/reopen (GitHub CLI) |

If a merge fails, the CLI offers:
- Open GitHub’s conflict resolver in a browser
- Step-by-step local resolution guide (with editor preference)
- Resume conflict sessions per PR

## Performance

**Optimized with lazy loading** for fast startup and low memory usage:

| Runtime | Startup Time | Memory | Notes |
|---------|--------------|--------|-------|
| Bun (direct) | ~46ms | ~53MB | Fastest - runs TypeScript directly |
| Node.js | ~78ms | ~53MB | Requires build step |
| Bun (bundled) | ~161ms | ~53MB | 1.9MB self-contained bundle |

### Performance Optimizations
- **Lazy loading** - Heavy modules (inquirer, ora, glob) load only when needed
- **Deferred initialization** - Database and config load on first use
- **Minimal startup path** - `--help` and `--version` don't load unnecessary modules

Run performance benchmarks:

```bash
npm run test:benchmark    # Automated benchmark tests
npm run perf              # Interactive performance testing
```

## Development

```bash
npm install
npm run build        # Build Node.js version
npm run build:bun    # Build Bun version
npm run build:all    # Build both versions
npm test             # Run all tests (73 tests)
npm run test:benchmark  # Run performance benchmarks
```

Tests are fully isolated and don't affect your real session data.

## Code organization

- `src/commands.ts` is the main entrypoint for the interactive loop and public exports.
- `src/commands/` contains focused modules (history, git, sessions, database, mappings, config, search, compound, execute-core, menu stack, and helpers).
