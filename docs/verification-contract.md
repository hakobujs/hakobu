# Base Binary Verification Contract

This document defines what "verified base binary" means for Hakobu and how
CI enforces it.

## Verification Checks

Every patched base binary must pass all three checks before it can be
considered verified. These checks run as part of the `build-bases.yml`
CI workflow.

### 1. Version Check

The binary must report `v24.x` when queried for `process.version`.

```javascript
assert(process.version.startsWith('v24.'), 'Expected v24.x');
```

### 2. ABI Check

The binary must report ABI module version `137` (Node 24's
`NODE_MODULE_VERSION` from `src/node_version.h`).

```javascript
assert(process.versions.modules === '137', 'Expected ABI 137');
```

### 3. V8 Bytecode (Sourceless CachedData)

The binary must support the `sourceless` mode in `vm.Script`. This is
the core capability that enables hakobu's snapshot execution model — it
allows V8 bytecode to be loaded and executed without the original source.

The check verifies three things:

1. `produceCachedData: true` in sourceless mode produces cached data
2. Loading that cached data in sourceless mode executes correctly
3. `produceCachedData: true` in normal mode also produces cached data

```javascript
var text = '(function () { return 42; })';

// Produce cached data in sourceless mode
var s1 = new vm.Script(text, {
  filename: 's1',
  produceCachedData: true,
  sourceless: true
});
assert(s1.cachedDataProduced);

// Execute from cached data without source
var s2 = new vm.Script(undefined, {
  filename: 's2',
  cachedData: s1.cachedData,
  sourceless: true
});
assert.equal(s2.runInThisContext()(), 42);

// Normal mode also works
var s3 = new vm.Script(text, {
  filename: 's3',
  produceCachedData: true
});
assert(s3.cachedDataProduced);
```

## Verification Environment by Target

The environment in which verification runs depends on the target platform
and architecture, per `docs/target-policy.md`:

| Target | Verification Method | Environment |
| --- | --- | --- |
| `linux-x64` | native | ubuntu-latest runner |
| `linux-arm64` | native | ubuntu-24.04-arm runner (native arm64) |
| `win-x64` | native | windows-latest runner |
| `macos-arm64` | native | macos-latest runner |
| `macos-x64` | Rosetta | `arch -x86_64` on macos-latest arm64 runner |
| `linuxstatic-x64` | native | ubuntu-latest runner (static binary) |

### PKG_EXECPATH Requirement

All verification runs set `PKG_EXECPATH=PKG_INVOKE_NODEJS` in the
environment. This env var tells the patched binary to act as a regular
Node.js interpreter instead of trying to load a packaged snapshot. This
is required because the base binary contains snapshot-loading patches
that would otherwise look for embedded application data.

Note: This env var name (`PKG_EXECPATH`) is baked into the C++ patches
and will be renamed to `HAKOBU_EXECPATH` when the patches are updated
(Task 5 scope).

## Where This Contract Is Enforced

- **CI workflow:** `.github/workflows/build-bases.yml`, in the
  "Verify — version + bytecode" step of each build job
- **CLI verification:** `packages/hakobu-fetch/lib/verify.ts`, used by
  `hakobu-fetch --test`
- **This document:** canonical reference for what the checks mean

## When This Contract Applies

- Every CI build in `build-bases.yml` runs all three checks
- The `hakobu-fetch` CLI's `--test` flag runs the same checks via
  `verify.ts`
- A binary that passes all three checks and has its SHA-256 recorded in
  `expected-shas.json` is considered a trusted base binary

## Alpha Limitations

- `linuxstatic-arm64` is excluded from alpha due to a toolchain blocker.
- `macos-x64` uses Rosetta verification (cross-compiled on arm64 runner).
  A future follow-up could use an Intel-native runner if available.
