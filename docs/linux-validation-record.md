# Linux Validation Record

Manual validation for the external Linux x64 consumer-project proof.

## Date

2026-03-21

## Environment

- **Build machine:** macOS arm64 (Apple Silicon)
- **Test machine:** Linux x64
- **Hakobu version:** 0.1.0
- **Node version in base binary:** v24.14.0
- **Target:** `node24-linux-x64`

## How the executable was produced

Cross-compiled on macOS using Hakobu's `--bundle` mode with
`--target node24-linux-x64`:

```bash
node packages/hakobu/lib-es5/bin.js ~/Documents/camoufox-ts/example \
  --bundle --entry src/cli.ts \
  --target node24-linux-x64 \
  --output ~/Desktop/camoufox-example-linux-x64
```

The bundler (Rolldown) compiled the example app into bundled JavaScript and
Hakobu packaged it with the linux-x64 base binary into an ELF executable.

## Consumer project

`~/Documents/camoufox-ts/example` — the same real Playwright/Camoufox
benchmark app used for macOS and Windows validation.

## Commands validated

### 1. Setup

```bash
./camoufox-example-linux-x64 setup
```

**Result:** Completed successfully after the `@rankforge/camoufox` runtime path
was updated to use `node:child_process` instead of unguarded `Bun.spawnSync`
during Unix install steps.

### 2. Benchmark

```bash
./camoufox-example-linux-x64 benchmark --headless
```

**Result:** Completed successfully. The packaged executable installed the
browser, launched Camoufox, and ran the benchmark flow on Linux x64.

## Key findings

1. **Hakobu cross-target packaging works for linux-x64.** The executable built
   on macOS ran correctly on Linux without changes to Hakobu itself.
2. **The earlier Linux failure was a Camoufox-side runtime bug, not a Hakobu
   packaging issue.** The failure happened after download/extract and was caused
   by runtime use of `Bun.spawnSync` in a Node/Hakobu execution path.
3. **The external consumer project now works across all Tier 1 Hakobu targets**
   once its runtime library code avoids Bun-only assumptions in Node paths.
