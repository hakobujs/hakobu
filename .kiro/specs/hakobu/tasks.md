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
    - Root cause: base binary is built with `--without-node-options` which
      disables `NODE_OPTIONS` processing — `--enable-source-maps` via env
      has no effect on the packaged binary
    - Fix: ESM shim calls `process.setSourceMapsEnabled(true)` programmatically
      before registering hooks and importing the entry. This bypasses the
      `NODE_OPTIONS` limitation entirely.
    - V8 sourceless patches and double-init were both red herrings
    - Source map verification: 7/7 passed, 0 known limitations
    - _Depends on: 3.3, 17.2_
    - **Output:** `packages/hakobu/lib/packager.ts` (setSourceMapsEnabled in ESM shim)

  - [x] 19.2 Add modern Hakobu config/CLI support for `bytecode: true`
    - Config: `hakobu.bytecode: true` in package.json
    - CLI: `--bytecode` flag
    - Source-only remains default; bytecode is explicitly opt-in
    - Before 19.3: requesting bytecode fails with a clear "not yet implemented"
      error and actionable guidance to remove the option
    - Legacy `--no-bytecode` updated to reference new `--bytecode` flag
    - _Depends on: 10.3, 19.1_
    - **Output:** `packages/hakobu/lib/config.ts`, `packages/hakobu/lib/packager.ts`, `packages/hakobu/lib/bin.ts`

  - [x] 19.3 Implement bytecode generation in the package pipeline
    - CJS scripts get STORE_BLOB (V8 bytecode) via the inherited fabricator
    - ESM scripts remain source-only (vm.Script is CJS-only)
    - --bytecode + --bundle rejected explicitly (bundle produces ESM)
    - Source-only default path unchanged (bytecode: false)
    - Verified: CJS app packages and runs with bytecode, 25/25 fixtures green
    - _Depends on: 19.2_
    - **Output:** `packages/hakobu/lib/packager.ts` (manifestToRecords bytecode, packer bytecode flag)

  - [x] 19.4 Verify bytecode mode against source maps and real fixtures
    - Added `fixtures/test-bytecode.js` (8 checks): CJS bytecode packaging,
      cross-module require, JSON require, bundle rejection, ESM source-only
      behavior, import.meta, source-only backward compat
    - Fixed fabricator hang: added shutdownFabricator() after producer finishes
    - Fixed fabricator binary: bytecode mode uses patched base binary (with
      sourceless support) instead of host Node
    - Updated docs/runtime-support.md with bytecode mode section
    - _Depends on: 19.3, 17.3_
    - **Output:** `fixtures/test-bytecode.js`, `docs/runtime-support.md`, fabricator fixes in `packager.ts`

# ─────────────────────────────────────────────────────────────────────
# Post-19 Roadmap
# ─────────────────────────────────────────────────────────────────────

- [ ] 20. Release hardening and RC process
  - [x] 20.1 Define a formal release-candidate gate
    - Added `rc-gate` job to ci.yml that depends on all platform fixture jobs
    - Runs source-map (7 checks), bytecode (8 checks), and multi-target (8 checks)
      verification as the final combined RC signal
    - Produces a GitHub Step Summary with pass/fail table
    - A commit is RC-ready when `rc-gate` is green
    - Updated v1-release-criteria.md to reference the RC gate
    - _Depends on: 13.3, 15.2_
    - **Output:** `rc-gate` job in `.github/workflows/ci.yml`, docs update

  - [x] 20.2 Add npm publish dry-run and tarball verification
    - Added `npm pack --dry-run` steps in the RC gate for both packages
    - Verifies critical files are present: lib-es5/index.js, bin.js, packager.js,
      index.d.ts, prelude/bootstrap.js, expected-shas.json, patches.json
    - Fails the RC gate if any required file is missing from the tarball
    - Full file listing logged in a collapsible group for manual review
    - _Depends on: 13.3_
    - **Output:** publish dry-run steps in `rc-gate` job in `.github/workflows/ci.yml`

  - [x] 20.3 Add changelog generation
    - Added `scripts/generate-changelog.js`: reads git log between tags,
      parses conventional commit format, groups by type (feat/fix/docs/ci/etc.)
    - Integrated into `release.yml`: generates changelog before GitHub Release
      creation, uses `--notes-file` instead of `--generate-notes`
    - Zero external dependencies — uses git log + Node string parsing
    - _Depends on: 13.3_
    - **Output:** `scripts/generate-changelog.js`, updated `release.yml`

