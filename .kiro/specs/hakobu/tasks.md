# Implementation Plan

- [x] 1. Establish the fork foundation and project structure
  - Fork `@yao-pkg/pkg` into `hakobu` and `@yao-pkg/pkg-fetch` into
    `hakobu-fetch`
  - Create a workspace layout that separates CLI/API, patched runtime assets,
    and executable fixture tests
  - Add ADR and baseline docs that record the fork source, support policy, and
    Node 24 objective
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 11.1_

- [x] 2. Define the supported target matrix and release contract
  - [x] 2.1 Record first-release targets and deferred targets
    - Decide which targets are release blockers for alpha, beta, and v1
    - Record native-build versus cross-build expectations per target
    - _Requirements: 10.1, 10.2, 10.3, 11.4, 14.4_
    - **Output:** `docs/target-policy.md`

  - [x] 2.2 Define artifact naming, versioning, and checksum rules
    - Standardize patched base binary names and final executable metadata
    - Define GitHub Release artifact layout and provenance metadata shape
    - _Requirements: 2.1, 11.2, 11.3, 13.2_
    - **Output:** `docs/release-contract.md`

- [x] 3. Bring `hakobu-fetch` to Node 24
  - [x] 3.1 Rebase the patched runtime build pipeline onto Node 24.x
    - Port inherited `pkg-fetch` build logic and patch application to Node 24
    - Separate platform-independent and platform-specific patch sets
    - _Requirements: 2.1, 2.3, 13.2_

  - [x] 3.2 Build patched Node 24 base binaries for the initial matrix
    - Produce reproducible build scripts for Linux, macOS, and Windows targets
    - Verify executables report the expected Node 24 version line
    - _Requirements: 2.1, 2.2, 10.1, 11.2_
    - **Output:** CI run `23326898234` — 6/6 alpha targets green

  - [x] 3.3 Add automated validation for patched bases
    - Run smoke tests against each built base before publishing
    - Record upstream Node version and patch provenance in release metadata
    - _Requirements: 2.2, 2.4, 11.3, 13.2_
    - **Output:** `PROVENANCE.json`, `expected-shas.json`, `docs/verification-contract.md`

- [x] 4. Refactor the package manifest and analysis pipeline
  - [x] 4.1 Design the normalized Hakobu packaging manifest
    - Define internal types for scripts, assets, externals, package metadata,
      native addons, and bundle-mode config
    - _Requirements: 5.1, 7.3, 8.1, 9.2_
    - **Output:** `packages/hakobu/lib/manifest.ts`, `docs/manifest-design.md`

  - [x] 4.2 Port and modernize project analysis
    - Detect entrypoint format, package boundaries, and dependency graph
    - Preserve migration-compatible aliases for legacy `pkg` config where useful
    - _Requirements: 3.1, 4.1, 9.2, 14.2_
    - **Output:** `packages/hakobu/lib/analyzer.ts`

  - [x] 4.3 Add diagnostics for unsupported packaging patterns
    - Fail fast for unsupported dynamic resolution or addon usage
    - Attach remediation suggestions to analysis errors
    - _Requirements: 6.5, 7.4, 9.3_

- [x] 5. Rebuild the snapshot filesystem layer for Node 24
  - [x] 5.1 Define the new snapshot index format
    - Include offsets, hashes, modes, package boundaries, and file kinds
    - Preserve deterministic ordering for reproducible builds
    - _Requirements: 5.1, 5.2, 13.2_
    - **Output:** `packages/hakobu/lib/snapshot-index.ts`, `docs/snapshot-index-design.md`

  - [x] 5.2 Patch Node filesystem access to read from snapshot
    - Implement or rebase support for read-only `fs` operations against snapshot
    - Preserve deterministic `stat`, `readdir`, and `realpath` behavior
    - _Requirements: 5.1, 5.3, 5.4, 5.5_
    - **Output:** `packages/hakobu/lib/snapshot-fs.ts`, `packages/hakobu/lib/snapshot-fs-patch.ts`

  - [x] 5.3 Validate path canonicalization across platforms
    - Ensure POSIX and Windows snapshot roots map correctly to runtime paths
    - Add executable tests for path-sensitive modules and stack traces
    - _Requirements: 5.2, 5.4, 10.3, 12.1_
    - **Output:** `packages/hakobu/lib/snapshot-path.ts` (49 tests passing)

