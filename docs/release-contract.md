# Release Contract

This document defines Hakobu's artifact naming, versioning, checksum, and
release layout conventions. It is the authoritative reference for how releases
are structured and what consumers can depend on.

## Versioning

### Package Versions

Both published npm packages follow semver independently:

| Package                 | Starting Version | Notes                         |
| ----------------------- | ---------------- | ----------------------------- |
| `@hakobu/hakobu`        | `0.1.0`          | CLI + programmatic API        |
| `@hakobu/hakobu-fetch`  | `0.1.0`          | patched Node binary manager   |

**Pre-1.0 versioning (`0.MINOR.PATCH`):**

| Change Type                          | Version Bump         | Example             |
| ------------------------------------ | -------------------- | ------------------- |
| Breaking change (API, config, CLI)   | increment `MINOR`    | `0.2.0` → `0.3.0`  |
| New feature (backward-compatible)    | increment `PATCH`    | `0.2.0` → `0.2.1`  |
| Bug fix                              | increment `PATCH`    | `0.2.1` → `0.2.2`  |

Every `0.MINOR.0` release resets the patch counter. Pre-1.0 consumers should
pin to `0.MINOR.x` and expect breaking changes on `MINOR` bumps.

**Post-1.0 versioning:** standard semver. Breaking changes increment major,
features increment minor, fixes increment patch.

### Node Version in Artifacts

Patched base binaries are versioned by the upstream Node.js version they are
built from (e.g., `v24.14.0`). The `hakobu-fetch` package version is
independent of the Node version.

## Artifact Naming

### Patched Base Binaries

Patched base binaries are the core build output of `@hakobu/hakobu-fetch`.
Each binary is a patched Node.js executable for a specific target.

**Naming pattern:**

```
hakobu-base-v{nodeVersion}-{platform}-{arch}
```

**Examples:**

```
hakobu-base-v24.14.0-linux-x64
hakobu-base-v24.14.0-linux-arm64
hakobu-base-v24.14.0-win-x64
hakobu-base-v24.14.0-macos-arm64
hakobu-base-v24.14.0-macos-x64
hakobu-base-v24.14.0-linuxstatic-x64
hakobu-base-v24.14.0-linuxstatic-arm64
```

The `hakobu-base-` prefix distinguishes these from upstream Node binaries and
from the old `pkg-fetch` naming (`node-v{version}-{platform}-{arch}`).

### Local Cache Path

When fetched or built locally, base binaries are stored at:

```
~/.hakobu/cache/{fetchVersion}/{artifactName}
```

Where `{fetchVersion}` is the `@hakobu/hakobu-fetch` package version tag
(e.g., `v0.1.0`).

The cache path is configurable via the `HAKOBU_CACHE_PATH` environment
variable.

**Migration from `pkg`:** the inherited `~/.pkg-cache/` path is not reused.
Hakobu uses a separate cache to avoid conflicts with existing `pkg`
installations.

### Packaged Executables (User Output)

The final executables produced by `hakobu package` are named by the user's
configuration. Hakobu does not impose a naming convention on user output, but
the default follows the inherited `pkg` pattern:

```
{entryName}-{platform}-{arch}
```

With `.exe` appended on Windows.

## GitHub Release Layout

### Release Tags

The monorepo uses scoped release tags to distinguish between the two packages:

| Package                | Tag Pattern                | Example            |
| ---------------------- | -------------------------- | ------------------ |
| `@hakobu/hakobu`       | `v{version}`               | `v0.1.0`           |
| `@hakobu/hakobu-fetch` | `fetch/v{version}`         | `fetch/v0.1.0`     |
| Patched base binaries  | `bases/node-v{nodeVersion}`| `bases/node-v24.14.0` |

Base binary releases are tagged separately from `hakobu-fetch` package
releases because a single `hakobu-fetch` version may support multiple Node
patch versions over time.

### Release Assets — Base Binaries

Each `bases/node-v{nodeVersion}` release contains:

```
bases/node-v24.14.0/
├── hakobu-base-v24.14.0-linux-x64
├── hakobu-base-v24.14.0-linux-arm64
├── hakobu-base-v24.14.0-win-x64
├── hakobu-base-v24.14.0-win-arm64          (Tier 2)
├── hakobu-base-v24.14.0-macos-arm64
├── hakobu-base-v24.14.0-macos-x64          (Tier 2)
├── hakobu-base-v24.14.0-linuxstatic-x64    (Tier 2)
├── hakobu-base-v24.14.0-linuxstatic-arm64  (Tier 2)
├── CHECKSUMS.sha256
└── PROVENANCE.json
```

Tier 3 (deferred) targets are not included in releases.

### Release Assets — CLI Package

Each `v{version}` release contains:

```
v0.1.0/
├── hakobu-v0.1.0.tgz           (npm tarball, convenience copy)
├── CHECKSUMS.sha256
└── CHANGELOG.md                 (release-specific excerpt)
```

