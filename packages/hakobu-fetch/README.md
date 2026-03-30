# @hakobu/hakobu-fetch

Fetches or builds patched Node.js binaries used by [Hakobu](https://github.com/hakobujs/hakobu) to produce standalone executables.

## Supported Targets

Hakobu targets Node 24.x LTS. The following base binaries are published:

| Platform | Architecture | Tier | Status |
|---|---|---|---|
| linux | x64 | 1 | Active |
| linux | arm64 | 1 | Active |
| win | x64 | 1 | Active |
| macos | arm64 | 1 | Active |
| macos | x64 | 2 | Active |
| linuxstatic | x64 | 2 | Active |
| win | arm64 | 2 | Active |

See the [Target Policy](https://github.com/hakobujs/hakobu/blob/main/docs/target-policy.md) for tier definitions and build strategies.

## Usage

This package is used internally by `@hakobu/hakobu`. You typically don't need to install it directly.

```bash
# Hakobu installs this automatically
npm install @hakobu/hakobu
```

If you need to pre-fetch a base binary (e.g., for offline/air-gapped builds):

```bash
npx @hakobu/hakobu-fetch --node-range node24 --platform linux --arch x64
```

## Environment Variables

| Variable | Description |
|---|---|
| `PKG_CACHE_PATH` | Directory to cache base binaries. Default: `~/.pkg-cache` |
| `PKG_BUILD_PATH` | Directory to clone and build Node.js binaries. Default: system temp |
| `PKG_NODE_PATH` | Custom path to a local Node.js binary to use instead of fetching |
| `PKG_IGNORE_TAG` | Ignore tag folder when checking local binary path |
| `HTTPS_PROXY` | HTTPS proxy for fetching binaries |
| `HTTP_PROXY` | HTTP proxy for fetching binaries |
| `MAKE_JOB_COUNT` | Parallel jobs for building binaries (passed to `make -j`). Default: CPU count |

## Security

Base binaries are compiled by [GitHub Actions](https://github.com/hakobujs/hakobu/actions) with transparent, auditable workflows. Binary checksums are recorded in [expected-shas.json](./lib/expected-shas.json) and verified at fetch time.

## License

MIT
