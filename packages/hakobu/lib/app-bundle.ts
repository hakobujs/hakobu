/**
 * macOS Application Bundle Generator
 *
 * Wraps a packaged Mach-O executable into a standard .app bundle:
 *
 *   MyApp.app/
 *   └── Contents/
 *       ├── Info.plist
 *       ├── MacOS/
 *       │   └── <binary>
 *       └── Resources/   (icons added in Task 24.3)
 *
 * The .app bundle is the standard macOS application format. It allows
 * the executable to appear as a native application in Finder, Dock,
 * and Launchpad, and is required for full Info.plist metadata and
 * .icns icon support.
 */

import fs from 'fs';
import path from 'path';

import { log } from './log';

// ─────────────────────────────────────────────────────────────────────
// Metadata types
// ─────────────────────────────────────────────────────────────────────

/**
 * macOS bundle metadata for Info.plist generation.
 *
 * All fields are optional — sensible defaults are derived from the
 * app name and package.json version when available.
 */
export interface MacosBundleMetadata {
  /**
   * CFBundleIdentifier — reverse-DNS bundle identifier.
   * Example: 'com.example.my-app'
   * Default: derived from app name as 'com.hakobu.<appName>'
   */
  bundleId?: string;

  /**
   * CFBundleDisplayName — user-visible name (can differ from CFBundleName).
   * Example: 'My Application'
   * Default: same as CFBundleName (appName)
   */
  displayName?: string;

  /**
   * CFBundleVersion — build version string (e.g., '42' or '1.2.3').
   * This is the internal version used by macOS for update comparisons.
   * Default: '1.0.0'
   */
  bundleVersion?: string;

  /**
   * CFBundleShortVersionString — user-visible version string.
   * Example: '1.2.3'
   * Default: same as bundleVersion
   */
  shortVersion?: string;

  /**
   * NSHumanReadableCopyright — copyright string shown in Get Info.
   * Example: 'Copyright 2026 ACME Corporation'
   */
  copyright?: string;

  /**
   * Path to a .icns file to embed as the application icon.
   * Must be a valid macOS .icns file (not PNG/SVG/JPEG).
   * The file is copied to Contents/Resources/ and referenced
   * as CFBundleIconFile in Info.plist.
   */
  icon?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Info.plist generation
// ─────────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function plistEntry(key: string, value: string): string {
  return `  <key>${esc(key)}</key>\n  <string>${esc(value)}</string>`;
}

/**
 * Derive a reverse-DNS bundle identifier from an app name.
 * Strips @scope/ prefixes and replaces non-alphanumeric chars with hyphens.
 */
function deriveBundleId(appName: string): string {
  const clean = appName
    .replace(/^@[^/]+\//, '') // strip npm scope
    .replace(/[^a-zA-Z0-9.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `com.hakobu.${clean || 'app'}`;
}

function generatePlist(
  executableName: string,
  appName: string,
  meta?: MacosBundleMetadata,
  iconFileName?: string,
): string {
  const entries: string[] = [];

  // Required keys
  entries.push(plistEntry('CFBundleExecutable', executableName));
  entries.push(plistEntry('CFBundleName', appName));
  entries.push(plistEntry('CFBundlePackageType', 'APPL'));
  entries.push(plistEntry('CFBundleInfoDictionaryVersion', '6.0'));

  // Metadata keys (with defaults)
  const bundleId = meta?.bundleId || deriveBundleId(appName);
  entries.push(plistEntry('CFBundleIdentifier', bundleId));

  const bundleVersion = meta?.bundleVersion || '1.0.0';
  entries.push(plistEntry('CFBundleVersion', bundleVersion));

  const shortVersion = meta?.shortVersion || bundleVersion;
  entries.push(plistEntry('CFBundleShortVersionString', shortVersion));

  if (meta?.displayName) {
    entries.push(plistEntry('CFBundleDisplayName', meta.displayName));
  }

  if (meta?.copyright) {
    entries.push(plistEntry('NSHumanReadableCopyright', meta.copyright));
  }

  if (iconFileName) {
    entries.push(plistEntry('CFBundleIconFile', iconFileName));
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${entries.join('\n')}
</dict>
</plist>
`;
}

// ─────────────────────────────────────────────────────────────────────
// Bundle creation
// ─────────────────────────────────────────────────────────────────────

export interface AppBundleOptions {
  /** Path to the packaged Mach-O executable (already signed). */
  executablePath: string;

  /**
   * Output path for the .app bundle.
   * If it doesn't end with '.app', '.app' is appended.
   */
  outputPath: string;

  /**
   * Application name shown in the menu bar and Finder.
   * Defaults to the executable filename without extension.
   */
  appName?: string;

  /** macOS bundle metadata for Info.plist. */
  macos?: MacosBundleMetadata;
}

/**
 * Wrap a packaged Mach-O executable into a macOS .app bundle.
 *
 * The executable is moved (not copied) into the bundle to avoid
 * doubling disk usage.
 *
 * @returns The absolute path to the generated .app bundle.
 */
export function createAppBundle(opts: AppBundleOptions): string {
  const { executablePath } = opts;

  // Determine .app path
  let appPath = opts.outputPath;
  if (!appPath.endsWith('.app')) {
    appPath += '.app';
  }
  appPath = path.resolve(appPath);

  // Derive names
  const execName = path.basename(executablePath);
  const appName = opts.appName || execName;

  // Create bundle directory structure
  const contentsDir = path.join(appPath, 'Contents');
  const macosDir = path.join(contentsDir, 'MacOS');
  const resourcesDir = path.join(contentsDir, 'Resources');

  fs.mkdirSync(macosDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });

  // Move executable into bundle
  const bundledExec = path.join(macosDir, execName);
  fs.renameSync(executablePath, bundledExec);

  // Copy .icns icon if configured
  let iconFileName: string | undefined;
  const iconPath = opts.macos?.icon;
  if (iconPath) {
    if (!fs.existsSync(iconPath)) {
      throw new Error(`macOS icon file not found: ${iconPath}`);
    }
    if (!iconPath.endsWith('.icns')) {
      throw new Error(
        `macOS icon must be a .icns file (got ${path.extname(iconPath) || 'no extension'}).\n` +
        'Convert your icon to .icns using: iconutil -c icns <iconset>'
      );
    }
    iconFileName = path.basename(iconPath);
    fs.copyFileSync(iconPath, path.join(resourcesDir, iconFileName));
    log.info(`  icon: ${iconFileName}`);
  }

  // Write Info.plist
  const plist = generatePlist(execName, appName, opts.macos, iconFileName);
  fs.writeFileSync(path.join(contentsDir, 'Info.plist'), plist, 'utf8');

  log.info(`Created macOS app bundle: ${appPath}`);

  return appPath;
}