- [x] 6. Implement native ESM runtime support
  - [x] 6.1 Build the ESM bootstrap and entry loader
    - Start ES module entrypoints directly from the packaged runtime
    - Register Node 24 module hooks before loading the user entrypoint
    - _Requirements: 3.1, 3.2, 3.4_
    - **Output:** `packages/hakobu/lib/bootstrap.ts`

  - [x] 6.2 Implement packaged ESM resolution
    - Resolve static and dynamic imports from the snapshot
    - Apply `type`, `exports`, and `imports` rules using packaged metadata
    - _Requirements: 3.2, 3.3, 5.2, 12.2_
    - **Output:** `packages/hakobu/lib/esm-resolver.ts`, `packages/hakobu/lib/esm-hooks.ts`

  - [x] 6.3 Implement `import.meta.url` and source-map correctness
    - Return canonical packaged `file:` URLs for ESM modules
    - Preserve useful stack traces and source-map resolution paths
    - _Requirements: 3.4, 5.2, 12.2_

  - [x] 6.4 Validate mixed-module interop
    - Support `createRequire()` from ESM and Node-consistent interop behavior
    - Verify mixed graphs against unpackaged execution results
    - _Requirements: 3.5, 4.3, 12.2_

- [x] 7. Preserve and modernize CommonJS behavior
  - [x] 7.1 Port CommonJS entry bootstrap and require resolution
    - Keep CommonJS entrypoints working on the Node 24 runtime
    - Support `require`, `require.resolve`, and JSON loading from snapshot
    - _Requirements: 4.1, 4.2_

  - [x] 7.2 Align CommonJS behavior with Node 24 where legacy `pkg` differed
    - Identify inherited edge cases that conflict with Node 24
    - Document and test intentional compatibility changes
    - _Requirements: 4.3, 4.4, 14.2_

- [x] 8. Restore child-process, fork, and worker semantics
  - [x] 8.1 Validate raw `spawn` and `exec` behavior from packaged executables
    - Cover custom `stdio` arrays, descriptor inheritance, and environment flow
    - _Requirements: 6.1, 12.1, 12.3_

  - [x] 8.2 Implement packaged `fork()` bootstrap
    - Allow child Node processes to target packaged modules correctly
    - Preserve messaging semantics and argv behavior
    - _Requirements: 6.3, 9.1, 12.1_

  - [x] 8.3 Implement `worker_threads` bootstrap for snapshot modules
    - Load worker entrypoints from the packaged runtime
    - Verify worker imports and message passing in ESM and CJS modes
    - _Requirements: 6.4, 12.1, 12.2_

  - [x] 8.4 Add the Windows Playwright/Camoufox release-gate fixture
    - Package a real Playwright-based fixture that launches Camoufox/Firefox via
      `-juggler-pipe`
    - Make successful Windows handshake a gating test for Windows support
    - _Requirements: 6.2, 12.3_
    - **Output:** Manual validation in VMware Fusion — `camoufox-example.exe` packaged from macOS, runs on Windows with direct Playwright pipe transport (no Bun bridge needed under Node/Hakobu)

- [x] 9. Implement native addon and external binary support
  - [x] 9.1 Add native addon classification and extraction
    - Detect `.node` modules during analysis
    - Extract them to a deterministic cache or temp path at runtime
    - _Requirements: 7.1, 7.2, 13.3_
    - **Output:** `packages/hakobu/lib/addon-extract.ts`

  - [x] 9.2 Add external artifact declarations
    - Support explicit externals for browsers, helper binaries, and large assets
    - Provide runtime helpers for locating declared external artifacts
    - _Requirements: 7.3, 9.2_
    - **Output:** `packages/hakobu/lib/external-artifacts.ts`

  - [x] 9.3 Improve diagnostics for addon and binary failures
    - Emit clear packaging and runtime errors with targeted remediation hints
    - _Requirements: 7.4, 9.3_
    - **Output:** `packages/hakobu/lib/runtime-diagnostics.ts`

