# Windows Validation Record

Manual validation for Task 8.4: Windows Playwright/Camoufox release gate.

## Date

2026-03-21

## Environment

- **Build machine:** macOS arm64 (Apple Silicon)
- **Test machine:** Windows 10/11 in VMware Fusion
- **Hakobu version:** 0.1.0 (commit `8b624f4` + Windows ESM shim fixes)
- **Node version in base binary:** v24.14.0
- **Target:** `node24-win-x64`

## How the executable was produced

Cross-compiled on macOS using Hakobu's `--bundle` mode with `--target node24-win-x64`:

```bash
node packages/hakobu/lib-es5/bin.js ~/Documents/camoufox-ts/example \
  --bundle --entry src/cli.ts \
  --target node24-win-x64 \
  --output ~/Desktop/camoufox-example.exe
```

The bundler (Rolldown) compiled 482 TypeScript/workspace modules into a single
4.96MB JS bundle. Hakobu then packaged it with the win-x64 base binary into a
101MB PE32+ executable.

## Consumer project

`~/Documents/camoufox-ts/example` — a real Playwright/Camoufox benchmark app:
- Uses `@rankforge/camoufox` (workspace dependency)
- Uses `@seedcli/core` + `@seedcli/print` (npm dependencies)
- Launches Camoufox browser via Playwright's Firefox channel
- Runs 4 fingerprint benchmark tests against live websites

## Commands validated

### 1. Smoke test

```powershell
.\camoufox-example.exe --help
```

**Result:** CLI help displayed correctly with all 3 commands listed.

### 2. Setup (browser + data installation)

```powershell
.\camoufox-example.exe setup
```

**Result:** Completed successfully.
- Bun runtime was NOT required (direct Node pipe transport used)
- Data files written to `C:\Users\<user>\.trafficforge\data\`
- Browser downloaded to `C:\Users\<user>\.trafficforge\browser\camoufox.exe`

### 3. Benchmark (the actual gate)

```powershell
.\camoufox-example.exe benchmark --headless
```

**Result:** 4/4 benchmark tests completed.
- Camoufox browser launched via direct Playwright pipe transport
- Navigator properties test passed
- BrowserLeaks test passed
- CreepJS test passed
- BrowserScan test passed

## Key findings

1. **Hakobu packaging works correctly on Windows.** Cross-compilation from macOS
   to win-x64 produces a working PE32+ executable with correct snapshot paths
   (`C:\snapshot\...`), ESM hooks, and CJS prelude.

2. **The earlier Bun requirement was a Camoufox-side issue**, not a Hakobu
   issue. The `@rankforge/camoufox` package assumed all Windows execution needed
   a Bun runtime bridge, but this was only necessary for Bun-compiled binaries
   (which have broken fd 3/4 pipe handling). Node.js and Hakobu-packaged
   executables handle pipes correctly.

3. **Direct Playwright pipe transport works on Windows** under Hakobu-packaged
   Node 24 executables. No WebSocket bridge or external Bun runtime needed.

## What was fixed to make this work

### In Hakobu (`hakobujs` repo)

- ESM shim: Windows `C:\snapshot` path handling with `toCanonical()`/`toNative()`
- ESM shim: `pathToFileURL()`/`fileURLToPath()` for cross-platform URLs
- ESM shim: pkgJsons path construction stripped drive letter correctly
- Fixture harness: `.exe` extension, `\r\n` handling, platform-neutral assertions

### In Camoufox (`camoufox-ts` repo)

- Added `detectRuntime()`: distinguishes Node / Bun-runtime / Bun-compiled
- Added `needsBunBridge(transport)`: Bun bridge only for Bun-compiled binaries
- Added `transport` option: `'auto'` (default), `'direct'`, `'bun-bridge'`
- Updated `setup` command: Bun install only when `needsBunBridge()` is true
- Replaced Bun-specific `Bun.spawn`/`Bun.spawnSync` with `node:child_process`
