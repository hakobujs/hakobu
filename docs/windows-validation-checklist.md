# Windows Playwright/Camoufox Validation (Task 8.4)

Manual validation checklist for the final v1 release gate. Run in VMware
Fusion with a Windows 10/11 VM, or on a physical Windows machine.

## Prerequisites

### On the Windows machine

1. **Node.js 24.x** — download from https://nodejs.org/en/download
   ```powershell
   node --version   # must be v24.x
   ```

2. **pnpm** — install via Node's corepack or standalone
   ```powershell
   corepack enable
   corepack prepare pnpm@10.7.1 --activate
   pnpm --version
   ```

3. **Git** — for cloning the repo
   ```powershell
   git --version
   ```

4. **Internet access** — needed to fetch the win-x64 base binary and
   download the Camoufox browser

### Shared folder (VMware Fusion)

If using VMware Fusion, share the macOS `~/Documents` folder or copy the
repos to the Windows VM. You need two directories:

- `hakobujs/` — the Hakobu monorepo
- `camoufox-ts/` — the consumer project monorepo

## Step 1: Build Hakobu on Windows

```powershell
cd C:\Users\<you>\Documents\hakobujs
pnpm install
pnpm build
```

Verify:
```powershell
node packages\hakobu\lib-es5\bin.js --version
# Expected: 0.1.0
```

## Step 2: Bundle the consumer project

The consumer project is TypeScript with workspace dependencies. Use
Hakobu's `--bundle` mode to compile it.

```powershell
node C:\Users\<you>\Documents\hakobujs\packages\hakobu\lib-es5\bin.js ^
  C:\Users\<you>\Documents\camoufox-ts\example ^
  --bundle ^
  --entry src/cli.ts ^
  --output C:\Users\<you>\Desktop\camoufox-example.exe
```

### Expected output

```
Bundling project (single-chunk, __dirname shimmed)...
  bundler: rolldown
  entry: src/cli.ts
  output: ~500KB bundled
Analyzing project...
  entry: /snapshot/camoufox-example/index.js (esm)
Target: node24-win-x64
Fetching base binary...
  base: C:\Users\<you>\.hakobu\cache\v0.1\fetched-v24.14.0-win-x64
Building payload...
Writing C:\Users\<you>\Desktop\camoufox-example.exe...
Done.
```

### If this fails

| Error | Likely cause | Fix |
|---|---|---|
| `Rolldown not found` | rolldown not installed | `cd hakobujs && pnpm install` |
| `Bundle entry not found` | Wrong path to camoufox-ts | Fix the path |
| `Base binary fetch failed` | No internet or GitHub rate limit | Retry, or check network |
| `Build failed` | TypeScript or dependency issue | Check the bundler error output |

## Step 3: Smoke test the executable

```powershell
C:\Users\<you>\Desktop\camoufox-example.exe --help
```

### Expected output

```
camoufox-example v1.0.0

USAGE
  camoufox-example <command> [options]

COMMANDS
  benchmark    Run fingerprint detection benchmarks against test sites
  captcha      Test Camoufox against CAPTCHA demos from 2captcha.com
  setup        Install Camoufox browser and all dependencies
```

### If this fails

| Error | Likely cause |
|---|---|
| `Cannot find module` | Hakobu packaging bug — snapshot path issue |
| `SyntaxError: Cannot use import` | ESM shim Windows path issue |
| Windows Defender blocks | Add exception or run from trusted location |
| No output at all | Base binary issue — try running with `PKG_EXECPATH=PKG_INVOKE_NODEJS` |

## Step 4: Install Camoufox browser

```powershell
C:\Users\<you>\Desktop\camoufox-example.exe setup
```

### Expected output

```
App root: C:\Users\<you>\.trafficforge
Checking Bun runtime (required for browser launch on Windows)...
Bun runtime ready
Installing data files...
9 JSON data files installed
Downloading binary data files...
Camoufox not installed. Fetching...
Installed: v135.0.1-beta.24
Browser: C:\Users\<you>\.trafficforge\browser
Setup complete!
```

### What to verify

