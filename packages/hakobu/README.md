# @hakobu/hakobu

The modern Node.js packager — the successor to [@yao-pkg/pkg](https://github.com/yao-pkg/pkg). Package your Node.js project into a standalone executable that runs without Node.js installed.

## Install

```bash
npm install @hakobu/hakobu --save-dev
```

Or globally:

```bash
npm install -g @hakobu/hakobu
```

## Quick Start

```bash
# Package the current project
npx @hakobu/hakobu .

# Package with a specific target
npx @hakobu/hakobu . --target node24-linux-x64

# Multi-target build
npx @hakobu/hakobu . --target node24-linux-x64,node24-macos-arm64,node24-win-x64
```

## CLI Usage

```
hakobu <project-root> [options]

Commands:
  hakobu <project-root>                Package a project
  hakobu targets                       Show available targets and cache
  hakobu inspect <project-root>        Analyze a project without packaging
  hakobu doctor <project-root>         Check if a project is ready to package

Options:
  --target <spec>       Target(s), comma-separated. Use 'all' for all published targets
  --output <path>       Output executable path
  --entry <file>        Entry file (relative to project root)
  --debug, -d           Show detailed packaging diagnostics
  --help, -h            Show help
  --version, -v         Show version

Bundle Mode:
  --bundle [name]       Pre-bundle with Rolldown before packaging
  --external <mod>      Keep module external when bundling (repeatable)

Advanced:
  --bytecode            Compile JS to V8 bytecode before packaging
  --compress <algo>     Compress snapshot (Brotli or GZip)
  --options <flags>     Bake V8 flags into executable (comma-separated)
  --build, -b           Force local build of base binary
```

## Targets

Target format: `node24-{platform}-{arch}`

| Target | Tier |
|---|---|
| node24-linux-x64 | 1 |
| node24-linux-arm64 | 1 |
| node24-win-x64 | 1 |
| node24-macos-arm64 | 1 |
| node24-macos-x64 | 2 |
| node24-linuxstatic-x64 | 2 |
| node24-win-arm64 | 2 |

Use `--target all` to build for all published targets.

## Configuration

Configure via the `"hakobu"` field in `package.json`:

```json
{
  "hakobu": {
    "entry": "src/index.js",
    "assets": ["templates/**", "views/**"],
    "target": "node24-linux-x64",
    "output": "dist/my-app"
  }
}
```

The legacy `"pkg"` field is accepted with migration warnings. CLI flags override package.json config.

## Bundle Mode

For TypeScript and monorepo projects, use `--bundle` to pre-bundle with Rolldown before packaging:

```bash
npx @hakobu/hakobu . --bundle --entry src/cli.ts --external electron
```

See [Bundle Mode documentation](https://docs.hakobujs.dev/build/bundle-mode) for details.

## Platform Features

### macOS Signing & Notarization

```bash
npx @hakobu/hakobu . --target node24-macos-arm64 \
  --sign-identity "Developer ID Application: ..." \
  --notarize
```

### macOS App Bundle

```bash
npx @hakobu/hakobu . --target node24-macos-arm64 \
  --app-bundle --bundle-id com.example.my-app
```

### Windows PE Metadata

```bash
npx @hakobu/hakobu . --target node24-win-x64 \
  --product-name "My App" \
  --company-name "My Company" \
  --file-version 1.0.0 \
  --icon app.ico
```

### Linux AppDir / AppImage

```bash
npx @hakobu/hakobu . --target node24-linux-x64 \
  --appdir --desktop-name "My App"

npx @hakobu/hakobu . --target node24-linux-x64 \
  --appimage --desktop-name "My App"
```

## Programmatic API

```typescript
import { exec } from '@hakobu/hakobu';

await exec(['.', '--target', 'node24-linux-x64', '--output', 'dist/app']);
```

## Migrating from @yao-pkg/pkg

```bash
npm uninstall @yao-pkg/pkg
npm install @hakobu/hakobu --save-dev
```

Rename the `"pkg"` field to `"hakobu"` in your `package.json`. The legacy `"pkg"` field still works with migration warnings.

See the [Migration Guide](https://docs.hakobujs.dev/guides/migration-from-pkg) for full details.

## Documentation

- [Getting Started](https://docs.hakobujs.dev)
- [Configuration Reference](https://docs.hakobujs.dev/configuration/package-json)
- [CLI Flags Reference](https://docs.hakobujs.dev/configuration/cli-flags)
- [Build Targets](https://docs.hakobujs.dev/build/targets)
- [Bundle Mode](https://docs.hakobujs.dev/build/bundle-mode)
- [Distribution & Signing](https://docs.hakobujs.dev/distribution/cross-platform)
- [Migration from pkg](https://docs.hakobujs.dev/guides/migration-from-pkg)

## License

MIT
