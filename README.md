# NL Terminal CLI

## TL;DR

Talk to your terminal like a teammate. It translates natural language into real shell commands, remembers what you like, and keeps the gritty stuff (flags, pipes, placeholders) out of your head. Under the hood, it is a fast SQLite brain plus a friendly CLI face.

### Why it exists

- Turn "list all files" into `ls -la` without thinking.
- Teach it your own shortcuts once, then reuse them forever.
- Explore files, run commands, and review history without leaving the terminal.

## Quick start

```bash
bun add -g nl-terminal-cli
nl-terminal
```

## Prerequisites

- Node.js 20.12+ or Bun 1.0+
- A terminal with TTY support for interactive menus

## Install options

### Bun (recommended)

Install globally:

```bash
bun add -g nl-terminal-cli
```

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

### Node.js

```bash
npm install -g nl-terminal-cli
```

From source:

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
- Runs on Node.js or Bun

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
npm test             # Run all tests
npm run test:benchmark  # Run performance benchmarks
```
