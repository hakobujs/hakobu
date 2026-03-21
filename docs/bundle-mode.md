# Bundle Mode

Hakobu has two packaging modes: **native mode** (default) and **bundle mode** (opt-in).

Bundle mode pre-processes a project with a JavaScript bundler before packaging.
It is designed for projects that Hakobu's native analyzer cannot handle directly,
such as TypeScript source, workspace monorepos, or dependency graphs that need
tree-shaking.

## When to use each mode

### Native mode (default)

Use native mode when your project is already plain JavaScript that Node.js can
run. This is the primary path and the most predictable.

```bash
hakobu ./my-project --output ./dist/app
```

Native mode:
- Packages JS/JSON/asset files directly from disk
- Follows `require()` and static `import` to discover the dependency graph
- Preserves file-by-file structure inside the snapshot
- Supports CJS, ESM, and mixed-module projects
- Does not transform source code

### Bundle mode (`--bundle`)

Use bundle mode when your project needs compilation or resolution that Node.js
alone cannot provide.

```bash
hakobu ./my-project --bundle --output ./dist/app
```

Common reasons to use `--bundle`:
- **TypeScript source** — Rolldown compiles TS to JS
- **Workspace monorepos** — resolves `workspace:*` dependencies into a single bundle
- **Complex dependency trees** — tree-shakes and produces a smaller payload
- **Bun/Deno projects** — can bundle code that was written for other runtimes into Node-compatible JS

Bundle mode is a **pre-processing step**, not a different runtime. After bundling,
the same Hakobu packaging pipeline runs: analyze, pack, produce. The packaged
executable uses the same snapshot filesystem and runtime bootstrap as native mode.

## How bundle mode works

```
Source project  ──→  Rolldown  ──→  Bundled JS  ──→  Hakobu packager  ──→  Executable
  (TS, monorepo)      (step 0)       (temp dir)        (steps 1-8)
```

1. Rolldown bundles the entry and all reachable dependencies into a single `.js` file
2. Post-bundle patches fix known bundler-hostile patterns (see below)
3. A minimal `package.json` is generated alongside the bundle
4. The Hakobu packaging pipeline runs on this temp directory
5. The temp directory is cleaned up after packaging (even on failure)

## CLI usage

```bash
# Bundle mode with default bundler (Rolldown)
hakobu ./my-project --bundle --output ./dist/app

# Explicit bundler name (currently only 'rolldown')
hakobu ./my-project --bundle rolldown --output ./dist/app

# Specify entry (required if not discoverable from package.json)
hakobu ./my-project --bundle --entry src/cli.ts --output ./dist/app

# Keep specific modules external (not bundled)
hakobu ./my-project --bundle --external electron --external better-sqlite3

# Combine with target selection
hakobu ./my-project --bundle --target node24-linux-x64 --output ./dist/app-linux
```

## Programmatic API

```typescript
import { packageApp } from '@hakobu/hakobu';

await packageApp({
  projectRoot: '/path/to/project',
  bundle: true,                    // or 'rolldown'
  entry: 'src/index.ts',          // optional if package.json has "main"
  bundleExternal: ['electron'],   // optional
  output: './dist/app',
});
```

## Semantic differences from native mode

Bundle mode produces a working executable, but the internals differ from native
mode in specific ways. These are tradeoffs, not bugs.

### Single-chunk output

The Rolldown adapter produces a single `.js` file with all code inlined. This
means:

- **No `node_modules` in the snapshot.** All dependencies are bundled into one file.
- **Dynamic `import()` with variable arguments may break.** Rolldown inlines
  dynamic imports, so `import(someVariable)` cannot lazily load a module that
  wasn't statically reachable.
- **Source maps are not preserved.** Stack traces show bundle-internal line numbers.
- **Smaller snapshot.** Tree-shaking removes unused exports.

### `__dirname` and `__filename`

Rolldown outputs ESM format. CJS modules that use `__dirname` or `__filename`
are converted, but some references survive without polyfills — particularly in
deeply nested CJS code that Rolldown inlines verbatim.

Hakobu's Rolldown adapter addresses this by:
- Injecting a module-level banner that defines `__dirname` and `__filename`
  from `import.meta.url`
- Disabling code splitting (`codeSplitting: false`) to ensure the polyfill
  is visible everywhere in a single output chunk

