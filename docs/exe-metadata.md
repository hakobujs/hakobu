# Executable Metadata

Hakobu can inject metadata into Windows PE executables so they display
proper version info, product name, and icon in file properties and
Task Manager.

## Platform Support

| Feature | Windows (.exe) | macOS | Linux |
|---------|---------------|-------|-------|
| Product name | Yes | No | No |
| File description | Yes | No | No |
| Version info | Yes | No | No |
| Company name | Yes | No | No |
| Copyright | Yes | No | No |
| Application icon | Yes | No | No |

**Why macOS and Linux are not supported:**

- **macOS**: Mach-O executables don't have embedded metadata fields.
  macOS uses `.app` bundles with `Info.plist` for this purpose.
  Hakobu produces standalone executables, not `.app` bundles.
  This may be added as a future feature (generate `.app` wrapper).

- **Linux**: ELF executables don't have a standard metadata format.
  Desktop integration uses `.desktop` files, not embedded resources.

## Quick Start

### Via package.json

```json
{
  "name": "my-app",
  "version": "1.2.3",
  "hakobu": {
    "entry": "src/index.js",
    "metadata": {
      "productName": "My Application",
      "fileDescription": "My App does amazing things",
      "companyName": "ACME Corporation",
      "legalCopyright": "Copyright 2026 ACME Corporation",
      "fileVersion": "1.2.3",
      "icon": "assets/app.ico"
    }
  }
}
```

Then package:

```bash
hakobu . --target node24-win-x64 --output dist/my-app.exe
```

### Via CLI flags

```bash
hakobu . --target node24-win-x64 --output dist/my-app.exe \
  --product-name "My Application" \
  --file-description "My App does amazing things" \
  --company-name "ACME Corporation" \
  --file-version 1.2.3 \
  --icon assets/app.ico
```

CLI flags override package.json config.

## Supported Fields

| Field | CLI Flag | package.json key | PE resource |
|-------|----------|------------------|-------------|
| Product name | `--product-name` | `metadata.productName` | `ProductName` |
| File description | `--file-description` | `metadata.fileDescription` | `FileDescription` |
| Company name | `--company-name` | `metadata.companyName` | `CompanyName` |
| Copyright | (config only) | `metadata.legalCopyright` | `LegalCopyright` |
| File version | `--file-version` | `metadata.fileVersion` | `FileVersion` |
| Product version | `--product-version` | `metadata.productVersion` | `ProductVersion` |
| Icon | `--icon` | `metadata.icon` | Application icon |

### Version format

Versions are dot-separated with up to 4 parts: `MAJOR.MINOR.PATCH.BUILD`.
Missing parts default to 0.

```
1.2.3     → 1.2.3.0
1.0       → 1.0.0.0
2.1.0.42  → 2.1.0.42
```

### Icon format

The icon must be a Windows `.ico` file. PNG, JPEG, and SVG are not
supported directly. Convert with:

```bash
# macOS (using sips + iconutil, or ImageMagick)
magick convert icon.png -resize 256x256 icon.ico

# Linux
convert icon.png icon.ico

# Or use an online converter
```

Multi-resolution `.ico` files are recommended (16x16, 32x32, 48x48,
256x256).

## Programmatic API

```typescript
import { packageApp } from '@hakobu/hakobu';

await packageApp({
  projectRoot: './my-app',
  target: 'node24-win-x64',
  output: './dist/my-app.exe',
  metadata: {
    productName: 'My Application',
    fileDescription: 'Does amazing things',
    companyName: 'ACME Corporation',
    fileVersion: '1.2.3',
    icon: './assets/app.ico',
  },
});
```

## How It Works

Hakobu uses [resedit](https://www.npmjs.com/package/resedit), a pure-JS
Windows PE resource editor, to modify the executable's VERSIONINFO
resource and icon group after packaging. This works cross-platform —
you can inject Windows metadata from macOS or Linux.

The injection happens after packaging but **before** Authenticode
signing (if configured). This ordering is important because signing
covers the entire file including resources.

```
package → inject metadata → sign (optional)
```

## Behavior When No Metadata Is Configured

When no metadata fields are specified, Hakobu produces executables with
the base Node.js binary's default metadata (Node.js version info, Node
icon). This is the same behavior as the inherited `pkg` tool.

## Interaction with Signing

Metadata injection must happen before signing:

```bash
# Correct: metadata + signing
hakobu . --target node24-win-x64 \
  --product-name "My App" --file-version 1.0.0 \
  --win-cert cert.pfx

# Hakobu handles the ordering automatically:
# 1. Package
# 2. Inject metadata (resedit)
# 3. Sign (signtool/osslsigncode)
```

## Troubleshooting

### "Cannot inject PE metadata: resedit is not installed"

`resedit` is a dependency of `@hakobu/hakobu`. If you see this error,
your installation may be incomplete. Reinstall:

```bash
npm install @hakobu/hakobu
```

### Metadata not showing in file properties

- Right-click the `.exe` → Properties → Details tab
- Ensure the target is `win` (metadata is Windows-only)
- Check that the fields are spelled correctly in config

### Icon not changing

- The icon must be a valid `.ico` file (not PNG/SVG)
- Try a multi-resolution `.ico` (16, 32, 48, 256px)
- Windows caches icons aggressively — clear the icon cache:
  ```cmd
  ie4uinit.exe -show
  ```
