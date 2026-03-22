/**
 * macOS Application Bundle Generator
 *
 * Wraps a packaged Mach-O executable into a standard .app bundle:
 *
 *   MyApp.app/
 *   └── Contents/
 *       ├── Info.plist   (minimal — expanded in Task 24.2)
 *       ├── MacOS/
 *       │   └── <binary>
 *       └── Resources/   (empty — icons added in Task 24.3)
 *
 * The .app bundle is the standard macOS application format. It allows
 * the executable to appear as a native application in Finder, Dock,
 * and Launchpad, and is required for full Info.plist metadata and
 * .icns icon support.
 */

import fs from 'fs';
import path from 'path';

import { log } from './log';

/**
 * Generate a minimal Info.plist for a macOS .app bundle.
 *
 * This produces the minimum required keys for a valid bundle.
 * Full metadata support (CFBundleIdentifier, version, display name,
 * copyright) is added in Task 24.2.
 */
function generateMinimalPlist(executableName: string, appName: string): string {
  // XML-escape the values
  const esc = (s: string) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${esc(executableName)}</string>
  <key>CFBundleName</key>
  <string>${esc(appName)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
</dict>
</plist>
`;
}

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

  // Write minimal Info.plist
  const plist = generateMinimalPlist(execName, appName);
  fs.writeFileSync(path.join(contentsDir, 'Info.plist'), plist, 'utf8');

  log.info(`Created macOS app bundle: ${appPath}`);

  return appPath;
}