- [ ] 21. Cache and fetch robustness
  - [x] 21.1 Add integrity verification on cached base binaries
    - Fetched binaries: SHA-256 verified against expected-shas.json before use
    - Built binaries: size check rejects files <1MB as corrupted (valid Node >30MB)
    - On mismatch/corruption: cached file is deleted, falls through to re-fetch
      or rebuild
    - HAKOBU_NODE_PATH: still trusted without hash check (user-provided)
    - _Depends on: 3.3_
    - **Output:** `packages/hakobu-fetch/lib/index.ts` (cache verification in `need()`)

  - [x] 21.2 Add parallel base binary fetching for multi-target builds
    - `packageMultiple()` now pre-fetches all base binaries via
      `Promise.allSettled()` before the per-target assembly loop
    - Each target has a unique platform-arch → no cache file races
    - Failed fetches produce per-target errors without blocking other targets
    - Per-target assembly then hits cache instantly (already verified by 21.1)
    - Single-target `packageApp()` unchanged
    - _Depends on: 18.2_
    - **Output:** parallel pre-fetch in `packageMultiple()` in `packages/hakobu/lib/packager.ts`

  - [x] 21.3 Support offline/air-gapped packaging
    - `HAKOBU_OFFLINE=1` env var prevents all download and build-from-source
    - If cache has a valid binary → packaging proceeds without network
    - If cache misses → immediate clear error with the exact path to populate
    - Integrity verification (21.1) still runs on cached binaries
    - Documented in docs/runtime-support.md with cache pre-population workflow
    - _Depends on: 21.1_
    - **Output:** offline gate in `packages/hakobu-fetch/lib/index.ts`, docs update

- [x] 22. Broader real-world fixture coverage
  - [x] 22.1 Add a real npm-dependency fixture
    - Added `fixtures/npm-dependency/` with picocolors + minimist from npm
    - Verifies: module loaded, functions work, arg parsing correct,
      require.resolve works for npm packages
    - Fixed directory tree in manifestToRecords: intermediate dirs (like
      `node_modules/`) now get STORE_LINKS entries so CJS resolution works
    - 27/27 fixture matrix passes (up from 25)
    - _Depends on: 12.1_
    - **Output:** `fixtures/npm-dependency/`, directory tree fix in `packager.ts`

  - [x] 22.2 Add a native addon fixture with a real compiled .node file
    - Created `fixtures/native-addon/` with a tiny Node-API C addon
      (add, multiply, version) built via node-gyp
    - Updated `fixtures/run.js` to auto-build native addons before running
      (detects `binding.gyp`, tries `node-gyp` then `npx node-gyp`, skips
      gracefully if no compiler available)
    - Verifies: addon loads via require(), native functions return correct
      results, require.resolve returns .node path
    - In packaged mode, validates the prelude's dlopen extraction path
    - _Depends on: 9.1, 12.2_
    - **Output:** `fixtures/native-addon/`, build support in `fixtures/run.js`

  - [x] 22.3 Add a bytecode + CJS multi-module fixture
    - Added circular-require multi-module test to `fixtures/test-bytecode.js`
    - Module graph: index → registry ↔ processor (circular), utils, config.json
    - Verifies: initialization order preserved under bytecode, CJS partial
      exports visible during circular require (earlyValue yes, lateValue no),
      cross-module function calls, JSON loading alongside bytecode, and
      exact output match between bytecode and plain Node baseline
    - 15/15 bytecode tests pass (up from 8), 7 new circular tests
    - _Depends on: 19.4_
    - **Output:** circular bytecode tests in `fixtures/test-bytecode.js`

