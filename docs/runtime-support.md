# Runtime Support

This document summarizes what Hakobu supports at runtime and where the current
limits are. For detailed target definitions, see `target-policy.md`. For
artifact naming and versioning, see `release-contract.md`.

## Node version

Hakobu targets **Node 24.x LTS** exclusively.

| Property | Value |
|---|---|
| Node version | v24.14.0 |
| V8 ABI | 137 |
| Base binary format | patched Node with snapshot filesystem support |

Older Node lines (18, 20, 22) are not supported. The fork inherited support
for them but they are not part of Hakobu's contract.

## Supported targets

### Published base binaries

| Target | Tier | Status |
|---|---|---|
| `linux-x64` | 1 | Available |
| `linux-arm64` | 1 | Available |
| `win-x64` | 1 | Available |
| `macos-arm64` | 1 | Available |
| `macos-x64` | 2 | Available |
| `linuxstatic-x64` | 2 | Available |

### Blocked targets

| Target | Reason |
|---|---|
| `linuxstatic-arm64` | muslcc GCC too old for Node 24's C++20 requirements |
| `alpine-*` | Not yet built (would be similar to linuxstatic) |

### Target specification

Use `--target` with the format `node24-{platform}-{arch}`:

```bash
hakobu . --target node24-linux-x64 --output ./dist/app
```

If `--target` is omitted, Hakobu builds for the current host.

Use `hakobu targets` to see which base binaries are cached locally and which
are available remotely.

## Module system support

### ESM

- `"type": "module"` in package.json — full support
- `.mjs` files — full support
- `import.meta.url` — returns `file:///snapshot/...` URL
- Static `import` — full support
- Dynamic `import()` — supported for static string paths
- `package.json` `"exports"` map — main entry + subpath exports
- `package.json` `"imports"` map (`#specifiers`) — supported
- `import` conditions: `import`, `node`, `default`

### CJS

- `require()` — full support
- `require.resolve()` — full support
- `__dirname` / `__filename` — available, point to snapshot paths
- `module.exports` / `exports` — full support
- `.cjs` files — full support
- JSON `require('./data.json')` — full support

### Mixed

- ESM entry with `createRequire()` for CJS dependencies — works
- CJS subpackage inside ESM root (via nested `"type": "commonjs"`) — works
- `.mjs` in CJS package / `.cjs` in ESM package — works

## Runtime features

### Child processes

- `child_process.spawn()` / `spawnSync()` — works
- `child_process.fork()` with IPC — works
- `child_process.exec()` / `execSync()` — works
- `process.execPath` — points to the packaged binary
- Environment inheritance — works
- Custom stdio arrays — works

**Known limitation:** `process.execPath -e "code"` does not work from inside
a packaged app. The prelude interprets `-e` as a module path. Use script files
instead.

### Worker threads

- `new Worker(path, { workerData })` — works
- `parentPort.postMessage()` / `worker.on('message')` — works
- `isMainThread` — correct in both main and worker contexts

### Native addons

- `.node` files are detected during analysis
- At runtime, addons are extracted from the snapshot to
  `~/.hakobu/addons/{sha256}/{filename}.node` and loaded via `process.dlopen`
- Extraction is idempotent and cache-friendly
- The cache location is configurable via `HAKOBU_ADDON_CACHE`

**Known limitation:** native addons must be compiled for the target platform
before packaging. Cross-compilation of `.node` files is not handled by Hakobu.

### External artifacts

External binaries (browsers, helper tools, large data files) can be declared
in the Hakobu config and resolved at runtime:

```json
{ "hakobu": { "externals": ["camoufox-browser"] } }
```

Resolution order:
1. `HAKOBU_EXTERNAL_{NAME}` environment variable
2. `{execDir}/externals/{name}/`
3. Pattern path (absolute or relative to cwd)

### Assets

Non-code files (templates, data, config) can be included via the `assets`
config:

```json
{ "hakobu": { "assets": ["templates/**", "config.yaml"] } }
```

Assets are included in the snapshot and readable via `fs.readFileSync()` at
runtime using `__dirname`-relative or `import.meta.url`-derived paths.

## Bundle mode

Optional pre-processing for TypeScript and monorepo projects:

```bash
hakobu . --bundle --output ./dist/app
```

See `docs/bundle-mode.md` for full details on semantic differences.

## Bytecode mode

Opt-in V8 bytecode compilation for CJS scripts:

```bash
hakobu ./my-app --bytecode --output ./dist/app
```

```json
{ "hakobu": { "bytecode": true } }
```

| Input | Bytecode compiled? |
|-------|-------------------|
| CJS scripts (`.js`, `.cjs`) | Yes |
| ESM scripts (`.mjs`, `type: "module"`) | No — source-only |
| JSON files | No — included as content |
| Assets / native addons | No — included as content/extracted |

**Restrictions:**
- `--bytecode` + `--bundle` cannot be combined (bundle produces ESM)
- Source maps are not available in bytecode mode
- Bytecode is V8 version-specific — executables must run on the same V8 version they were compiled with

## Offline / air-gapped packaging

Hakobu can package without network access when the required base binaries
are already cached.

```bash
# Set HAKOBU_OFFLINE to prevent any network access
HAKOBU_OFFLINE=1 hakobu ./my-app --output ./dist/app
```

**Pre-populating the cache:**

1. On a machine with network access, run Hakobu once per target:
   ```bash
   hakobu ./my-app --target node24-linux-x64 --output /dev/null
   hakobu ./my-app --target node24-win-x64 --output /dev/null
   ```
2. Copy `~/.hakobu/cache/` to the air-gapped machine
3. Package with `HAKOBU_OFFLINE=1`

If a required base binary is missing from cache in offline mode, Hakobu fails
immediately with the exact cache path to populate.

The cache location is configurable via `HAKOBU_CACHE_PATH`.

## Current known limits

1. **Node 24 only** — no support for older Node lines.
2. **`process.execPath -e` not supported** — use script files for child eval.
4. **No `--options` (V8 flags)** — V8 flag baking is not implemented.
5. **`linuxstatic-arm64` blocked** — toolchain incompatibility.
6. **Bytecode + bundle incompatible** — use one or the other.
