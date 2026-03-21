# Maintenance and Security

This document is for Hakobu maintainers. It covers the inherited codebase,
patch ownership, update procedures, and security-sensitive areas.

## Fork lineage

Hakobu is forked from:

| Upstream | Version | Hakobu package |
|---|---|---|
| `@yao-pkg/pkg` | v6.14.1 | `@hakobu/hakobu` |
| `@yao-pkg/pkg-fetch` | v3.5.32 | `@hakobu/hakobu-fetch` |

`@yao-pkg/pkg` is itself a fork of `vercel/pkg` (archived). The chain is:
`vercel/pkg` → `@yao-pkg/pkg` → `@hakobu/hakobu`.

## Inherited patches

### Node C++ patches

The core of Hakobu's packaging model is a set of C++ patches applied to the
Node.js source before compilation. These patches enable:

1. **Snapshot blob embedding** — the patched binary reads a payload blob
   appended to itself at startup.
2. **Sourceless V8 bytecode** — `vm.Script` supports `sourceless: true` for
   loading cached bytecode without original source.
3. **`PKG_EXECPATH` environment variable** — allows the binary to detect
   whether it's running as a packaged app or plain Node.

**Patch files:**
- `packages/hakobu-fetch/patches/node.v24.14.0.cpp.patch`
- `packages/hakobu-fetch/patches/patches.json` (metadata)

**When to update patches:**
- When Node 24 releases a new minor/patch version (e.g., v24.15.0)
- When the patch targets change (new C++ files in Node's source)
- When a security fix in Node requires re-patching

**How to update:**
1. Download the new Node source tarball
2. Apply the existing patch and resolve any conflicts
3. Build and verify on all Tier 1 targets
4. Update `patches.json` and `expected-shas.json`
5. Run `build-bases.yml` with `publish_release: true`

### JavaScript prelude

The runtime bootstrap is in `packages/hakobu/prelude/bootstrap.js`. This is
the JavaScript code injected into every packaged executable. It patches:

- `fs` module (read operations redirect to snapshot)
- `Module._resolveFilename` and `Module.prototype._compile` (CJS loading)
- `child_process` (injects `PKG_EXECPATH` into child environments)
- `process.dlopen` (extracts native addons from snapshot)

**Security note:** The prelude runs with full access to the Node.js runtime.
Changes to the prelude affect every packaged application. Review prelude
changes carefully.

### ESM hooks

Hakobu's ESM support is implemented via `module.registerHooks()` (Node 24 API).
The hooks are generated at packaging time and injected as a CJS shim
(`__hakobu_esm_shim__.cjs`) into the snapshot. They handle:

- `resolve`: snapshot path resolution, `#imports`, `exports` maps, bare specifiers
- `load`: reading source from the snapshot filesystem

The hooks run in the main thread (not a hooks worker) because they need
access to the prelude's patched `fs`.

## Security surface

### Areas requiring regular audit

| Area | Risk | What to check |
|---|---|---|
| **Node patches** | Supply chain | Patch source matches upstream Node. Verify against `nodejs.org` SHASUMs. |
| **Base binary checksums** | Integrity | `expected-shas.json` must match published release artifacts. |
| **Prelude injection** | Code execution | The prelude runs arbitrary JS in every packaged app. Audit for injection. |
| **Native addon extraction** | File write | Addons are extracted to `~/.hakobu/addons/`. Verify path traversal safety. |
| **Child process env** | Info leak | `PKG_EXECPATH` is injected into all child process environments. |
| **Bundle mode patching** | Code rewrite | Post-bundle patches rewrite `require()` calls. Verify patterns are specific. |

### Dependency audit checklist

Run periodically:

```bash
# Check for known vulnerabilities
pnpm audit

# Check for outdated dependencies
pnpm outdated -r

# Key dependencies to watch:
#   @babel/* — used for AST analysis (potential ReDoS in parser)
#   esbuild — used in inherited code (potential supply chain)
#   rolldown — optional bundler (active development, API changes)
#   semver — version parsing (potential ReDoS)
```

### Base binary provenance

Every published base binary has provenance recorded in `PROVENANCE.json`
attached to its GitHub Release. This includes:

- Node source URL and SHA-256
- Patch file SHA-256
- Build date and CI run ID
- Per-target binary SHA-256

To verify a base binary:
```bash
# Download and check hash
sha256sum hakobu-base-v24.14.0-linux-x64
# Compare against expected-shas.json or PROVENANCE.json
```

## Node version update procedure

When a new Node 24.x patch is released:

1. **Check if patches apply cleanly:**
   ```bash
   cd packages/hakobu-fetch
   # Download new Node source
   # Apply patch, resolve conflicts
   ```

2. **Update version references:**
   - `packages/hakobu-fetch/patches/patches.json`
   - `packages/hakobu-fetch/lib/expected-shas.json` (clear old hashes)
   - `.github/workflows/build-bases.yml` (`NODE_VERSION` env var)

3. **Build and verify:**
   - Run `build-bases.yml` workflow
   - All 6 targets must build and pass verification
   - Run the full fixture matrix against new bases

4. **Publish:**
   - Run `build-bases.yml` with `publish_release: true`
   - Update `expected-shas.json` with new hashes
   - Bump `@hakobu/hakobu-fetch` version
   - Release via `release.yml`

## Areas with special maintenance risk

### 1. Prelude ↔ Node version coupling

The prelude uses internal Node APIs:
- `require('internal/modules/cjs/helpers')` (Node 18+)
- `require('internal/modules/helpers')` (Node 24)
- `process.binding('fs')` for `internalModuleStat` / `internalModuleReadJSON`
- `require('internal/util').customPromisifyArgs`

These internals can change between Node versions. When updating the Node
version line, test the prelude against the new internals carefully.

### 2. Mach-O patching

`packages/hakobu/lib/mach-o.ts` patches the `__LINKEDIT` segment of macOS
executables after payload injection. This is sensitive to Mach-O format
changes in new Xcode / macOS versions.

The packager also strips and re-signs the code signature (`codesign -f --sign -`).
macOS code signing requirements may change with OS updates.

### 3. V8 bytecode format

The `sourceless` V8 bytecode feature is a non-standard patch. V8 bytecode
format changes between Node versions and is not stable. Currently Hakobu uses
`bytecode: false` (source-only mode), which avoids this risk. If bytecode
compilation is re-enabled in the future, V8 version compatibility must be
validated.

### 4. `module.registerHooks()` stability

The ESM hooks use `module.registerHooks()` which was introduced in Node 23.
If this API changes in a future Node version, the ESM shim generation in
`packager.ts` must be updated.

## Inherited issues to track

| Issue | Source | Status | Impact |
|---|---|---|---|
| `PKG_EXECPATH` naming | inherited from vercel/pkg | Active — rename to `HAKOBU_EXECPATH` pending | Low (env var name only) |
| Multi-target builds | inherited from pkg | By design — single target only | Low (documented) |
| `process.execPath -e` | inherited from pkg | Known limitation | Low (workaround: use script files) |
| Bytecode version mismatch | inherited from pkg | Avoided (source-only mode) | None currently |
| Windows stdio pipe bug | inherited from pkg | Deferred (Task 8.4) | Medium for Windows Playwright |
