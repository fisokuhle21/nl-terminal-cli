#!/bin/bash

# Performance testing script for nl-terminal-cli
# Usage: ./scripts/perf-test.sh [command]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
NODE_CLI_PATH="$ROOT_DIR/dist/src/cli.js"
BUN_CLI_PATH="$ROOT_DIR/dist/bun-cli.js"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Check if builds exist
NODE_AVAILABLE=false
BUN_AVAILABLE=false
BUN_INSTALLED=false

if [ -f "$NODE_CLI_PATH" ]; then
    NODE_AVAILABLE=true
fi

if [ -f "$BUN_CLI_PATH" ]; then
    BUN_AVAILABLE=true
fi

if command -v bun &> /dev/null; then
    BUN_INSTALLED=true
fi

# Check if at least one CLI is built
if [ "$NODE_AVAILABLE" = false ] && [ "$BUN_AVAILABLE" = false ]; then
    echo -e "${RED}Error: No CLI build found. Run 'npm run build' first.${NC}"
    exit 1
fi

print_header() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
}

print_subheader() {
    echo -e "\n${MAGENTA}┌─────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${MAGENTA}│ $1${NC}"
    echo -e "${MAGENTA}└─────────────────────────────────────────────────────────────┘${NC}"
}

print_metric() {
    echo -e "${YELLOW}  $1:${NC} $2"
}

# Function to run quick benchmark (multiple iterations) for a specific runtime
run_benchmark_for_runtime() {
    local runtime="$1"
    local cli_path="$2"
    local cmd="$3"
    local label="$4"
    local iterations="${5:-5}"
    
    echo -e "\n${BLUE}[$runtime] Benchmarking: ${label} (${iterations} iterations)${NC}"
    echo -e "${BLUE}Command: $runtime $cli_path $cmd${NC}\n"
    
    local total_time=0
    local times=()
    
    # Warm-up run
    NL_TERMINAL_CLI_TEST=1 $runtime "$cli_path" $cmd > /dev/null 2>&1 || true
    
    for i in $(seq 1 $iterations); do
        local start=$(date +%s%N)
        NL_TERMINAL_CLI_TEST=1 $runtime "$cli_path" $cmd > /dev/null 2>&1
        local end=$(date +%s%N)
        local duration=$(( (end - start) / 1000000 ))
        times+=($duration)
        total_time=$((total_time + duration))
        echo -e "  Run $i: ${duration}ms"
    done
    
    local avg=$((total_time / iterations))
    
    # Calculate min/max
    local min=${times[0]}
    local max=${times[0]}
    for t in "${times[@]}"; do
        (( t < min )) && min=$t
        (( t > max )) && max=$t
    done
    
    echo ""
    print_metric "Average" "${avg}ms"
    print_metric "Min" "${min}ms"
    print_metric "Max" "${max}ms"
    
    # Return average for comparison
    echo "$avg" > /tmp/perf_result_${runtime}
}

# Function to run quick benchmark for both runtimes
run_quick_benchmark() {
    local cmd="$1"
    local label="$2"
    local iterations="${3:-5}"
    
    if [ "$NODE_AVAILABLE" = true ]; then
        run_benchmark_for_runtime "node" "$NODE_CLI_PATH" "$cmd" "$label" "$iterations"
    fi
    
    if [ "$BUN_AVAILABLE" = true ] && [ "$BUN_INSTALLED" = true ]; then
        run_benchmark_for_runtime "bun" "$BUN_CLI_PATH" "$cmd" "$label" "$iterations"
    fi
}

# Function to run with /usr/bin/time (verbose)
run_with_time_verbose() {
    local runtime="$1"
    local cli_path="$2"
    local cmd="$3"
    local label="$4"
    
    echo -e "\n${BLUE}[$runtime] Testing: ${label}${NC}"
    echo -e "${BLUE}Command: $runtime $cli_path $cmd${NC}\n"
    
    if command -v /usr/bin/time &> /dev/null; then
        NL_TERMINAL_CLI_TEST=1 /usr/bin/time -v $runtime "$cli_path" $cmd 2>&1 | grep -E "(Maximum resident set size|User time|System time|Elapsed|CPU)"
    else
        # Fallback for systems without GNU time
        NL_TERMINAL_CLI_TEST=1 time $runtime "$cli_path" $cmd
    fi
}

