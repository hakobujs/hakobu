# Target Support Policy

This document defines which platform/architecture targets Hakobu supports, at
what release stage each target enters the matrix, and how each target is built
and verified.

## Node Runtime Line

Hakobu targets **Node 24.x LTS** as the sole runtime line at launch. Older
Node lines (20, 22) are inherited from the `@yao-pkg/pkg-fetch` fork but are
not part of the Hakobu support contract.

If a future Node LTS line requires support, it will be added to this document
and the target matrix will be versioned in release notes per Requirement 10.4.

## Target Identifiers

A Hakobu target is identified by three components:

```
{platform}-{arch}
```

| Component  | Values                                             |
| ---------- | -------------------------------------------------- |
| `platform` | `linux`, `linuxstatic`, `alpine`, `macos`, `win`   |
| `arch`     | `x64`, `arm64`                                     |

The `platform` and `arch` values match the inherited `pkg-fetch` naming
conventions to preserve migration compatibility.

### Platform Definitions

| Platform      | Meaning                                               |
| ------------- | ----------------------------------------------------- |
| `linux`       | glibc-based Linux (Ubuntu, Debian, RHEL, Fedora, etc) |
| `linuxstatic` | statically linked Linux (works on any Linux distro)   |
| `alpine`      | musl libc Linux (Alpine Linux, distroless-musl)       |
| `macos`       | macOS (Darwin)                                        |
| `win`         | Windows                                               |

## Support Tiers

Targets are classified into three tiers that determine release expectations.

### Tier 1 — Release-Blocking

Tier 1 targets **must pass all tests** before any release is published. A
failure on any Tier 1 target blocks the release.

| Target         | Build Strategy    | Verification | Runner                |
| -------------- | ----------------- | ------------ | --------------------- |
| `linux-x64`    | Docker (OL8)      | native       | `ubuntu-latest`       |
| `linux-arm64`  | Docker (OL8)      | native       | `ubuntu-24.04-arm`    |
| `win-x64`      | native            | native       | `windows-latest`      |
| `macos-arm64`  | native            | native       | `macos-latest`        |

Rationale: these four targets cover the primary server, desktop, and CI
deployment surfaces. `linux-arm64` is Tier 1 because ARM servers (AWS
Graviton, Ampere) are now mainstream for Node workloads.

Both Linux targets use Docker (OracleLinux 8) intentionally — the Docker
base image controls the output binary's glibc version (2.28) for broad
compatibility. `linux-arm64` runs on a native arm64 GitHub-hosted runner
(`ubuntu-24.04-arm`), so both compilation and verification are native.

### Tier 2 — Supported, Best-Effort

Tier 2 targets are built and published in releases. Test failures on Tier 2
targets are treated as high-priority bugs but do not block a release unless
the failure indicates a regression.

| Target              | Build Strategy   | Verification          | Runner            |
| ------------------- | ---------------- | --------------------- | ----------------- |
| `macos-x64`         | native (Rosetta) | native on Intel or Rosetta | `macos-13` or `macos-latest` |
| `linuxstatic-x64`   | Docker           | Docker                | `ubuntu-latest`   |
| `linuxstatic-arm64` | Docker + cross   | Docker + qemu         | `ubuntu-latest`   |
| `win-arm64`         | native           | native                | `windows-11-arm`  |

**`linuxstatic-arm64` status: blocked.** The `muslcc/x86_64:aarch64-linux-musl`
cross-compiler ships a GCC version that cannot compile Node 24's `deps/ada/ada.h`
(C++20 `constexpr` incompatibility). This target is excluded from CI until
a newer musl cross-toolchain is available or a native arm64 Alpine build path is
established. It is Tier 2 / best-effort and does not block releases.

Rationale:
- `macos-x64` is included because Intel Macs remain in active use, but Apple
  Silicon is the primary verification target. Rosetta 2 on `macos-latest` can
  produce and verify x64 binaries.
- `linuxstatic` variants are useful for Docker deployments where users want a
  single binary that works regardless of glibc version. They are lower priority
  than glibc `linux` because most production Linux environments have glibc.

### Tier 3 — Deferred

Tier 3 targets are **not built, tested, or published** in the current release
cycle. They may be promoted in future releases.

| Target           | Reason for Deferral                                     |
| ---------------- | ------------------------------------------------------- |
| `alpine-x64`    | `linuxstatic` covers most musl use cases                |
| `alpine-arm64`  | `linuxstatic` covers most musl use cases                |
| `linux-armv7`   | legacy 32-bit ARM; low demand for Node 24 executables   |
| `linux-x86`     | legacy 32-bit x86; low demand for Node 24 executables   |
| `freebsd-*`     | niche; no GitHub-hosted runner                          |
| `linux-ppc64`   | niche; no GitHub-hosted runner                          |
| `linux-s390x`   | niche; no GitHub-hosted runner                          |
| `linux-riscv64` | niche; no GitHub-hosted runner                          |
| `linux-loong64` | niche; no GitHub-hosted runner                          |

A deferred target can be promoted to Tier 2 or Tier 1 by:

1. demonstrating a clear user demand signal (issues, PRs, adoption data)
2. establishing a sustainable build and test path (self-hosted runner, paid
   GitHub plan, or community-maintained cross-build)
3. updating this document and the release notes

## Release Stage Matrix

This table summarizes which tiers are active at each release stage.

| Tier   | Release Status |
| ------ | -------------- |
| Tier 1 | Required, release-blocking |
| Tier 2 | Supported, best-effort (failures are high-priority bugs but do not block) |
| Tier 3 | Not published |

## Build vs Verification Strategy

### Native Build

The patched Node base binary is compiled on the same platform and architecture
that it targets. This is the highest-confidence build strategy.

### Cross-Build

The patched Node base binary is compiled on a different architecture than the
target (e.g., building `linux-arm64` on an `x64` host using a cross-compiler
toolchain or Docker + qemu).

### Verification

Verification means running the built binary and confirming it reports the
correct Node version and passes smoke tests. Native verification is preferred
per Requirement 10.3.

| Verification Method | Confidence | Used When                          |
| ------------------- | ---------- | ---------------------------------- |
| Native              | highest    | runner matches target platform+arch|
| Rosetta 2           | high       | macos-x64 on Apple Silicon         |
| QEMU user-mode      | medium     | linux-arm64 on x64 host            |
| Docker              | medium     | linuxstatic on glibc host          |
| Untested            | none       | target is Tier 3 / deferred        |

When a cross-built binary cannot be natively verified, the release notes must
state this clearly per Requirement 10.3.

## Windows Playwright/Camoufox Gate

Per the design doc and Requirement 6.2, the Windows Playwright/Camoufox
workload is a **release gate for Windows support claims**. This means:

- `win-x64` is supported and verified via CI fixtures on `windows-latest`

## Runner Expansion

The current policy assumes only GitHub-hosted public runners. Per
Requirement 11.4, the project is designed to allow later expansion to:

- larger GitHub-hosted runners (paid plans)
- self-hosted runners (for native arm64 Linux, win-arm64, etc.)
- community-contributed runners

Such expansion does not change the public release contract. It only changes
how builds and tests are executed internally.

## Migration Note

Users migrating from `@yao-pkg/pkg` should note:

- Hakobu drops support for Node lines older than 24.x
- `armv7`, `x86`, `freebsd`, `ppc64`, `s390x`, `riscv64`, `loong64` are
  deferred (they were inherited but not actively maintained upstream either)
- `alpine` is deferred in favor of `linuxstatic` (which works on Alpine)
- the target naming convention (`{platform}-{arch}`) is unchanged