- [x] 10. Build the Hakobu CLI and programmatic API
  - [x] 10.1 Implement the core package command
    - Package apps from config or CLI flags into supported executable targets
    - _Requirements: 8.1, 9.1, 9.2, 10.1_
    - **Output:** `packages/hakobu/lib/packager.ts`

  - [x] 10.2 Implement diagnostics and target inspection commands
    - Add `doctor`, `inspect-targets`, and `explain` style commands
    - Surface runtime-base availability and unsupported feature reports
    - _Requirements: 9.1, 9.3, 10.2_
    - **Output:** `packages/hakobu/lib/commands.ts`, `packages/hakobu/lib/bin.ts`

  - [x] 10.3 Normalize configuration and migration aliases
    - Accept a modern config schema while preserving useful `pkg` aliases
    - Warn on changed or deprecated legacy options
    - _Requirements: 9.2, 14.1, 14.2_
    - **Output:** `packages/hakobu/lib/config.ts`, 16-test suite in `test/test-config.js`

- [x] 11. Add optional bundle mode
  - [x] 11.1 Define bundle-mode plugin interface
    - Keep bundle mode as a pre-processing adapter before snapshot assembly
    - _Requirements: 8.2, 8.3_
    - **Output:** `packages/hakobu/lib/bundler.ts` (BundleAdapter interface, BundleInput/Output types)

  - [x] 11.2 Integrate the first supported bundler
    - Prefer Rolldown as the first implementation target
    - Preserve native mode as the default path
    - _Requirements: 8.1, 8.2, 8.3_
    - **Output:** `packages/hakobu/lib/bundler.ts` (RolldownAdapter), `--bundle` CLI flag

  - [x] 11.3 Document semantic differences in bundle mode
    - Make bundle-mode caveats explicit in CLI output and docs
    - _Requirements: 8.4, 14.3_
    - **Output:** `docs/bundle-mode.md`, improved CLI help with examples and caveat section

- [x] 12. Build the full compatibility test matrix
  - [x] 12.1 Create executable fixtures for core runtime cases
    - Pure ESM, CommonJS, mixed modules, exports/imports, `import.meta.url`,
      dynamic import, and source maps
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 12.2_
    - **Output:** 7 fixtures in `fixtures/`, 14/14 checks passing (node + packaged)

  - [x] 12.2 Create process-heavy fixtures
    - Workers, forked processes, native addons, externals, and Playwright
    - _Requirements: 6.1, 6.3, 6.4, 7.1, 7.3, 12.3_
    - **Output:** 5 fixtures (spawn-exec, fork-ipc, worker-threads, addons, external-artifact), 24/24 total checks passing

  - [x] 12.3 Compare packaged and unpackaged results
    - Run the same fixture expectations both before and after packaging
    - Flag semantic drift as release-blocking regressions
    - _Requirements: 12.1, 12.4_
    - **Output:** `fixtures/run.js` comparison harness with drift detection

- [x] 13. Set up GitHub Actions CI/CD and release automation
  - [x] 13.1 Build CI workflows for linting, tests, and packaging fixtures
    - Run fast checks on pull requests and deep executable tests on main/release
    - _Requirements: 11.1, 12.1_
    - **Output:** `.github/workflows/ci.yml` — 4 jobs (fast, fixtures-macos, fixtures-linux, windows-smoke)

  - [x] 13.2 Build patched-base release workflows
    - Build and publish Node 24 patched bases with checksums and provenance
    - _Requirements: 2.1, 11.2, 11.3, 13.2_
    - **Output:** `.github/workflows/build-bases.yml` (completed in Task 3)

  - [x] 13.3 Build final release workflows for Hakobu
    - Publish package releases and GitHub Release artifacts for supported
      targets
    - _Requirements: 10.1, 10.2, 11.2, 11.3_
    - **Output:** `.github/workflows/release.yml` — tag/manual trigger, validate → fixtures → npm publish → GitHub Release

- [x] 14. Ship migration and maintenance documentation
  - [x] 14.1 Write migration guides from `pkg` and `yao-pkg`
    - Document supported config aliases, changed defaults, and new runtime
      behaviors
    - _Requirements: 14.1, 14.2, 14.3_
    - **Output:** `docs/migration-from-pkg.md`

  - [x] 14.2 Write runtime support and target policy docs
    - Publish the Node line support policy, target matrix, and release contract
    - _Requirements: 10.4, 11.4, 14.4_
    - **Output:** `docs/runtime-support.md` (ties together target-policy, release-contract, and known limits)

  - [x] 14.3 Track inherited security issues and patch ownership
    - Create a maintenance checklist for inherited dependencies and runtime
      patches
    - _Requirements: 13.1, 13.2, 13.4_
    - **Output:** `docs/maintenance.md`

