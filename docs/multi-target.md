# Multi-Target Packaging

Design contract for packaging a project for multiple targets in one command.

## CLI

### Comma-separated `--target`

```bash
hakobu ./my-app --target node24-linux-x64,node24-win-x64,node24-macos-arm64
```

Multiple targets are specified as a single comma-separated `--target` value.
This is the primary invocation style — one flag, multiple targets.

### `--output` in multi-target mode

When multiple targets are requested, `--output` must be a **directory**, not
a file path. Hakobu creates one executable per target in that directory using
the default naming convention.

```bash
# Single target — output is a file path (existing behavior, unchanged)
hakobu ./my-app --target node24-linux-x64 --output ./dist/my-app

# Multiple targets — output is a directory
hakobu ./my-app --target node24-linux-x64,node24-win-x64 --output ./dist/
```

If `--output` is omitted in multi-target mode, executables are written to the
current directory using default names.

### Output naming

Each target produces one file named `{appId}-{platform}-{arch}`, with `.exe`
appended for Windows:

```
dist/
├── my-app-linux-x64
├── my-app-win-x64.exe
└── my-app-macos-arm64
```

The `appId` comes from `package.json` `name` (same as single-target default).

### Single-target backward compatibility

Single `--target` with `--output` as a file path works exactly as before:

```bash
hakobu ./my-app --target node24-linux-x64 --output ./dist/my-app
# → ./dist/my-app (single file, no naming convention applied)
```

If only one target is specified (even with comma syntax), the behavior matches
single-target mode: `--output` can be a file path.

### Shorthand: `--target all`

```bash
hakobu ./my-app --target all --output ./dist/
```

`all` expands to every target with a published base binary. Currently:
`linux-x64`, `linux-arm64`, `win-x64`, `macos-arm64`, `macos-x64`,
`linuxstatic-x64`.

## Package.json config

```json
{
  "hakobu": {
    "targets": ["node24-linux-x64", "node24-win-x64", "node24-macos-arm64"],
    "output": "./dist"
  }
}
```

When `targets` (plural) is an array, Hakobu uses multi-target mode.
The existing `target` (singular) field still works for single targets.
Both CLI `--target` and config `targets` are accepted. CLI overrides config.

## Programmatic API

### New: `packageMultiple()`

```typescript
import { packageMultiple } from '@hakobu/hakobu';

const results = await packageMultiple({
  projectRoot: '/path/to/project',
  targets: ['node24-linux-x64', 'node24-win-x64', 'node24-macos-arm64'],
  outputDir: './dist',
  // All other PackageOptions apply (entry, bundle, assets, externals, etc.)
});

for (const r of results) {
  console.log(`${r.target.platform}-${r.target.arch}: ${r.outputPath} (${r.status})`);
}
```

### Interface

```typescript
interface PackageMultipleOptions {
  projectRoot: string;
  targets: string[];
  outputDir?: string;   // Directory for output files (default: cwd)
  entry?: string;
  assets?: string[];
  externals?: string[];
  bundle?: boolean | string;
  bundleExternal?: string[];
}

interface PackageMultipleResult {
  target: { platform: string; arch: string; nodeRange: string };
  status: 'success' | 'failed';
  outputPath: string;    // Full path to the produced executable
  fileCount: number;
  error?: string;        // Error message if status === 'failed'
}
```

### Existing `packageApp()` unchanged

The current `packageApp(options: PackageOptions)` function remains unchanged.
`packageMultiple()` is a new function that calls `packageApp()` internally for
each target, with analysis/bundle reuse optimization (Task 18.2).

## Execution model (for Task 18.2)

Multi-target packaging reuses shared work:

```
1. Bundle (if --bundle)          → once, shared across all targets
2. Analyze                       → once, shared across all targets
3. For each target:
   a. Fetch base binary          → parallel when possible
   b. Pack (manifestToRecords)   → per target (snapshot paths differ)
   c. Produce                    → per target
   d. Post-production            → per target (signing, chmod)
```

The bundle and analysis outputs are target-independent. Only the binary
injection step (steps 3a–3d) runs per target.

## Output reporting

Multi-target mode prints a summary table after all targets complete:

```
=== Packaging Results ===

  OK  linux-x64      → dist/my-app-linux-x64       (67 MB)
  OK  win-x64        → dist/my-app-win-x64.exe    (101 MB)
  OK  macos-arm64    → dist/my-app-macos-arm64      (68 MB)

3 succeeded, 0 failed
```

If a target fails, the others still proceed. The exit code is non-zero if any
target failed.

## Error behavior

- Invalid target → skip that target with an error, continue others
- Base binary fetch failure → skip that target, continue others
- All targets failed → exit code 1
- Mix of success/failure → exit code 1, summary shows which failed
- Single target mode → existing behavior (fatal error on failure)
