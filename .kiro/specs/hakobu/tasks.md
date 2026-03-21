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

- [ ] 4. Refactor the package manifest and analysis pipeline
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

- [ ] 8. Restore child-process, fork, and worker semantics
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

  - [ ] 8.4 Add the Windows Playwright/Camoufox release-gate fixture
    - Package a real Playwright-based fixture that launches Camoufox/Firefox via
      `-juggler-pipe`
    - Make successful Windows handshake a gating test for Windows support
    - _Requirements: 6.2, 12.3_

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

- [ ] 10. Build the Hakobu CLI and programmatic API
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

- [ ] 11. Add optional bundle mode
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

- [ ] 12. Build the full compatibility test matrix
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

- [ ] 13. Set up GitHub Actions CI/CD and release automation
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

- [ ] 14. Ship migration and maintenance documentation
  - [ ] 14.1 Write migration guides from `pkg` and `yao-pkg`
    - Document supported config aliases, changed defaults, and new runtime
      behaviors
    - _Requirements: 14.1, 14.2, 14.3_

  - [ ] 14.2 Write runtime support and target policy docs
    - Publish the Node line support policy, target matrix, and release contract
    - _Requirements: 10.4, 11.4, 14.4_

  - [ ] 14.3 Track inherited security issues and patch ownership
    - Create a maintenance checklist for inherited dependencies and runtime
      patches
    - _Requirements: 13.1, 13.2, 13.4_

- [ ] 15. Define v1 release criteria
  - [ ] 15.1 Freeze the compatibility claim set
    - Decide exactly which Node 24 features and targets are guaranteed at v1
    - _Requirements: 2.4, 10.1, 12.1_

  - [ ] 15.2 Gate v1 on executable proof, not unit coverage alone
    - Require Windows Playwright/Camoufox, native ESM fixtures, and mixed-module
      fixtures to pass on release candidates
    - _Requirements: 6.2, 12.2, 12.3, 12.4_