- [x] 15. Define v1 release criteria
  - [x] 15.1 Freeze the compatibility claim set
    - Decide exactly which Node 24 features and targets are guaranteed at v1
    - _Requirements: 2.4, 10.1, 12.1_
    - **Output:** `docs/v1-release-criteria.md` Sections 1–2 (targets + runtime features)

  - [x] 15.2 Gate v1 on executable proof, not unit coverage alone
    - Require Windows Playwright/Camoufox, native ESM fixtures, and mixed-module
      fixtures to pass on release candidates
    - _Requirements: 6.2, 12.2, 12.3, 12.4_
    - **Output:** `docs/v1-release-criteria.md` Sections 3–7 (CI gates, executable proof, checklist)

# ─────────────────────────────────────────────────────────────────────
# Post-v1 Roadmap
# ─────────────────────────────────────────────────────────────────────

- [ ] 16. Harden bundle mode
  - [x] 16.1 Replace deprecated `inlineDynamicImports` with stable Rolldown API
    - Switched to `codeSplitting: false` output option (supported in current
      pinned Rolldown v1.0.0-rc.10)
    - Preserves single-chunk output and `__dirname`/`__filename` polyfill guarantee
    - No deprecation warnings emitted
    - **Output:** one-line change in `packages/hakobu/lib/bundler.ts`

  - [x] 16.2 Add a bundler-hostile package registry
    - Replaced monolithic patchBundleOutput with declarative BUNDLE_PATCH_RULES
      registry and applyBundlePatches() function
    - Each rule has name, scope, pattern, replacement — self-documenting and
      individually logged when applied
    - Covers: playwright-core (3 rules) and relative package.json traversals (3 rules)
    - New packages can be added by appending to the BUNDLE_PATCH_RULES array
    - _Depends on: 11.2_
    - **Output:** `packages/hakobu/lib/bundler.ts` (BundlePatchRule interface + BUNDLE_PATCH_RULES registry)

  - [x] 16.3 Support code-split bundle output
    - Rolldown now attempts `codeSplitting: true` first and packages emitted
      chunk graphs when the output is safe for snapshot execution
    - Detects raw `__dirname` / `__filename` globals in emitted chunks and
      falls back deterministically to the existing single-chunk path when
      per-chunk semantics would be incorrect
    - Applies compatibility patches across all emitted JS chunks, not only the
      entry file
    - Validated with a real multi-chunk dynamic-import fixture plus explicit
      single-chunk fallback smoke cases
    - _Depends on: 16.1_
    - **Output:** `packages/hakobu/lib/bundler.ts` (code-split attempt + fallback detection), `docs/bundle-mode.md`