# Function to run verbose timing for both runtimes
run_verbose_timing() {
    local cmd="$1"
    local label="$2"
    
    if [ "$NODE_AVAILABLE" = true ]; then
        run_with_time_verbose "node" "$NODE_CLI_PATH" "$cmd" "$label"
    fi
    
    if [ "$BUN_AVAILABLE" = true ] && [ "$BUN_INSTALLED" = true ]; then
        run_with_time_verbose "bun" "$BUN_CLI_PATH" "$cmd" "$label"
    fi
}

# Function to check memory with Node.js
run_memory_profile() {
    local cmd="$1"
    local label="$2"
    
    if [ "$NODE_AVAILABLE" = true ]; then
        echo -e "\n${BLUE}[Node.js] Memory Profile: ${label}${NC}"
        echo -e "${BLUE}Command: node $NODE_CLI_PATH $cmd${NC}\n"
        
        node --expose-gc -e "
            const { spawn } = require('child_process');
            const start = process.hrtime.bigint();
            
            global.gc && global.gc();
            const initialMem = process.memoryUsage();
            
            const child = spawn('node', ['$NODE_CLI_PATH', ...'$cmd'.split(' ')], {
                env: { ...process.env, NL_TERMINAL_CLI_TEST: '1', NL_TERMINAL_CLI_DRY_RUN: '1' },
                stdio: 'pipe'
            });
            
            let maxRss = 0;
            const interval = setInterval(() => {
                const mem = process.memoryUsage();
                if (mem.rss > maxRss) maxRss = mem.rss;
            }, 5);
            
            child.on('close', (code) => {
                clearInterval(interval);
                const end = process.hrtime.bigint();
                const finalMem = process.memoryUsage();
                
                console.log('  Duration:', Number(end - start) / 1e6, 'ms');
                console.log('  Peak RSS:', (maxRss / 1024 / 1024).toFixed(2), 'MB');
                console.log('  Heap Used:', (finalMem.heapUsed / 1024 / 1024).toFixed(2), 'MB');
                console.log('  Heap Total:', (finalMem.heapTotal / 1024 / 1024).toFixed(2), 'MB');
                console.log('  External:', (finalMem.external / 1024 / 1024).toFixed(2), 'MB');
                console.log('  Exit Code:', code);
            });
        " 2>/dev/null
    fi
    
    if [ "$BUN_AVAILABLE" = true ] && [ "$BUN_INSTALLED" = true ]; then
        echo -e "\n${BLUE}[Bun] Memory Profile: ${label}${NC}"
        echo -e "${BLUE}Command: bun $BUN_CLI_PATH $cmd${NC}\n"
        
        # Use /usr/bin/time for Bun memory measurement
        if command -v /usr/bin/time &> /dev/null; then
            NL_TERMINAL_CLI_TEST=1 /usr/bin/time -v bun "$BUN_CLI_PATH" $cmd 2>&1 | grep -E "(Maximum resident set size|User time|System time|Elapsed)"
        else
            echo "  (Install GNU time for detailed Bun memory stats)"
            NL_TERMINAL_CLI_TEST=1 time bun "$BUN_CLI_PATH" $cmd
        fi
    fi
}

# Function to run Node.js CPU profiling
run_cpu_profile() {
    local cmd="$1"
    local label="$2"
    
    echo -e "\n${BLUE}[Node.js] CPU Profile: ${label}${NC}"
    echo -e "${BLUE}Output: $ROOT_DIR/*.cpuprofile${NC}\n"
    
    NL_TERMINAL_CLI_TEST=1 node --cpu-prof --cpu-prof-dir="$ROOT_DIR" "$NODE_CLI_PATH" $cmd
    
    echo -e "${GREEN}CPU profile saved. Open in Chrome DevTools (F12 > Performance > Load)${NC}"
}

