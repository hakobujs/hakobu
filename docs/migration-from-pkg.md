# Migrating from pkg / @yao-pkg/pkg

Hakobu is a fork of `@yao-pkg/pkg` (v6.14.1) rebuilt for Node 24 with native
ESM support. Most `pkg` projects can migrate with minimal changes.

## Quick start

```bash
# Install
npm install -g @hakobu/hakobu

# Package (works the same as pkg for simple projects)
hakobu .                              # reads package.json, builds for host
hakobu ./my-app --output ./dist/app   # explicit output
```

## Config migration

### package.json field

Hakobu reads the `"hakobu"` field. The legacy `"pkg"` field is accepted with
a migration warning.

**Before (pkg):**
```json
{
  "pkg": {
    "scripts": ["lib/**/*.js"],
    "assets": ["views/**", "public/**"],
    "targets": ["node18-linux-x64", "node18-win-x64"],
    "outputPath": "./dist"
  }
}
```

**After (hakobu):**
```json
{
  "hakobu": {
    "assets": ["lib/**/*.js", "views/**", "public/**"],
    "target": "node24-linux-x64",
    "output": "./dist/my-app"
  }
}
```

You can leave the `"pkg"` field in place while migrating. Hakobu reads it and
emits guidance about what to change:

```
[config] Reading config from "pkg" field. Migrate to "hakobu" field for future compatibility.
[config] "pkg.scripts" mapped to "hakobu.assets". In Hakobu, use "assets" for extra files to include.
```

If both `"hakobu"` and `"pkg"` fields exist, `"hakobu"` takes priority and
`"pkg"` is ignored.

### Option-by-option mapping

| pkg option | Hakobu equivalent | Notes |
|---|---|---|
| `pkg.scripts` | `hakobu.assets` | Merged into assets list. In pkg, "scripts" were extra JS files to compile; Hakobu includes all reachable files automatically. |
| `pkg.assets` | `hakobu.assets` | Direct mapping. |
| `pkg.targets` | `hakobu.target` | Hakobu builds one target at a time. Use the first, or run hakobu once per target. |
| `pkg.outputPath` | `hakobu.output` | Direct mapping. |
| `pkg.patches` | Not supported | Hakobu does not support source patching. |
| `pkg.dictionary` | Not supported | Hakobu resolves dependencies directly. |
| `pkg.deployFiles` | `hakobu.assets` or `hakobu.externals` | Use assets for files to embed, externals for files kept outside. |
| `pkg.ignore` | Not needed | Hakobu only includes files reachable from the entry point. |

### CLI flag mapping

| pkg flag | Hakobu flag | Notes |
|---|---|---|
| `-t`, `--targets` | `--target` | Singular. Comma-separated multi-target is accepted but deprecated (uses first). |
| `-o`, `--output` | `--output` | Same. |
| `-c`, `--config` | Not supported | Use `"hakobu"` field in package.json. |
| `--out-path` | `--output` | Accepted with warning. Use `--output` with a full path. |
| `--no-bytecode` | Not needed | Hakobu always packages source (no bytecode mode). |
| `--compress` | `--compress` | Same. Supports Brotli and GZip. |
| `--public` | Not needed | Hakobu always includes source. |
| `--sea` | Not supported | Hakobu uses its own snapshot format. |
| `--options` | `--options` | Same. Comma-separated V8 flags baked into the executable. |
| `--build` | Not supported | Base binaries are fetched from releases. |
| `--no-native-build` | Not needed | Hakobu does not prebuild native addons. |
| `--no-dict` | Not supported | Dictionaries are not used. |

Unsupported flags cause a clear error with an explanation:
```
Error! --sea is not supported. Hakobu uses its own snapshot format, not Node SEA.
Unsupported options detected. Remove them or see migration guidance above.
```

## Key behavioral differences

### 1. Node version

- **pkg:** Supported Node 8–22 with V8 bytecode compilation.
- **Hakobu:** Targets Node 24 only. Base binaries are Node 24.14.0.

### 2. Module format

- **pkg:** CJS-first. ESM was experimental and required workarounds.
- **Hakobu:** Native ESM by default. `"type": "module"` in package.json works.
  CJS also works. Mixed ESM/CJS with `createRequire()` works.

### 3. Single target per invocation

- **pkg:** `pkg -t node18-linux,node18-win,node18-macos .` builds three executables.
- **Hakobu:** Builds one target at a time. For multiple targets:
  ```bash
  hakobu . --target node24-linux-x64 --output dist/app-linux
  hakobu . --target node24-win-x64 --output dist/app-win.exe
  hakobu . --target node24-macos-arm64 --output dist/app-macos
  ```

### 4. No bytecode compilation

- **pkg:** Could compile JS to V8 bytecode (default behavior).
- **Hakobu:** Always packages source. This simplifies the pipeline and avoids
  V8 version mismatch issues. The executable still contains a snapshot
  filesystem — source is not visible to end users without effort.

### 5. Cache location

- **pkg:** `~/.pkg-cache/`
- **Hakobu:** `~/.hakobu/cache/`

These do not conflict. You can have both installed.

### 6. Binary naming

- **pkg:** Base binaries named `fetched-v{nodeVersion}-{platform}-{arch}`
- **Hakobu:** Base binaries named `hakobu-base-v{nodeVersion}-{platform}-{arch}`

### 7. Bundle mode (new)

Hakobu adds optional bundle mode (`--bundle`) for TypeScript and monorepo
projects. This has no pkg equivalent — pkg required pre-compiled JavaScript.

```bash
hakobu ./my-ts-app --bundle --output ./dist/app
```

See `docs/bundle-mode.md` for details.

## Diagnostic commands (new)

Hakobu adds commands that pkg didn't have:

```bash
hakobu targets                    # Show available targets and cache status
hakobu inspect ./my-app           # Analyze project without packaging
hakobu doctor ./my-app            # Check if project is ready to package
```

## What should work without changes

- Simple CJS projects with `require()` and `module.exports`
- JSON file loading via `require('./data.json')`
- Native addon loading (`.node` files)
- `child_process.fork()` and `child_process.spawn()`
- `worker_threads` with `workerData`
- `process.execPath` pointing to the packaged binary
- `__dirname` and `__filename` in CJS modules

## What needs attention

- **ESM entries**: If your `package.json` has `"type": "module"`, Hakobu handles
  it natively. No changes needed, but this is different from pkg's CJS-only model.
- **`process.execPath` with `-e`**: Spawning `process.execPath -e "code"` does
  not work in packaged mode (same as pkg). Use script files instead.
- **Multi-target builds**: Restructure scripts to call hakobu once per target.
- **Bytecode protection**: If you relied on bytecode to obscure source, Hakobu
  does not offer this. Source is embedded in the snapshot.