**Caveat:** The `__dirname` value in bundle mode points to the snapshot entry
directory, not to the original source file's directory. Code that uses `__dirname`
to locate sibling files relative to a specific source file may resolve to the
wrong path. This is inherent to single-file bundling — not specific to Hakobu.

### External modules

By default, the following are always kept external (not bundled):

| Pattern | Reason |
|---------|--------|
| `node:*` | Node.js built-in modules |
| `bun:*` | Bun-specific modules (stubbed at runtime) |
| `electron` | Electron framework |
| `chromium-bidi` | Optional Playwright/CDP dependency |

You can add more externals with `--external <name>`. Glob patterns with `*`
are supported:

```bash
--external "better-sqlite3"
--external "@my-scope/*"
```

**Caveat:** Externalized modules must be available at runtime. If you externalize
a module, it must either be a Node.js built-in, or the packaged executable must
be able to find it on disk (in `node_modules` relative to the executable, or
via `NODE_PATH`).

### Runtime-specific protocol stubs

When the bundled code imports from `bun:*` or `deno:*` protocols, Hakobu's ESM
hooks provide stub modules at runtime. These stubs export `undefined` for default
exports and throw descriptive errors for named exports like `Database`.

This means code that conditionally uses `bun:sqlite` (with a try/catch fallback)
will work, but code that unconditionally depends on `bun:sqlite` features will
fail at runtime with a clear error message.

### Post-bundle compatibility patches

Some packages use runtime self-introspection patterns that break after
bundling. Hakobu applies targeted fixes from a compatibility registry.

**playwright-core** — resolves its own `package.json` at runtime:

| Pattern | Fix |
|---------|-----|
| `dirname(require.resolve(".../playwright-core/package.json"))` | `process.cwd()` |
| `require.resolve(".../playwright-core/package.json")` | Stub path |
| `require(".../playwright-core/package.json")` | `{name, version}` stub |

**Relative package.json traversals** — many packages use `require("../../package.json")`:

| Pattern | Fix |
|---------|-----|
| `dirname(require.resolve("../package.json"))` | `process.cwd()` |
| `require.resolve("../package.json")` | Stub path |
| `require("../package.json")` | `{name, version}` stub |

Patches are applied to the bundled output before packaging. Each applied
patch is logged individually (e.g., `patched: playwright-core: require(...)`).
Patches do not modify arbitrary `require()` calls — they match only the
specific patterns listed above.

**Caveat:** If a package uses an unusual variant of these patterns, the patch
may not match. If you see `Cannot find module '../package.json'` errors at
runtime, the bundle output may need a custom external or a manual patch.

### Entry resolution

When `--entry` is not specified, bundle mode resolves the entry from:

1. `package.json` `"main"` field
2. `package.json` `"module"` field
3. `src/index.ts`
4. `src/index.js`
5. `index.ts`
6. `index.js`

If none of these exist, bundling fails with a clear error asking for `--entry`.

## Limitations

- **Rolldown is the only supported bundler.** The `BundleAdapter` interface
  allows future bundlers, but only Rolldown is implemented.
- **Rolldown is an optional dependency.** If it is not installed, `--bundle`
  fails with a message telling you to install it.
- **No code-split output.** All code is inlined into one chunk. This is required
  for correct `__dirname`/`__filename` handling but increases bundle size for
  projects with many lazy-loaded modules.
- **No source maps.** The bundled output does not include source maps.
  Stack traces reference bundle-internal positions.
- **Windows not yet validated.** Bundle mode has been tested on macOS (arm64).
  Linux should work. Windows bundle-mode packaging has not been verified.

## Comparison table

| Aspect | Native mode | Bundle mode |
|--------|-------------|-------------|
| Input | JavaScript (JS/MJS/CJS) | Any (TS, JSX, etc.) |
| Dependencies | Traced from disk | Bundled into one file |
| `__dirname` | Points to snapshot file dir | Points to snapshot entry dir |
| Source maps | Preserved (file-level) | Not preserved |
| Tree-shaking | No | Yes |
| Workspace deps | Must be built first | Resolved by Rolldown |
| File count | Many (mirrors source) | 1 (single bundle) |
| Default | Yes | No (`--bundle` required) |
| Bundler required | No | Yes (rolldown) |
