# v1 Release Criteria

This document defines the concrete bar for Hakobu v1.0.0. A release candidate
can only be promoted to v1 when every item below is met. This is an auditable
checklist, not an aspirational roadmap.

## 1. Guaranteed targets

These targets must have published base binaries, pass the full fixture matrix
(packaged + unpackaged), and produce working executables.

### v1-required (Tier 1)

All four must be green. Any failure blocks the release.

| Target | Base binary | Fixtures (packaged) | Status |
|---|---|---|---|
| `linux-x64` | Published | CI job required | Ready |
| `linux-arm64` | Published | CI job required | Ready |
| `win-x64` | Published | CI job required | **Blocked** — packaged fixtures not yet running on Windows |
| `macos-arm64` | Published | CI job required | Ready |

### v1-supported (Tier 2)

Must have published base binaries. Fixture failures are high-priority bugs
but do not block the release.

| Target | Base binary | Status |
|---|---|---|
| `macos-x64` | Published | Ready |
| `linuxstatic-x64` | Published | Ready |

### Explicitly excluded from v1

| Target | Reason |
|---|---|
| `linuxstatic-arm64` | Toolchain blocker (muslcc GCC / C++20) |
| `alpine-*` | Not built |
| `win-arm64` | No runner, no base binary |
| `linux-x86` | Not in scope |

## 2. Guaranteed runtime features

These must work in packaged executables on all Tier 1 targets. Each has a
corresponding fixture that must pass.

### Module system

| Feature | Fixture | Status |
|---|---|---|
| Pure CJS (`require`, `__dirname`, `__filename`, JSON) | `pure-cjs` | Passing |
| Pure ESM (`import`, `import.meta.url`, `node:*`) | `esm-basic` | Passing |
| Mixed ESM/CJS (`createRequire()` from ESM) | `mixed-cjs-esm` | Passing |
| `package.json` `"exports"` map (main + subpath) | `esm-exports-imports` | Passing |
| `package.json` `"imports"` map (`#specifiers`) | `esm-exports-imports` | Passing |
| `"type": "module"` / `"type": "commonjs"` boundaries | `package-type-field` | Passing |
| `import.meta.url` → `fileURLToPath` → `fs.readFileSync` | `import-meta-url` | Passing |
| Dynamic `import()` with static string path | `dynamic-import` | Passing |
| Dynamic `import()` of `node:*` builtins | `dynamic-import` | Passing |

### Child processes and workers

| Feature | Fixture | Status |
|---|---|---|
| `spawnSync` / `spawn` with child script files | `spawn-exec` | Passing |
| Environment variable inheritance to children | `spawn-exec` | Passing |
| Exit code propagation from children | `spawn-exec` | Passing |
| Custom stdio arrays (`pipe`) | `spawn-exec` | Passing |
| `fork()` with IPC message passing | `fork-ipc` | Passing |
| `Worker` with `workerData` and `parentPort` messages | `worker-threads` | Passing |

### Native addons and externals

| Feature | Fixture | Status |
|---|---|---|
| `process.dlopen` availability | `addons` | Passing |
| `.node` file error handling (MODULE_NOT_FOUND) | `addons` | Passing |
| `process.config` for node-gyp compatibility | `addons` | Passing |
| `process.execPath` pointing to packaged binary | `external-artifact` | Passing |
| Exec-relative path construction for externals | `external-artifact` | Passing |
| Environment variable lookup for externals | `external-artifact` | Passing |

## 3. v1 release gate: CI jobs

These CI jobs must all be green on the release candidate commit.

### From `release.yml`

| Job | What it validates | Required |
|---|---|---|
| `validate` | Build, config tests, node-only fixtures, version match | Yes |
| `fixtures` | Full fixture matrix on macOS (packaged vs unpackaged) | Yes |

### From `ci.yml` (must be green on the commit before tagging)

| Job | What it validates | Required |
|---|---|---|
| `fast` | Build, config tests (16), node-only fixtures (12) | Yes |
| `fixtures-macos` | Full matrix on macOS arm64 (12 fixtures, packaged) | Yes |
| `fixtures-linux` | Full matrix on Linux x64 (12 fixtures, packaged) | Yes |
| `windows-smoke` | Build, config tests, node-only fixtures on Windows | Yes |

### Required additions before v1

| Job | What it validates | Status |
|---|---|---|
| `fixtures-windows` | Full fixture matrix on Windows (packaged) | **Not yet implemented** |
| `playwright-windows` | Windows Playwright/Camoufox handshake (Task 8.4) | **Not yet implemented** |