The canonical distribution channel for the CLI is npm. The GitHub Release
tarball is a convenience artifact for environments that cannot use npm.

### Release Assets — Fetch Package

Each `fetch/v{version}` release contains:

```
fetch/v0.1.0/
├── hakobu-fetch-v0.1.0.tgz     (npm tarball, convenience copy)
├── CHECKSUMS.sha256
└── CHANGELOG.md                 (release-specific excerpt)
```

## Checksums

### Format

Every GitHub Release includes a `CHECKSUMS.sha256` file containing SHA-256
hashes for all binary artifacts in that release.

**File format:** GNU coreutils `sha256sum` output, one line per artifact:

```
<sha256>  hakobu-base-v24.14.0-linux-x64
<sha256>  hakobu-base-v24.14.0-linux-arm64
```

Users can verify downloads with:

```bash
sha256sum -c CHECKSUMS.sha256
```

### Expected Hashes in Code

`@hakobu/hakobu-fetch` embeds expected SHA-256 hashes in
`lib/expected-shas.json`, keyed by the release artifact name (e.g.,
`hakobu-base-v24.14.0-linux-x64`). These keys match the filenames
published in GitHub Releases and the `remotePlace().name` used for
download.

Before the first published Hakobu base-binary release for a Node patch line,
this file may be empty. In that state, `hakobu-fetch` skips remote fetch for
that line and falls back to a local build. Once release artifacts exist, the
embedded hashes become mandatory for trusted fetches.

The hash is checked automatically when a base binary is fetched from a GitHub
Release. A mismatch causes the download to fail with a clear error.

## Provenance Metadata

Each base binary release includes a `PROVENANCE.json` file with the following
structure:

```json
{
  "hakobuFetchVersion": "0.1.0",
  "nodeVersion": "24.14.0",
  "nodeSourceSha256": "<sha256 of the upstream Node source tarball>",
  "patchSetSha256": "<sha256 of the combined patch content>",
  "buildDate": "2026-03-19T00:00:00Z",
  "targets": [
    {
      "name": "hakobu-base-v24.14.0-linux-x64",
      "platform": "linux",
      "arch": "x64",
      "buildStrategy": "native",
      "runner": "ubuntu-latest",
      "sha256": "766b8761..."
    }
  ]
}
```

This satisfies Requirement 13.2 (recording upstream Node version and patch
provenance).

### Future: Sigstore / SLSA

When GitHub Actions OIDC-based provenance (SLSA) becomes practical for this
project, `PROVENANCE.json` may be extended or supplemented with a Sigstore
attestation. The current JSON format is designed to be forward-compatible
with that path.

## Download URL Pattern

Base binaries are downloaded from GitHub Releases at:

```
https://github.com/hakobujs/hakobu/releases/download/{tag}/{artifactName}
```

**Example:**

```
https://github.com/hakobujs/hakobu/releases/download/bases/node-v24.14.0/hakobu-base-v24.14.0-linux-x64
```

## Release Process Summary

### Base Binary Release

1. Build patched Node base binaries for all Tier 1 and Tier 2 targets
2. Run smoke tests on each binary (version check, basic execution)
3. Generate `CHECKSUMS.sha256`
4. Generate `PROVENANCE.json`
5. Create GitHub Release at tag `bases/node-v{nodeVersion}`
6. Upload all binaries, checksums, and provenance
7. Update `expected-shas.json` in `@hakobu/hakobu-fetch`

### CLI Package Release

1. Ensure all tests pass on the current `@hakobu/hakobu-fetch` base binaries
2. Build the CLI package
3. Run the full test suite including executable fixture tests
4. Publish to npm
5. Create GitHub Release at tag `v{version}`
6. Upload tarball and checksums

### Fetch Package Release

1. Ensure base binaries for the referenced Node version are published
2. Build the fetch package
3. Publish to npm
4. Create GitHub Release at tag `fetch/v{version}`
5. Upload tarball and checksums

## Compatibility with `pkg` / `yao-pkg`

Key differences from the inherited `@yao-pkg/pkg-fetch` release model:

| Aspect            | `@yao-pkg/pkg-fetch`                     | `@hakobu/hakobu-fetch`                    |
| ----------------- | ---------------------------------------- | ----------------------------------------- |
| Artifact prefix   | `node-`                                  | `hakobu-base-`                            |
| Cache directory   | `~/.pkg-cache/`                          | `~/.hakobu/cache/`                        |
| Cache env var     | `PKG_CACHE_PATH`                         | `HAKOBU_CACHE_PATH`                       |
| Release repo      | `yao-pkg/pkg-fetch`                      | `hakobujs/hakobu` (monorepo)              |
| Tag format        | `v{major}.{minor}`                       | `bases/node-v{nodeVersion}`               |
| Checksum file     | embedded in `expected-shas.json` only    | `CHECKSUMS.sha256` in release + embedded  |
| Provenance        | none                                     | `PROVENANCE.json` per release             |
| Node lines        | v8–v24                                   | v24 only                                  |
