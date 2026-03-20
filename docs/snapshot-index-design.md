# Snapshot Index Design

The **Snapshot Index** (`SnapshotIndex`) is the structural contract between
packaging and runtime. It describes every file in the snapshot and carries
enough metadata for the runtime to serve filesystem operations and resolve
module imports — including native ESM.

## Source

`packages/hakobu/lib/snapshot-index.ts`

## Lifecycle

```
PackagingManifest → buildSnapshotIndex() → SnapshotIndex
                                               ↓
                        (Task 5.2) Blob assembly: read each entry's
                        content from disk, write sequentially to blob,
                        serialize index alongside blob
                                               ↓
                        (Runtime) Deserialize index, serve fs hooks
                        and ESM loader from it
```

The index is produced AFTER analysis and BEFORE blob assembly. It does
not contain file content — only structural metadata and byte offsets into
the blob.

## Key Types

### `SnapshotEntry`

One file in the snapshot:

| Field | Type | Purpose |
| --- | --- | --- |
| `path` | string | POSIX snapshot path (`/snapshot/app/src/index.js`) |
| `kind` | FileKind | `script`, `json`, `wasm`, `package-json`, `asset`, `native-addon` |
| `format` | ModuleFormat? | `'esm'` or `'cjs'` for scripts, null otherwise |
| `packageBoundary` | string? | Snapshot path of the governing package.json |
| `offset` | number | Byte offset in the blob |
| `size` | number | Byte length in the blob |
| `contentHash` | string | SHA-256 of file content |

### `SnapshotPackageBoundary`

Resolution metadata for one package.json:

| Field | Type | Purpose |
| --- | --- | --- |
| `path` | string | Snapshot path of the package.json |
| `name` | string? | Package name |
| `version` | string? | Package version |
| `type` | `'module'`/`'commonjs'`/null | Determines .js format |
| `main` | string? | CJS main entry |
| `exports` | unknown? | Raw exports map (evaluated at runtime) |
| `imports` | unknown? | Raw imports map (evaluated at runtime) |
| `directory` | string | Snapshot path of the package root directory |

### `SnapshotDirectory`

Pre-computed directory listing:

| Field | Type | Purpose |
| --- | --- | --- |
| `path` | string | Snapshot path of the directory |
| `files` | string[] | File names in this directory (sorted) |
| `directories` | string[] | Subdirectory names (sorted) |

### `SnapshotIndex`

The top-level container:

| Field | Type | Purpose |
| --- | --- | --- |
| `appId` | string | Application name for snapshot root |
| `entrypoint` | string | Snapshot path of the entry file |
| `entrypointFormat` | ModuleFormat | ESM or CJS — determines bootstrap |
| `entries` | SnapshotEntry[] | All files, sorted by path |
| `packages` | Record<string, SnapshotPackageBoundary> | Package boundaries |
| `directories` | Record<string, SnapshotDirectory> | Directory tree |
| `blobSize` | number | Total blob size |

## Invariants

### 1. Deterministic

Identical `PackagingManifest` → identical `SnapshotIndex` → identical blob.

Entries are sorted lexicographically by snapshot path. Directory contents
are sorted. This ensures the blob byte layout is reproducible.

### 2. POSIX-normalized

All paths in the index use `/` separators and are absolute within the
snapshot root: `/snapshot/{appId}/...`

The runtime projects these to platform-native paths:
- POSIX: `/snapshot/app/src/index.js`
- Windows: `C:\snapshot\app\src\index.js`

### 3. No host paths

The index never contains host filesystem paths. Analysis-time absolute
paths from the manifest are consumed during blob assembly and discarded.
The snapshot is self-contained.

### 4. Self-contained for resolution

The index carries enough package metadata for the runtime to resolve
imports without re-reading package.json files from the blob. This is
critical for:

- **Module format**: the `format` field on each entry is pre-resolved.
  The runtime does NOT re-parse package.json to determine whether a
  `.js` file is ESM or CJS.
- **Package boundaries**: the `packageBoundary` field on each entry
  links to the governing package's metadata.
- **Exports/imports maps**: stored in `SnapshotPackageBoundary` for
  runtime evaluation with the correct conditions.

## ESM Design Decisions

### Module format is pre-resolved

The analyzer determines each file's format at packaging time using
Node 24 rules (extension → nearest package.json "type"). The runtime
trusts this decision.

This means:
- `.js` files in a `"type": "module"` package are marked `format: 'esm'`
  in the index. The runtime loads them as ESM without checking the
  package.json at runtime.
- The `type` field IS still available in `SnapshotPackageBoundary` for
  Node compatibility edge cases, but the primary format signal is the
  entry's `format` field.

### Exports/imports maps are stored raw

The `exports` and `imports` fields are stored as raw JSON in the index,
not pre-evaluated. This is because:

1. The correct export resolution depends on the caller's context
   (require vs import) which isn't known until runtime.
2. Condition matching (`import`, `require`, `default`, `node`) depends
   on how the specifier is loaded.
3. Pre-evaluating would require running resolution for every possible
   caller context, which is impractical.

The runtime evaluates exports/imports maps when resolving bare specifiers,
using the same algorithm as Node 24.

### Directory tree is pre-computed

The index includes a `directories` map so the runtime can serve
`readdir()` and directory `stat()` calls without scanning entries. This
is O(1) per call instead of O(n).

## What Is Intentionally Deferred

- **Binary serialization format**: the index is currently an in-memory
  TypeScript structure. A compact binary wire format will be designed
  when blob assembly is implemented (Task 5.2).
- **Compression metadata**: per-entry compression is not tracked yet.
  When compression is implemented, each entry will need a
  `compressionType` and `compressedSize` field.
- **Source map association**: source maps are currently treated as
  regular asset files. A future enhancement could link script entries
  to their source map entries for stack trace rewriting.
- **Symlink support**: the snapshot does not model symlinks. All paths
  are resolved to real paths during analysis.