## 4. v1 release gate: executable proof

Unit tests and node-only fixture passes are necessary but **not sufficient**
for v1. The following executable-proof gates are required:

### Fixture matrix gates

Every release candidate must demonstrate:

1. **All 12 fixtures pass packaged on macOS arm64** — the primary development
   target. Zero drift between packaged and unpackaged.

2. **All 12 fixtures pass packaged on Linux x64** — the primary deployment
   target. Zero drift.

3. **All 12 fixtures pass packaged on Windows x64** — the primary desktop
   target. Zero drift. **Not yet running.**

4. **Zero semantic drift** — the comparison harness (`fixtures/run.js`) must
   report no drift between node and packaged output for any fixture on any
   platform.

### Real-world validation gate

At least one non-trivial external project must package and run successfully
on each Tier 1 platform. The current validation target is
`camoufox-ts/example`, which:

- Bundles 482 modules via Rolldown
- Launches a Playwright-controlled Camoufox browser
- Completes a 4-site benchmark with browser automation

This validation has been completed on macOS arm64. It must also pass on:
- [ ] Linux x64
- [ ] Windows x64 (Task 8.4 — requires `juggler-pipe` stdio validation)

### Windows Playwright/Camoufox gate (Task 8.4)

The Windows gate requires:

1. Package the Camoufox example with Hakobu on Windows
2. The packaged executable launches Camoufox via `-juggler-pipe`
3. The Playwright WebSocket/pipe handshake completes
4. At least one page navigation succeeds

This gate is **explicitly required for v1** even though it is not yet
implemented. v1 cannot ship without it.

## 5. Documentation gates

These docs must exist and be current at v1:

| Document | Status |
|---|---|
| `docs/migration-from-pkg.md` | Done |
| `docs/runtime-support.md` | Done |
| `docs/bundle-mode.md` | Done |
| `docs/target-policy.md` | Done |
| `docs/release-contract.md` | Done |
| `docs/verification-contract.md` | Done |
| `docs/maintenance.md` | Done |
| `docs/v1-release-criteria.md` | This document |
| CLI `--help` with examples | Done |

## 6. What is explicitly NOT in v1

These items are intentionally deferred. They are not v1 blockers.

| Item | Reason |
|---|---|
| V8 bytecode compilation | Complexity; source-only mode is correct and simpler |
| Snapshot compression | Not needed for correctness |
| Multi-target builds | By design; run hakobu once per target |
| `--options` (V8 flags) | Low priority; can be added post-v1 |
| `linuxstatic-arm64` | Toolchain blocker |
| `alpine-*` targets | Not yet built |
| Code-split bundle mode | Single-chunk is correct; multi-chunk is optimization |
| Source maps in bundle mode | Rolldown limitation |
| `process.execPath -e` in packaged mode | Inherited limitation; workaround exists |

## 7. v1 release checklist

When all criteria above are met, the release proceeds as follows:

1. [ ] All 12 fixtures pass packaged on macOS arm64 (CI green)
2. [ ] All 12 fixtures pass packaged on Linux x64 (CI green)
3. [ ] All 12 fixtures pass packaged on Windows x64 (CI green)
4. [ ] Windows Playwright/Camoufox gate passes (Task 8.4)
5. [ ] Zero semantic drift on all three platforms
6. [ ] Config normalization tests pass (16/16)
7. [ ] External validation (camoufox-ts/example) passes on macOS
8. [ ] All docs listed in Section 5 are current
9. [ ] Package versions set to `1.0.0` in both package.json files
10. [ ] Tag `v1.0.0` and push
11. [ ] `release.yml` workflow completes: npm publish + GitHub Release

## Current v1 readiness

| Requirement | Status |
|---|---|
| macOS arm64 fixtures (packaged) | Done |
| Linux x64 fixtures (packaged) | CI ready, not yet validated locally |
| Windows x64 fixtures (packaged) | **Blocked** — CI job not yet implemented |
| Windows Playwright/Camoufox gate | **Blocked** — Task 8.4 not started |
| Config tests | Done (16/16) |
| External validation (macOS) | Done (camoufox-ts/example, 4/4 benchmarks) |
| Documentation | Done (8 docs) |
| Release workflow | Done |

**Bottom line:** Hakobu is v1-ready on macOS arm64 and likely Linux x64.
The two remaining blockers are both Windows-specific: packaged fixture CI
on Windows, and the Playwright/Camoufox stdio gate. These are concrete,
scoped, and actionable.
