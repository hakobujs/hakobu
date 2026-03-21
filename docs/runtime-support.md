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

## Current known limits

1. **Node 24 only** — no support for older Node lines.
2. **Single target per invocation** — no multi-target builds.
3. **No bytecode compilation** — source is always embedded.
4. **No snapshot compression** — payload is uncompressed.
5. **`process.execPath -e` not supported** — use script files for child eval.
6. **No `--options` (V8 flags)** — V8 flag baking is not implemented.
7. **`linuxstatic-arm64` blocked** — toolchain incompatibility.
8. **Windows Playwright/Camoufox gate** — not yet validated (Task 8.4).
9. **Source maps in bundle mode** — not preserved after Rolldown bundling.