# Function to compare Node.js vs Bun
run_comparison() {
    local cmd="$1"
    local iterations="${2:-10}"
    
    print_header "NODE.JS vs BUN COMPARISON"
    
    if [ "$NODE_AVAILABLE" = false ]; then
        echo -e "${RED}Node.js build not available${NC}"
        return
    fi
    
    if [ "$BUN_AVAILABLE" = false ] || [ "$BUN_INSTALLED" = false ]; then
        echo -e "${RED}Bun build not available or Bun not installed${NC}"
        return
    fi
    
    print_subheader "STARTUP TIME ($cmd) - $iterations runs, excluding warm-up"
    
    # Node.js benchmark
    echo -e "\n${BLUE}Node.js:${NC}"
    NL_TERMINAL_CLI_TEST=1 node "$NODE_CLI_PATH" $cmd > /dev/null 2>&1 || true  # warm-up
    
    local node_total=0
    for i in $(seq 1 $iterations); do
        local start=$(date +%s%N)
        NL_TERMINAL_CLI_TEST=1 node "$NODE_CLI_PATH" $cmd > /dev/null 2>&1
        local end=$(date +%s%N)
        local ms=$(( (end - start) / 1000000 ))
        node_total=$((node_total + ms))
        printf "  Run %2d: %dms\n" $i $ms
    done
    local node_avg=$((node_total / iterations))
    echo -e "  ${GREEN}Average: ${node_avg}ms${NC}"
    
    # Bun benchmark
    echo -e "\n${BLUE}Bun:${NC}"
    NL_TERMINAL_CLI_TEST=1 bun "$BUN_CLI_PATH" $cmd > /dev/null 2>&1 || true  # warm-up
    
    local bun_total=0
    for i in $(seq 1 $iterations); do
        local start=$(date +%s%N)
        NL_TERMINAL_CLI_TEST=1 bun "$BUN_CLI_PATH" $cmd > /dev/null 2>&1
        local end=$(date +%s%N)
        local ms=$(( (end - start) / 1000000 ))
        bun_total=$((bun_total + ms))
        printf "  Run %2d: %dms\n" $i $ms
    done
    local bun_avg=$((bun_total / iterations))
    echo -e "  ${GREEN}Average: ${bun_avg}ms${NC}"
    
    print_subheader "MEMORY USAGE (Maximum Resident Set Size)              "
    
    local node_mem=$(/usr/bin/time -v node "$NODE_CLI_PATH" $cmd 2>&1 | grep "Maximum resident set size" | awk '{print $6}')
    local bun_mem=$(/usr/bin/time -v bun "$BUN_CLI_PATH" $cmd 2>&1 | grep "Maximum resident set size" | awk '{print $6}')
    
    local node_mem_mb=$(echo "scale=2; $node_mem / 1024" | bc)
    local bun_mem_mb=$(echo "scale=2; $bun_mem / 1024" | bc)
    
    echo -e "  Node.js: ${node_mem_mb} MB"
    echo -e "  Bun:     ${bun_mem_mb} MB"
    
    print_subheader "SUMMARY                                                "
    
    if [ $bun_avg -lt $node_avg ]; then
        local speedup=$(echo "scale=1; $node_avg / $bun_avg" | bc)
        echo -e "  ${GREEN}⚡ Bun is ${speedup}x faster in startup time${NC}"
    else
        local speedup=$(echo "scale=1; $bun_avg / $node_avg" | bc)
        echo -e "  ${GREEN}⚡ Node.js is ${speedup}x faster in startup time${NC}"
    fi
    
    local mem_savings=$(echo "scale=1; 100 - ($bun_mem * 100 / $node_mem)" | bc)
    if (( $(echo "$mem_savings > 0" | bc -l) )); then
        echo -e "  ${GREEN}💾 Bun uses ${mem_savings}% less memory${NC}"
    else
        local mem_more=$(echo "scale=1; -1 * $mem_savings" | bc)
        echo -e "  ${GREEN}💾 Node.js uses ${mem_more}% less memory${NC}"
    fi
}