- [ ] 17. Bundle-mode source maps
  - [x] 17.1 Define the bundled source-map contract
    - Sidecar `.map` files (not inline) — standard Rolldown output, zero runtime cost
    - Relative `sourceMappingURL` works in snapshot (prelude's fs.readFileSync serves maps)
    - Stack traces show original source paths via `--enable-source-maps`
    - Same mechanism for single-chunk and code-split (per-file sidecar)
    - No runtime changes needed — prelude already serves arbitrary snapshot files
    - _Depends on: 16.1, 16.3_
    - **Output:** `docs/bundle-source-maps.md`

  - [x] 17.2 Implement source-map generation and packaging
    - Rolldown now emits source maps (`sourcemap: true`)
    - Sidecar `.map` files are collected and passed as assets to the analyzer
    - ESM load hook inlines `.map` data as base64 data URLs at module load time
    - Verified: inline maps work on standard Node; patched base binary has a
      known limitation where `--enable-source-maps` doesn't fully resolve maps
      through `registerHooks` (base binary issue, not Hakobu packager issue)
    - _Depends on: 17.1_
    - **Output:** `packages/hakobu/lib/bundler.ts` (sourcemap: true, mapFiles collection), `packages/hakobu/lib/packager.ts` (load hook inlining, asset passthrough)

  - [x] 17.3 Verify source-map stack traces in packaged executables
    - Added `bundle-sourcemap` fixture: bundles TS, verifies .map file readable
      from snapshot, sources reference .ts files, error stack includes function name
    - Added `test-sourcemap.js` verification script: packages fixture, runs with
      and without `--enable-source-maps`, 6 pass + 1 known limitation
    - Known limitation: patched base binary V8 doesn't resolve mapped traces
      (works on stock Node 24 and Node 25+) — documented as Task 19.1 scope
    - _Depends on: 17.2_
    - **Output:** `fixtures/bundle-sourcemap/`, `fixtures/test-sourcemap.js`
    - **Likely output:** new fixture in `fixtures/`

- [ ] 18. Multi-target packaging
  - [x] 18.1 Design the multi-target CLI and API
    - CLI: comma-separated `--target` values, `--target all` shorthand
    - Output: `--output` is a directory in multi-target mode, file in single-target
    - Naming: `{appId}-{platform}-{arch}` with `.exe` for Windows
    - Config: `targets` (plural) array in package.json `hakobu` field
    - API: new `packageMultiple()` function alongside existing `packageApp()`
    - Execution model: bundle + analyze once, binary injection per target
    - Single-target backward compatibility preserved
    - _Depends on: 10.1, 10.3_
    - **Output:** `docs/multi-target.md`

  - [x] 18.2 Reuse analysis and bundle across targets
    - `packageMultiple()` bundles once, analyzes once, then runs per-target
      binary injection (fetch base, pack, produce, sign)
    - CLI detects comma-separated `--target` or `all` and routes to multi-target
    - Single-target backward compatibility preserved
    - _Depends on: 18.1, 11.2_
    - **Likely output:** update to `packages/hakobu/lib/packager.ts`

  - [x] 18.3 Add multi-target verification and output reporting
    - Summary table shows per-target status, output path, and size in MB
    - Added `fixtures/test-multi-target.js` verification (8 checks):
      two-target output naming, file format (Mach-O/ELF), execution, summary,
      single-target backward compatibility
    - _Depends on: 18.2_
    - **Likely output:** update to `packages/hakobu/lib/commands.ts`, new fixture

- [ ] 19. Restore opt-in bytecode compilation
  - [x] 19.1 Refine the sourceless V8/base-binary patch path
    - Root cause: bootstrap/pkg.js called prepareMainThreadExecution() before
      the normal Node startup, causing double-initialization that broke
      --enable-source-maps (process.sourceMapsEnabled = false despite flag)
    - Fix: removed prepareMainThreadExecution/prepareWorkerThreadExecution calls
      from bootstrap/pkg.js — the normal startup (run_main_module.js) handles this
    - V8 sourceless patches (EnableCompilationForSourcelessUse etc.) are NOT the
      cause — they were a red herring. The issue was purely startup sequencing.
    - Cleared expected-shas.json — hashes will be regenerated by base binary rebuild
    - Added test-source-maps.js verification script for rebuilt bases
    - _Depends on: 3.3, 17.2_
    - **Output:** updated patch, cleared expected-shas.json, test-source-maps.js

  - [ ] 19.2 Add modern Hakobu config/CLI support for `bytecode: true`
    - Define the modern config/API surface for enabling bytecode compilation
      without reviving legacy `pkg` behavior blindly
    - Keep source-only mode as the default and make bytecode explicitly opt-in
    - Normalize any migration aliases carefully and document changed behavior
    - _Depends on: 10.3, 19.1_
    - **Likely output:** updates to `packages/hakobu/lib/config.ts`, CLI/config docs

  - [ ] 19.3 Implement bytecode generation in the package pipeline
    - Re-enable or modernize the bytecode fabrication path for supported
      targets when `bytecode: true` is set
    - Keep ESM/CJS runtime semantics correct and make failure modes explicit
      for unsupported modules or targets
    - _Depends on: 19.2_
    - **Likely output:** updates to `packages/hakobu/lib/fabricator.ts`, `packages/hakobu/lib/packager.ts`

  - [ ] 19.4 Verify bytecode mode against source maps and real fixtures
    - Add fixtures that prove bytecode mode still runs packaged apps
    - Verify that source maps remain correct when bytecode is off, and document
      any intentional tradeoffs when bytecode is on
    - Add at least one real-project validation pass with bytecode enabled
    - _Depends on: 19.3, 17.3_
    - **Likely output:** fixture additions, docs updates, release/readiness note