- [x] 23. Artifact signing and distribution ergonomics
  - [x] 23.1 Add macOS notarization support
    - Updated `signMachOExecutable()` to accept a signing identity
      (ad-hoc remains the default when no identity is configured)
    - Developer ID signing uses hardened runtime + secure timestamp
      (both required for Apple notarization)
    - Added `notarizeMachOExecutable()`: zip → notarytool submit --wait →
      stapler staple → cleanup
    - Added `--sign-identity` and `--notarize` CLI flags
    - Added `HAKOBU_SIGN_IDENTITY`, `HAKOBU_APPLE_ID`,
      `HAKOBU_APPLE_PASSWORD`, `HAKOBU_APPLE_TEAM_ID` env vars
    - Options flow through both `packageApp` and `packageMultiple`
    - Clear error messages when notarization credentials are missing
    - Non-macOS targets silently ignore `--notarize`
    - Full docs at `docs/macos-notarization.md` covering prerequisites,
      CI setup, troubleshooting, and verification
    - _Depends on: 10.1_
    - **Output:** `mach-o.ts`, `packager.ts`, `bin.ts`, `docs/macos-notarization.md`

  - [x] 23.2 Add Windows Authenticode signing support
    - Created `packages/hakobu/lib/windows-sign.ts` with
      `signWindowsExecutable()` — tries signtool.exe first, falls
      back to osslsigncode for cross-platform signing from macOS/Linux
    - SHA-256 hash, RFC 3161 timestamp (DigiCert default, configurable)
    - Added `--win-cert` and `--win-cert-password` CLI flags
    - Added `HAKOBU_WIN_CERT`, `HAKOBU_WIN_CERT_PASSWORD`,
      `HAKOBU_WIN_TIMESTAMP_URL` env vars
    - Options flow through `packageApp` and `packageMultiple`
    - Unsigned is the default when no cert is configured
    - Non-Windows targets silently ignore Windows signing options
    - Full docs at `docs/windows-signing.md` covering certificate
      types (OV/EV), PFX export, CI setup, cross-signing, troubleshooting
    - _Depends on: 10.1_
    - **Output:** `windows-sign.ts`, `packager.ts`, `bin.ts`, `docs/windows-signing.md`

  - [x] 23.3 Add output metadata injection
    - Created `packages/hakobu/lib/pe-metadata.ts` with `injectPeMetadata()`
      using resedit (pure-JS PE resource editor, works cross-platform)
    - Supported Windows PE fields: ProductName, FileDescription,
      CompanyName, LegalCopyright, FileVersion, ProductVersion, icon (.ico)
    - Config via `"hakobu": { "metadata": { ... } }` in package.json
    - CLI flags: `--product-name`, `--file-description`, `--company-name`,
      `--file-version`, `--product-version`, `--icon` (override config)
    - Injection runs after packaging, before signing (correct ordering)
    - macOS/Linux: not supported — Mach-O and ELF have no embedded
      metadata format (macOS uses .app bundles, Linux uses .desktop files)
    - Added resedit as dependency
    - Full docs at `docs/exe-metadata.md` covering supported fields,
      platform limitations, programmatic API, and troubleshooting
    - _Depends on: 10.1_
    - **Output:** `pe-metadata.ts`, `packager.ts`, `bin.ts`, `config.ts`,
      `docs/exe-metadata.md`

- [ ] 24. macOS application bundle output
  - [x] 24.1 Generate `.app` bundle structure from packaged executable
    - Added `--app-bundle` CLI flag and `appBundle` config option
    - When enabled for macOS targets, produces standard `.app` bundle:
      `MyApp.app/Contents/MacOS/<binary>`, `Contents/Info.plist` (minimal),
      `Contents/Resources/` (empty, for icons in 24.3)
    - Producer writes to a temp path; `createAppBundle()` moves the
      executable into the bundle and generates a minimal Info.plist
      (CFBundleExecutable, CFBundleName, CFBundlePackageType)
    - `--output` specifies the `.app` path; `.app` is auto-appended if
      missing
    - Raw executable output remains the default; `.app` is opt-in
    - Clear error if `--app-bundle` is used with non-macOS targets
    - Verification: 9/9 tests pass (bundle structure, inner executable
      runs, auto-append, default raw output unchanged)
    - _Depends on: 10.1, 23.1_
    - **Output:** `app-bundle.ts`, `packager.ts`, `bin.ts`, `config.ts`,
      `fixtures/test-app-bundle.js`

  - [x] 24.2 Generate `Info.plist` with app metadata
    - Expanded `generatePlist()` in `app-bundle.ts` to emit:
      CFBundleIdentifier, CFBundleVersion, CFBundleShortVersionString,
      CFBundleDisplayName, NSHumanReadableCopyright (in addition to
      the required CFBundleExecutable, CFBundleName, CFBundlePackageType)
    - Config via `"hakobu": { "macos": { bundleId, bundleVersion,
      shortVersion, displayName, copyright } }` in package.json
    - CLI overrides: `--bundle-id`, `--bundle-version`, `--short-version`,
      `--display-name`, `--copyright`
    - Sensible defaults when metadata is omitted: CFBundleIdentifier
      derived as `com.hakobu.<appName>`, CFBundleVersion defaults to
      `1.0.0`, CFBundleShortVersionString defaults to bundleVersion
    - Minimal bundle (no metadata) still works with valid defaults
    - 16/16 verification tests pass (5 new metadata, 2 new defaults)
    - _Depends on: 24.1_
    - **Output:** `app-bundle.ts`, `packager.ts`, `bin.ts`, `config.ts`,
      `fixtures/test-app-bundle.js`

  - [x] 24.3 Support `.icns` application icon in bundles
    - Added `icon` field to `MacosBundleMetadata` and `hakobu.macos`
      config shape
    - CLI flag: `--macos-icon <path>` (overrides config)
    - When configured: copies `.icns` to `Contents/Resources/` and
      adds `CFBundleIconFile` to `Info.plist`
    - Validates input: rejects non-`.icns` files with clear error
      pointing to `iconutil` for conversion
    - When no icon configured: bundle is valid, no `CFBundleIconFile`
    - 20/20 verification tests pass (4 new: icon placement, plist
      reference, no-icon plist clean, non-.icns rejection)
    - _Depends on: 24.2_
    - **Output:** `app-bundle.ts`, `bin.ts`, `config.ts`,
      `fixtures/test-app-bundle.js`

  - [ ] 24.4 Integrate signing and notarization with `.app` bundles
    - When `--sign-identity` is set and output is a `.app` bundle,
      sign the entire bundle (not just the inner binary) with
      `codesign --deep --sign <identity> --options runtime --timestamp`
    - When `--notarize` is set, zip the `.app` bundle and submit it
      (notarytool accepts `.app` inside a zip)
    - Staple the ticket to the `.app` bundle
    - Document differences from raw-executable signing
    - _Depends on: 23.1, 24.1_
    - **Output:** updated signing/notarization flow for bundles,
      docs update in `docs/macos-notarization.md`

  - [ ] 24.5 Add fixture / verification for `.app` output
    - Create a fixture that packages a simple project as `.app`,
      verifies bundle structure, `Info.plist` content, and that the
      executable inside runs correctly
    - _Depends on: 24.2_
    - **Output:** `.app` bundle fixture or verification script