# Main menu
main() {
    print_header "NL-Terminal-CLI Performance Testing"
    
    echo -e "\n${GREEN}Available Runtimes:${NC}"
    if [ "$NODE_AVAILABLE" = true ]; then
        echo -e "  ${GREEN}✓${NC} Node.js (dist/src/cli.js)"
    else
        echo -e "  ${RED}✗${NC} Node.js (not built)"
    fi
    
    if [ "$BUN_AVAILABLE" = true ] && [ "$BUN_INSTALLED" = true ]; then
        echo -e "  ${GREEN}✓${NC} Bun (dist/bun-cli.js)"
    elif [ "$BUN_INSTALLED" = false ]; then
        echo -e "  ${RED}✗${NC} Bun (not installed)"
    else
        echo -e "  ${RED}✗${NC} Bun (not built - run 'npm run build:bun')"
    fi
    
    echo -e "\n${GREEN}Available Tests:${NC}"
    echo "   1) Quick benchmark (--help)"
    echo "   2) Quick benchmark (--version)"
    echo "   3) Quick benchmark (custom command)"
    echo "   4) Detailed memory profile (--help)"
    echo "   5) Detailed memory profile (custom command)"
    echo "   6) Verbose timing with /usr/bin/time"
    echo "   7) CPU profiling (Node.js only, generates .cpuprofile)"
    echo "   8) Run all basic benchmarks"
    echo "   9) Interactive mode test"
    echo "  10) Node.js vs Bun comparison"
    echo "   0) Exit"
    
    echo ""
    read -p "Select test [0-10]: " choice
    
    case $choice in
        1)
            run_quick_benchmark "--help" "--help command"
            ;;
        2)
            run_quick_benchmark "--version" "--version command"
            ;;
        3)
            read -p "Enter command to benchmark: " custom_cmd
            run_quick_benchmark "$custom_cmd" "Custom: $custom_cmd"
            ;;
        4)
            run_memory_profile "--help" "--help command"
            ;;
        5)
            read -p "Enter command to profile: " custom_cmd
            run_memory_profile "$custom_cmd" "Custom: $custom_cmd"
            ;;
        6)
            read -p "Enter command (or press Enter for --help): " custom_cmd
            custom_cmd="${custom_cmd:---help}"
            run_verbose_timing "$custom_cmd" "$custom_cmd"
            ;;
        7)
            if [ "$NODE_AVAILABLE" = true ]; then
                read -p "Enter command (or press Enter for --help): " custom_cmd
                custom_cmd="${custom_cmd:---help}"
                run_cpu_profile "$custom_cmd" "$custom_cmd"
            else
                echo -e "${RED}Node.js build required for CPU profiling${NC}"
            fi
            ;;
        8)
            print_header "Running All Basic Benchmarks"
            run_quick_benchmark "--help" "--help command"
            run_quick_benchmark "--version" "--version command"
            run_memory_profile "--help" "--help memory"
            ;;
        9)
            echo -e "\n${YELLOW}Select runtime:${NC}"
            echo "  1) Node.js"
            echo "  2) Bun"
            read -p "Choice [1-2]: " rt_choice
            
            echo -e "\n${YELLOW}Starting interactive mode test...${NC}"
            echo -e "${YELLOW}Press Ctrl+C to exit${NC}\n"
            
            if [ "$rt_choice" = "2" ] && [ "$BUN_AVAILABLE" = true ] && [ "$BUN_INSTALLED" = true ]; then
                if command -v /usr/bin/time &> /dev/null; then
                    /usr/bin/time -v bun "$BUN_CLI_PATH"
                else
                    time bun "$BUN_CLI_PATH"
                fi
            else
                if command -v /usr/bin/time &> /dev/null; then
                    /usr/bin/time -v node "$NODE_CLI_PATH"
                else
                    time node "$NODE_CLI_PATH"
                fi
            fi
            ;;
        10)
            read -p "Enter command to compare (or press Enter for --help): " custom_cmd
            custom_cmd="${custom_cmd:---help}"
            run_comparison "$custom_cmd" 10
            ;;
        0)
            echo -e "\n${GREEN}Goodbye!${NC}"
            exit 0
            ;;
        *)
            echo -e "${RED}Invalid option${NC}"
            ;;
    esac
    
    echo ""
    read -p "Press Enter to continue..."
    main
}

# Check for direct command argument
if [ -n "$1" ]; then
    run_quick_benchmark "$*" "Command: $*"
    exit 0
fi

# Run interactive menu
main
