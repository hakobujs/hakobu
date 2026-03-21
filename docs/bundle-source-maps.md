# Bundle-Mode Source Maps — Design Contract

This document defines how source maps work in Hakobu's bundle mode. It is
the reference for Task 17.2 (implementation) and Task 17.3 (verification).

## Problem

When Hakobu bundles a TypeScript/monorepo project with Rolldown, the original
source file names and line numbers are lost. Stack traces show bundle-internal
positions like `index.js:4821:15` instead of `src/commands/setup.ts:42:5`.

Source maps bridge this gap: they let Node's `--enable-source-maps` flag (or
`Error.prepareStackTrace`) translate bundle positions back to original source
locations.

## Design decisions

### 1. Sidecar `.map` files, not inline

Source maps are stored as **sidecar files** (e.g., `index.js.map`) alongside
the bundle output, not inlined into the JS source via base64.

Rationale:
- Inline maps would inflate the bundle size significantly (source maps are
  often larger than the source itself).
- Sidecar files are only read when `--enable-source-maps` is active or when
  an error stack trace is formatted. No runtime cost otherwise.
- Sidecar files are the standard Rolldown/Rollup output format.

### 2. The `//# sourceMappingURL` comment

Rolldown emits a `//# sourceMappingURL=index.js.map` comment at the end of
each JS file. This is a **relative path** pointing to the sidecar file in
the same directory.

At runtime in a packaged executable:
- The bundled JS file is at a snapshot path like `/snapshot/my-app/index.js`
- The source map is at `/snapshot/my-app/index.js.map`
- Node reads the `sourceMappingURL` relative to the JS file's location
- The prelude's patched `fs.readFileSync` serves the `.map` file from the
  snapshot

No URL rewriting is needed — the relative `sourceMappingURL` works correctly
because both the JS file and the `.map` file are in the same snapshot
directory.

### 3. Source paths in the map

Rolldown's source maps contain a `"sources"` array with paths to the original
files. These are typically **relative paths** from the bundle output directory
to the original source files, e.g.:

```json
{
  "sources": ["../src/commands/setup.ts", "../node_modules/foo/index.js"]
}
```

After packaging, these relative paths don't resolve to real files (the original
source tree doesn't exist inside the snapshot). This is acceptable:

- **Stack traces still show the original file name and line number.** Node's
  source map support reads the `"sources"` entries for display but does not
  need to access the original files at runtime.
- The developer sees `src/commands/setup.ts:42` in the stack trace, which is
  meaningful even though the file isn't at that path inside the executable.

### 4. Stack trace appearance

With source maps enabled, a stack trace from a bundled packaged executable
should show:

```
Error: something failed
    at setup (src/commands/setup.ts:42:5)
    at Command.run (src/cli.ts:18:3)
```

Instead of the current:

```
Error: something failed
    at setup (/snapshot/my-app/index.js:4821:15)
    at Command.run (/snapshot/my-app/index.js:127:8)
```

### 5. Enabling source maps

Source maps are opt-in at runtime via Node's standard mechanism:

```bash
# Via flag
NODE_OPTIONS=--enable-source-maps ./my-app

# Or via environment variable (works for packaged executables)
NODE_OPTIONS=--enable-source-maps ./my-app
```

Hakobu does **not** force-enable source maps. The default behavior (no source
maps) keeps runtime overhead at zero.

### 6. Single-chunk vs code-split

| Aspect | Single-chunk | Code-split |
|--------|-------------|------------|
| JS files | `index.js` | `index.js` + `chunks/*.js` |
| Map files | `index.js.map` | `index.js.map` + `chunks/*.js.map` |
| `sourceMappingURL` | Relative, same dir | Relative, same dir per chunk |
| Snapshot inclusion | Both files in snapshot | All JS + map files in snapshot |

The mechanism is identical for both modes. Each JS file gets a corresponding
`.map` sidecar. The snapshot includes all of them.

### 7. What the packager must do (Task 17.2 scope)

1. **Rolldown**: change `sourcemap: false` to `sourcemap: true` in the
   `build.write()` call.
2. **Analyzer**: ensure `.map` files are included in the manifest. The asset
   glob resolver or the analyzer's file walker must pick up `.map` files from
   the bundle output directory.
3. **ESM load hook inlines maps.** The ESM shim's `load` hook detects
   `//# sourceMappingURL=file.map` comments and replaces them with inline
   `data:application/json;base64,...` URLs. This ensures Node's source map
   support sees the map data directly in the source text, without needing
   to read `.map` files through the prelude's patched `fs`.
4. **Post-bundle patching**: the `applyBundlePatches` function only patches
   `.js` files, not `.map` files.

### 8. What is intentionally NOT supported

- **Source content embedding.** Rolldown can embed original source content
  in the map via `sourcesContent`. This is useful but increases snapshot size.
  The first implementation should use `sourcesContent: true` (Rolldown's
  default when `sourcemap: true`) so stack traces can show code snippets
  even though the original files aren't in the snapshot.
- **Mapping through the post-bundle patches.** The compatibility patches
  (playwright-core stubs, etc.) modify the bundle output after Rolldown
  generates the source map. The source map will be slightly inaccurate for
  patched lines. This is acceptable — patches are small and targeted.
- **Patched base binary limitation.** The patched Node 24.14.0 base binary's
  V8 modifications (for `sourceless` bytecode support) interfere with
  `--enable-source-maps` for modules loaded through `registerHooks`.
  The `EnableCompilationForSourcelessUse()` / `DisableCompilationForSourcelessUse()`
  functions toggle global V8 flags (`lazy`, `predictable`) that affect source
  position tracking. Verified: stock Node 24.14.0 resolves source maps
  correctly through the same `registerHooks` + inline map path. This is a
  V8 patch side effect, not a Hakobu packager issue or a Node version issue.
  Will resolve when a future base binary line (e.g., Node 25) drops or
  refines the `sourceless` V8 patches.
- **Native mode source maps.** This contract applies only to bundle mode.
  Native mode packages source files directly and doesn't transform them,
  so source maps are not needed.

## First implementation slice (Task 17.2)

1. Change `sourcemap: false` → `sourcemap: true` in `bundler.ts`
2. Ensure `.map` files are included in the bundle output file list
   (they should already be picked up by `listBundleJsFiles` or need a
   small extension to include `.map` files)
3. The analyzer must include `.map` files in the manifest (as assets)
4. Verify with a fixture (Task 17.3):
   - Bundle a TS project that throws an error
   - Run the packaged executable with `NODE_OPTIONS=--enable-source-maps`
   - Assert the stack trace shows the original `.ts` file and line number