- [ ] 25. Linux desktop and distribution artifacts
  - [ ] 25.1 Generate AppDir-style directory output
    - Add an `--appdir` (or `--format appdir`) output mode for Linux targets
    - Generate the standard AppDir layout:
      `<AppDir>/usr/bin/<binary>`, `<AppDir>/usr/share/applications/<name>.desktop`,
      `<AppDir>/usr/share/icons/hicolor/<size>/apps/<name>.png`,
      `<AppDir>/AppRun` (launcher script)
    - Raw executable output remains the default; AppDir is opt-in
    - _Depends on: 10.1_

  - [ ] 25.2 Generate `.desktop` file from metadata
    - Produce a valid `.desktop` entry from config / CLI metadata:
      Name, Comment, Exec, Icon, Categories, Terminal
    - Read from `"hakobu": { "linux": { ... } }` in package.json
    - Sensible defaults: Name from package name, Exec pointing to the
      binary, Terminal=true for CLI apps
    - CLI overrides: `--desktop-name`, `--desktop-categories`,
      `--desktop-terminal` (reuse `--product-name`, `--file-description`
      where they map cleanly)
    - Validate against the Desktop Entry Specification
    - _Depends on: 25.1_
    - **Output:** `.desktop` generator, config/CLI plumbing, docs

  - [ ] 25.3 Support PNG icon placement for Linux
    - Accept icon path(s) via config (`metadata.linuxIcon`) or CLI
      (`--linux-icon`)
    - Place icons in the hicolor icon theme directory structure:
      `<AppDir>/usr/share/icons/hicolor/{16x16,32x32,48x48,128x128,256x256}/apps/<name>.png`
    - Accept either a single PNG (placed at all sizes) or a directory
      of pre-sized PNGs
    - Also place a copy at `<AppDir>/<name>.png` (AppImage convention)
    - _Depends on: 25.1_
    - **Output:** icon placement logic, config/CLI plumbing

  - [ ] 25.4 Add AppStream metainfo support
    - Generate a minimal `<name>.metainfo.xml` / `<name>.appdata.xml`
      from package.json metadata (name, summary, description, license,
      homepage, version)
    - Place at `<AppDir>/usr/share/metainfo/<name>.metainfo.xml`
    - Validate against `appstreamcli validate` if available
    - _Depends on: 25.2_
    - **Output:** AppStream metainfo generator, docs

  - [ ] 25.5 Optional AppImage packaging
    - When `--format appimage` is specified, produce a self-contained
      `.AppImage` file from the generated AppDir
    - Use `appimagetool` (external, must be in PATH) to assemble the
      AppImage from the AppDir output of 25.1
    - Skip gracefully (with clear error) if `appimagetool` is not
      available — do not bundle it
    - Document where to obtain `appimagetool` and how to integrate it
      into CI
    - _Depends on: 25.1, 25.2, 25.3_
    - **Output:** AppImage assembly step, docs

  - [ ] 25.6 Add fixture / verification for Linux artifacts
    - Create a fixture or verification script that:
      validates AppDir structure, `.desktop` file syntax, icon placement,
      and that the executable inside runs correctly
    - If AppImage is built, verify it is executable and produces correct
      output
    - _Depends on: 25.2_
    - **Output:** Linux artifact fixture or verification script