- [ ] Bun runtime is installed (the setup command auto-installs it on Windows)
- [ ] Browser binary exists at `C:\Users\<you>\.trafficforge\browser\camoufox.exe`
- [ ] Data files exist at `C:\Users\<you>\.trafficforge\data\`

### If this fails

| Error | Likely cause |
|---|---|
| `fetch` errors | Network issue in VM |
| `EACCES` or permission errors | Run as Administrator or fix path permissions |
| `Bun runtime` install fails | Manual install: https://bun.sh/docs/installation |

## Step 5: Run the benchmark (the actual gate)

```powershell
C:\Users\<you>\Desktop\camoufox-example.exe benchmark --headless
```

### What to verify during the run

- [ ] **Executable starts** — no crash, no SyntaxError
- [ ] **Browser binary found** — `Launching Camoufox browser...` appears
- [ ] **Bun runtime bridge works** — no timeout or pipe errors (Windows uses
      WebSocket via Bun, not direct pipe)
- [ ] **Playwright connects** — `UA: Mozilla/5.0 ...` fingerprint info appears
- [ ] **Page navigation works** — at least one test site loads
- [ ] **Benchmark completes** — `=== Summary ===` with pass/warn/fail counts

### Expected success output

```
=== Camoufox Fingerprint Benchmark ===
Mode: headless
Target OS: windows
Launching Camoufox browser...
UA: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) ...
Platform: Win32

[1/4] Testing Navigator Properties...
  Navigator Properties — Xms
[2/4] Testing BrowserLeaks...
  BrowserLeaks — Xms
[3/4] Testing CreepJS...
  CreepJS — Xms
[4/4] Testing BrowserScan...
  BrowserScan — Xms

=== Summary ===
X passed, Y warnings, Z failed
```

**The gate passes if:**
- The executable starts without errors
- The browser launches via the Bun runtime bridge
- At least 1 test site loads and returns results
- No Hakobu-specific errors (snapshot, path, module resolution)

Browser test failures (Cloudflare blocks, captcha widget not detected) are
NOT Hakobu failures — they are network/fingerprint issues.

### If this fails

| Error | Category | What it means |
|---|---|---|
| `SyntaxError: Cannot use import` | **Hakobu bug** | ESM shim not loading correctly on Windows |
| `Cannot find module '/snapshot/...'` | **Hakobu bug** | Snapshot path resolution broken |
| `Browser launch timed out (60s)` | **Camoufox/Bun** | Bun runtime bridge failed. Check `bun --version`. |
| `ENOENT: camoufox.exe` | **Setup** | Browser not installed. Run `setup` first. |
| `WebSocket connection refused` | **Camoufox** | Bun launcher script didn't start the server. Check stderr. |
| `Navigation timeout` | **Network** | VM network issue. Not a Hakobu problem. |
| Windows Defender / firewall popup | **Environment** | Allow through firewall. Not a Hakobu problem. |

## Step 6: Record results

After running, record:
1. Did the executable start? (Step 3)
2. Did setup complete? (Step 4)
3. Did the browser launch? (Step 5)
4. How many tests passed?
5. Any errors — copy the full output

## Architecture reference

```
camoufox-example.exe (Hakobu-packaged Node 24)
  │
  ├─ ESM shim (registerHooks) loads the bundled app
  │
  ├─ AsyncCamoufox.create()
  │   ├─ configure({ appName: 'trafficforge' })
  │   │   └─ browserDir = C:\Users\<you>\.trafficforge\browser
  │   │
  │   ├─ [Windows only] _launchBrowserServerViaBunRuntime()
  │   │   ├─ writes temp launch script
  │   │   ├─ spawns: bun run temp-script.js
  │   │   │   └─ firefox.launchServer({ executablePath: ...\camoufox.exe })
  │   │   │       └─ Camoufox browser via -juggler-pipe (pipe works in Bun runtime)
  │   │   └─ reads WS_ENDPOINT from stdout
  │   │
  │   └─ firefox.connect(wsEndpoint)
  │       └─ Playwright controls browser via WebSocket
  │
  └─ benchmark tests run via Playwright page API
```

The key difference from macOS/Linux: Windows uses a **WebSocket bridge**
via Bun runtime instead of direct `-juggler-pipe` stdio. This avoids a
known pipe handling bug in compiled Node/Bun binaries on Windows.
