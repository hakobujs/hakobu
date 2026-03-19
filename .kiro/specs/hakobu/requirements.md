# Requirements Document

## Introduction

`Hakobu` is a new OSS executable packager for modern Node.js applications. It is
intended to succeed the archived `vercel/pkg` line by forking the current
`@yao-pkg/pkg` and `@yao-pkg/pkg-fetch` codebases, then extending them to
support:

- `Node 24.x` LTS as the primary runtime baseline
- full native ESM behavior at runtime
- continued CommonJS support
- cross-platform executable generation
- compatibility with real-world workloads that depend on Node process semantics,
  including Playwright/Camoufox on Windows

The project is explicitly not a SEA wrapper. The executable runtime shall remain
closer to the traditional `pkg` model: patched Node binaries plus a packaged
snapshot filesystem and runtime bootstrap.

## Non-Goals

- Rebuilding the packager from scratch before validating fork viability
- Requiring users to bundle their app into one file before packaging
- Requiring Vite, Rollup, Rolldown, or esbuild as the primary execution model
- Embedding large external browser binaries by default
- Supporting every historical Node version from day one

## Requirements

### Requirement 1: Fork Foundation

**User Story:** As a maintainer, I want Hakobu to begin from the active
`@yao-pkg/pkg` and `@yao-pkg/pkg-fetch` forks, so that the project can reuse the
existing patched runtime pipeline and deliver value faster than a rewrite.

#### Acceptance Criteria

1. WHEN the project is initialized THEN the system SHALL fork both
   `@yao-pkg/pkg` and `@yao-pkg/pkg-fetch` as the upstream implementation base.
2. WHEN Hakobu behavior differs from the inherited fork behavior THEN the system
   SHALL document the divergence in an ADR or equivalent decision log.
3. IF inherited code blocks `Node 24.x` or native ESM support THEN the system
   SHALL allow invasive refactoring rather than preserving legacy behavior.
4. WHERE legacy `pkg` compatibility does not conflict with the primary goals
   THEN the system SHALL preserve it.

### Requirement 2: Node 24 LTS Runtime Support

**User Story:** As a user, I want Hakobu to target `Node 24.x` LTS, so that the
generated executables match the latest stable Node platform I can adopt in
production.

#### Acceptance Criteria

1. WHEN Hakobu builds runtime bases THEN the system SHALL produce patched
   `Node 24.x` binaries for all supported targets.
2. WHEN a user packages an app for a `Node 24.x` target THEN the executable
   SHALL report the expected Node version family at runtime.
3. IF upstream Node `24.x` patch releases are published THEN the system SHALL
   support rebuilding patched base binaries against those patch releases.
4. WHEN a feature depends on Node internals THEN the implementation SHALL follow
   the `Node 24.x` behavior first and treat older lines as secondary.

### Requirement 3: Native ESM Runtime Support

**User Story:** As a modern Node.js developer, I want packaged executables to
run native ESM applications, so that I do not have to rewrite or down-compile
my app to CommonJS or a single bundle.

#### Acceptance Criteria

1. WHEN the packaged entrypoint is an ES module THEN the executable SHALL start
   it without requiring a CommonJS wrapper.
2. WHEN the app uses static `import` or dynamic `import()` THEN the executable
   SHALL resolve and load modules from the packaged snapshot using Node-like ESM
   semantics.
3. WHEN a package relies on `package.json` `type`, `exports`, or `imports` THEN
   the executable SHALL honor those fields using Node `24.x` rules.
4. WHEN ESM code accesses `import.meta.url` THEN the executable SHALL expose a
   stable module URL that resolves to the packaged module location.
5. IF a packaged app mixes ESM and CommonJS THEN the executable SHALL preserve
   Node interop behavior, including `createRequire()` where applicable.

### Requirement 4: CommonJS Compatibility

**User Story:** As a maintainer of existing Node apps, I want Hakobu to keep
CommonJS support, so that existing `pkg`-style workloads remain viable during
migration.

#### Acceptance Criteria

1. WHEN the packaged entrypoint is CommonJS THEN the executable SHALL start it
   without requiring ESM conversion.
