# Packaging Manifest Design

The **Normalized Packaging Manifest** (`PackagingManifest`) is the canonical
internal representation of what goes into a Hakobu executable. It is produced
by the analysis phase and consumed by every downstream step.

## Lifecycle

```
User Config → Analyzer → PackagingManifest → [Bundle Mode] → Snapshot → Executable
```

| Stage | Reads | Writes |
| --- | --- | --- |
| User config parsing | CLI flags, package.json, config file | raw user options |
| Analysis (Task 4.2) | project source, node_modules, package.json files | `PackagingManifest` |
| Bundle mode (Task 11, optional) | `PackagingManifest.files` | modified `files` map |
| Snapshot assembly (Task 5) | `PackagingManifest` | snapshot blob + index |
| Executable assembly | snapshot blob + base binary | final executable |

## Key Types

**Source:** `packages/hakobu/lib/manifest.ts`

### `PackagingManifest`

The top-level type. Contains everything needed to build the executable.

### `ManifestEntrypoint`

The application entrypoint with its resolved module format (`esm` or `cjs`)
and how that format was determined (file extension, package.json `type`, or
explicit user config).

### `ManifestFile`

A single file to be packaged. Classified by `FileKind`:

| Kind | Description | Snapshot behavior |
| --- | --- | --- |
| `script` | JS/MJS/CJS executed by Node loaders | compiled to V8 bytecode |
| `json` | JSON files loaded by require/import | stored as content |
| `wasm` | WebAssembly modules | stored as content |
| `package-json` | package.json files for resolution | stored as content, indexed for runtime resolution |
| `asset` | non-executable files (templates, etc.) | stored as content |
| `native-addon` | .node binary addons | placeholder in snapshot, extracted to disk at runtime |

### `PackageMetadata`

Resolution-relevant fields from a package.json. The runtime uses this for:
- Module format determination (`type` field)
- Subpath `exports` / `imports` resolution
- Package boundary enforcement

Only fields needed for runtime resolution are included, not the full
package.json.

### `NativeAddon`

A `.node` binary addon that cannot be loaded from the snapshot. Includes a
content hash for deterministic runtime extraction.

### `ExternalArtifact`

A file or directory intentionally kept outside the executable (browsers,
ffmpeg, large data). The app uses a name-based runtime helper to locate it.

### `BundleModeConfig`

Optional pre-processing adapter. When enabled, the script graph is rewritten
by a bundler (Rolldown preferred) before snapshot assembly. This reduces
module count and improves cold start but is NOT the default.

## Design Decisions

1. **Snapshot paths are POSIX-normalized.** The runtime projects them to
   platform-native paths. This matches the inherited `pkg` convention.

2. **Files are keyed by snapshot path** in the `files` map for O(1) lookup
   during snapshot assembly and runtime resolution.

3. **Package metadata is separate from files.** A package.json is both a
   `ManifestFile` (stored in the snapshot) and a `PackageMetadata` entry
   (indexed for runtime resolution). This avoids mixing storage concerns
   with resolution concerns.

4. **Module format is determined per-file at analysis time**, not at
   runtime. The manifest records both the format and how it was determined
   (`FormatSource`), so the runtime can trust the decision without
   re-parsing package.json files.

5. **Bundle mode is a transform on the manifest**, not a separate pipeline.
   It rewrites `files` in place. The rest of the pipeline doesn't know or
   care whether bundling happened.

6. **Warnings are part of the manifest**, not side-channel output. This
   lets the CLI, API, and diagnostic tools access them uniformly.

## Relationship to Legacy `pkg` Types

The existing `types.ts` in `packages/hakobu/lib/` contains legacy types
inherited from `@yao-pkg/pkg`:

| Legacy | Manifest equivalent |
| --- | --- |
| `FileRecord` / `FileRecords` | `ManifestFile` / `files` map |
| `PkgOptions.scripts` | `ManifestFile` entries with `kind: 'script'` |
| `PkgOptions.assets` | `ManifestFile` entries with `kind: 'asset'` |
| `PackageJson` | `PackageMetadata` (resolution-relevant subset) |
| `NodeTarget` / `Target` | `RuntimeTarget` |

The legacy types remain in `types.ts` for backward compatibility during the
migration period. New code should use the manifest types. The legacy types
will be removed once the analysis pipeline is fully ported (Task 4.2).