2. WHEN CommonJS code calls `require()` for packaged modules, JSON, or assets
   THEN the executable SHALL resolve them from the packaged snapshot.
3. WHEN CommonJS and ESM modules reference each other THEN the executable SHALL
   preserve Node interop behavior consistent with `Node 24.x`.
4. IF a behavior differs from historical `pkg` due to alignment with Node 24
   semantics THEN the system SHALL document the difference clearly.

### Requirement 5: Snapshot Filesystem Semantics

**User Story:** As a user, I want the executable to behave like it contains a
real read-only application filesystem, so that normal module resolution and
file access keep working.

#### Acceptance Criteria

1. WHEN packaged files are read by Node loaders or `fs` APIs THEN the system
   SHALL serve them from a read-only snapshot filesystem.
2. WHEN a packaged module is resolved THEN the executable SHALL expose a stable
   canonical path or URL for that module.
3. WHEN the app calls `stat`, `readFile`, `readdir`, `realpath`, or equivalent
   on packaged files THEN the executable SHALL return deterministic results.
4. WHEN path-sensitive Node subsystems operate on packaged modules THEN the
   snapshot representation SHALL be compatible with Node `24.x` resolution.
5. WHERE a real writable filesystem is required THEN the system SHALL not
   silently treat the snapshot as writable.

### Requirement 6: Child Processes, Workers, and FD Semantics

**User Story:** As a developer using process-heavy tooling, I want Hakobu
executables to preserve Node child-process and worker behavior, so that tools
like Playwright and Camoufox continue to work on Windows and other platforms.

#### Acceptance Criteria

1. WHEN a packaged app spawns a child process with custom `stdio` entries,
   including descriptors above `2`, THEN the executable SHALL preserve Node
   child-process semantics for those descriptors.
2. WHEN Playwright launches Firefox/Camoufox with `-juggler-pipe` THEN the
   packaged executable SHALL allow the browser handshake to complete on Windows.
3. WHEN a packaged app calls `child_process.fork()` THEN the child SHALL be able
   to execute packaged code with the correct runtime bootstrap.
4. WHEN a packaged app creates `worker_threads` workers from packaged modules
   THEN the workers SHALL resolve and execute those modules correctly.
5. IF the runtime cannot preserve a Node process behavior on a target platform
   THEN the packaging command SHALL fail with a specific diagnostic instead of
   silently producing a broken executable.

### Requirement 7: Native Addons and External Binary Handling

**User Story:** As a developer who depends on `.node` addons or external tools,
I want Hakobu to manage them explicitly, so that packaged apps can still launch
native dependencies correctly.

#### Acceptance Criteria

1. WHEN a packaged app includes native `.node` addons THEN the system SHALL load
   them from a real filesystem path at runtime.
2. WHEN extraction is required for native addons or helper binaries THEN the
   system SHALL use a deterministic cache or temp strategy.
3. WHEN the app includes large external binaries that should not be embedded
   THEN the system SHALL support declaring them as external artifacts.
4. IF an addon or binary cannot be packaged safely THEN the system SHALL report
   a clear packaging error with remediation guidance.

### Requirement 8: Packaging Modes

**User Story:** As a user, I want Hakobu to support native packaging by default
and optional bundle-assisted packaging when needed, so that I can choose between
runtime fidelity and packaging convenience.

#### Acceptance Criteria

1. WHERE no bundle mode is enabled THEN the system SHALL package apps using the
   native snapshot runtime without requiring prebundling.
2. WHEN bundle mode is enabled THEN the system SHALL allow a prebundle step
   before snapshot assembly.
3. WHEN bundle mode is enabled THEN the system SHALL treat it as an optimization
   or compatibility mode, not the only supported execution path.
4. IF bundling changes runtime semantics THEN the system SHALL document those
   differences as bundle-mode limitations.

### Requirement 9: CLI and Programmatic API

**User Story:** As a user, I want a clear CLI and API surface, so that I can
package applications consistently in local development and CI.

#### Acceptance Criteria

1. WHEN a user invokes Hakobu from the CLI THEN the system SHALL expose commands
   to package applications, inspect targets, and diagnose packaging results.
2. WHEN a user configures package assets, scripts, externals, or runtime flags
   THEN the CLI and API SHALL accept equivalent configuration forms.
3. WHEN packaging fails THEN the system SHALL emit actionable diagnostics that
   identify the failing phase and probable remediation.
4. WHERE legacy `pkg` configuration is still meaningful THEN the system SHALL
   provide migration-compatible aliases or warnings.

### Requirement 10: Cross-Platform Targeting

**User Story:** As a maintainer, I want Hakobu to build executables for the main
desktop and server targets, so that it can replace `pkg` in real projects.

#### Acceptance Criteria

1. WHEN patched runtime bases are published THEN the system SHALL provide
   supported targets for at least `linux-x64`, `linux-arm64`, `win-x64`,
   `macos-x64`, and `macos-arm64`.
2. WHEN a target cannot be built or signed in CI THEN the release process SHALL
   mark it explicitly as unsupported or deferred.
3. IF a cross-compiled executable differs from a native-built executable in
   behavior THEN the system SHALL prefer native-built verification for that
   target.
4. WHEN the project expands the matrix THEN the system SHALL version that change
   in release notes and support policy docs.

### Requirement 11: CI/CD and Release Automation

**User Story:** As a maintainer, I want low-cost repeatable CI/CD, so that the
project can build patched runtimes and publish releases sustainably.

#### Acceptance Criteria

1. WHEN the project runs in public OSS mode THEN the primary CI/CD platform
   SHALL be GitHub Actions.
2. WHEN a release is created THEN CI SHALL build or fetch all required runtime
   bases and packaging artifacts for the supported matrix.
3. WHEN release artifacts are published THEN the system SHALL attach them to
   GitHub Releases with checksums and provenance metadata.
4. IF the hosted runner matrix is insufficient THEN the project SHALL allow
   later expansion to paid GitHub plans or self-hosted runners without changing
   the public release contract.

### Requirement 12: Verification and Compatibility Proof

**User Story:** As a maintainer, I want strict compatibility testing, so that
Hakobu can claim native ESM and Node 24 support with evidence rather than
assumption.

#### Acceptance Criteria

1. WHEN runtime features are implemented THEN the project SHALL cover them with
   automated unit, integration, and executable-level tests.
2. WHEN native ESM support is claimed THEN the test suite SHALL include package
   `exports`, `imports`, `import.meta.url`, dynamic `import()`, mixed-module
   interop, and source-map scenarios.
3. WHEN Windows support is claimed THEN the test suite SHALL include a
   Playwright/Camoufox executable smoke test that exercises custom `stdio`
   descriptors.
4. WHEN a release candidate is built THEN the project SHALL verify packaged and
   unpackaged behavior against the same expectation matrix.

### Requirement 13: Security and Supply Chain

**User Story:** As a maintainer, I want the packager to improve on the archived
`pkg` line's maintenance posture, so that users can trust releases over time.

#### Acceptance Criteria

1. WHEN dependencies or inherited code have known security issues THEN the
   system SHALL track and remediate them as part of the fork roadmap.
2. WHEN patched Node bases are built THEN the release pipeline SHALL record the
   upstream Node version and patch provenance.
3. WHEN Hakobu extracts native components at runtime THEN the system SHALL use
   predictable, permission-safe extraction rules.
4. IF a runtime workaround weakens the security model THEN the design SHALL
   document the tradeoff before release.

### Requirement 14: Documentation and Migration

**User Story:** As a user of `pkg` or `yao-pkg`, I want clear migration guides,
so that I can adopt Hakobu without reverse-engineering the new runtime model.

#### Acceptance Criteria

1. WHEN Hakobu reaches public alpha THEN the project SHALL publish migration
   guidance from `pkg` and `yao-pkg`.
2. WHEN a legacy option is changed, removed, or redefined THEN the docs SHALL
   explain the new behavior and migration path.
3. WHEN bundle mode or native mode has limitations THEN the docs SHALL make
   those limits explicit.
4. WHEN releases add or remove supported targets THEN the docs SHALL update the
   target matrix accordingly.

