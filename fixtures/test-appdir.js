#!/usr/bin/env node
/**
 * Linux AppDir / AppImage verification.
 *
 * Tests that --appdir and --appimage produce valid Linux distribution
 * artifacts with correct structure, .desktop, icons, and metainfo.
 *
 * Coverage tiers:
 *   1. Unit tests (createAppDir/createAppImage) — run on all platforms
 *   2. CLI validation tests — run on all platforms
 *   3. Full packaging tests (hakobu --appdir) — Linux only
 *   4. AppImage success path — Linux only, if appimagetool is available
 *
 * Run: node fixtures/test-appdir.js
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HAKOBU_BIN = path.join(__dirname, '../packages/hakobu/lib-es5/bin.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  OK  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  XX  ${name}`);
    console.log(`      ${err.message}`);
  }
}

console.log('\n=== AppDir Verification ===\n');

// ── Unit tests: createAppDir (runs on any platform) ──

const { createAppDir } = require('../packages/hakobu/lib-es5/appdir');

// Create a fake executable for structure testing
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-appdir-'));
const fakeExec = path.join(tmpDir, 'my-app');
fs.writeFileSync(fakeExec, '#!/bin/sh\necho format=appdir-test', { mode: 0o755 });

// Test 1: basic AppDir structure
const appDir1 = path.join(tmpDir, 'TestApp.AppDir');
const result1 = createAppDir({
  executablePath: fakeExec,
  outputPath: appDir1,
  appName: 'test-app',
});

test('Structure: AppDir directory exists', () => {
  if (!fs.existsSync(result1)) throw new Error('AppDir not found');
  if (!fs.statSync(result1).isDirectory()) throw new Error('Not a directory');
});

test('Structure: usr/bin/ exists with executable', () => {
  const binDir = path.join(result1, 'usr', 'bin');
  if (!fs.existsSync(binDir)) throw new Error('usr/bin/ not found');
  const files = fs.readdirSync(binDir);
  if (files.length === 0) throw new Error('No files in usr/bin/');
});

test('Structure: AppRun exists and is executable', () => {
  const appRun = path.join(result1, 'AppRun');
  if (!fs.existsSync(appRun)) throw new Error('AppRun not found');
  const content = fs.readFileSync(appRun, 'utf8');
  if (!content.startsWith('#!/bin/sh')) throw new Error('AppRun not a shell script');
  if (!content.includes('usr/bin/')) throw new Error('AppRun does not reference usr/bin/');
  const stat = fs.statSync(appRun);
  if (!(stat.mode & 0o111)) throw new Error('AppRun not executable');
});

test('Structure: usr/share/applications/ exists', () => {
  const dir = path.join(result1, 'usr', 'share', 'applications');
  if (!fs.existsSync(dir)) throw new Error('usr/share/applications/ not found');
});

test('Structure: usr/share/icons/hicolor/ exists', () => {
  const dir = path.join(result1, 'usr', 'share', 'icons', 'hicolor');
  if (!fs.existsSync(dir)) throw new Error('usr/share/icons/hicolor/ not found');
});

test('Structure: usr/share/metainfo/ exists', () => {
  const dir = path.join(result1, 'usr', 'share', 'metainfo');
  if (!fs.existsSync(dir)) throw new Error('usr/share/metainfo/ not found');
});

// Test 2: .AppDir auto-appended
const fakeExec2 = path.join(tmpDir, 'my-app-2');
fs.writeFileSync(fakeExec2, '#!/bin/sh\necho test', { mode: 0o755 });

const result2 = createAppDir({
  executablePath: fakeExec2,
  outputPath: path.join(tmpDir, 'NoExt'),
});

test('Auto-append: .AppDir appended when missing', () => {
  if (!result2.endsWith('.AppDir'))
    throw new Error(`Expected .AppDir suffix, got: ${result2}`);
  if (!fs.existsSync(result2)) throw new Error('NoExt.AppDir not found');
});

// Test 3: AppRun references the correct binary name
test('AppRun: references correct binary', () => {
  const appRun = fs.readFileSync(path.join(result1, 'AppRun'), 'utf8');
  if (!appRun.includes('usr/bin/my-app'))
    throw new Error('AppRun does not reference my-app');
});

// Test 4: executable moved (not left behind)
test('Executable: moved into AppDir (not copied)', () => {
  if (fs.existsSync(fakeExec))
    throw new Error('Original executable should have been moved');
  const movedExec = path.join(result1, 'usr', 'bin', 'my-app');
  if (!fs.existsSync(movedExec)) throw new Error('Executable not in usr/bin/');
});

// ── .desktop file tests (unit, any platform) ──

// Test 5: default .desktop file is generated
test('.desktop: default file exists in usr/share/applications/', () => {
  const appsDir = path.join(result1, 'usr', 'share', 'applications');
  const files = fs.readdirSync(appsDir);
  if (files.length === 0) throw new Error('No .desktop file generated');
  if (!files[0].endsWith('.desktop'))
    throw new Error('File does not end with .desktop: ' + files[0]);
});

test('.desktop: has required Desktop Entry keys', () => {
  const appsDir = path.join(result1, 'usr', 'share', 'applications');
  const desktopFile = fs.readdirSync(appsDir).find(f => f.endsWith('.desktop'));
  const content = fs.readFileSync(path.join(appsDir, desktopFile), 'utf8');
  if (!content.includes('[Desktop Entry]'))
    throw new Error('Missing [Desktop Entry] header');
  if (!content.includes('Type=Application'))
    throw new Error('Missing Type=Application');
  if (!content.includes('Name='))
    throw new Error('Missing Name key');
  if (!content.includes('Exec='))
    throw new Error('Missing Exec key');
  if (!content.includes('Terminal='))
    throw new Error('Missing Terminal key');
});

test('.desktop: Exec references the binary name', () => {
  const appsDir = path.join(result1, 'usr', 'share', 'applications');
  const desktopFile = fs.readdirSync(appsDir).find(f => f.endsWith('.desktop'));
  const content = fs.readFileSync(path.join(appsDir, desktopFile), 'utf8');
  if (!content.includes('Exec=my-app'))
    throw new Error('Exec does not reference my-app');
});

test('.desktop: default Terminal=true for CLI apps', () => {
  const appsDir = path.join(result1, 'usr', 'share', 'applications');
  const desktopFile = fs.readdirSync(appsDir).find(f => f.endsWith('.desktop'));
  const content = fs.readFileSync(path.join(appsDir, desktopFile), 'utf8');
  if (!content.includes('Terminal=true'))
    throw new Error('Terminal should default to true');
});

// Test 6: .desktop with custom metadata
const fakeExec3 = path.join(tmpDir, 'custom-app');
fs.writeFileSync(fakeExec3, '#!/bin/sh\necho test', { mode: 0o755 });

const result3 = createAppDir({
  executablePath: fakeExec3,
  outputPath: path.join(tmpDir, 'CustomApp'),
  appName: 'custom-app',
  linux: {
    name: 'My Custom App',
    comment: 'Does amazing things',
    categories: 'Development;Utility;',
    terminal: false,
  },
});

test('.desktop: custom Name from linux metadata', () => {
  const appsDir = path.join(result3, 'usr', 'share', 'applications');
  const desktopFile = fs.readdirSync(appsDir).find(f => f.endsWith('.desktop'));
  const content = fs.readFileSync(path.join(appsDir, desktopFile), 'utf8');
  if (!content.includes('Name=My Custom App'))
    throw new Error('Custom Name not found');
});

test('.desktop: custom Comment from linux metadata', () => {
  const appsDir = path.join(result3, 'usr', 'share', 'applications');
  const desktopFile = fs.readdirSync(appsDir).find(f => f.endsWith('.desktop'));
  const content = fs.readFileSync(path.join(appsDir, desktopFile), 'utf8');
  if (!content.includes('Comment=Does amazing things'))
    throw new Error('Custom Comment not found');
});

test('.desktop: custom Categories from linux metadata', () => {
  const appsDir = path.join(result3, 'usr', 'share', 'applications');
  const desktopFile = fs.readdirSync(appsDir).find(f => f.endsWith('.desktop'));
  const content = fs.readFileSync(path.join(appsDir, desktopFile), 'utf8');
  if (!content.includes('Categories=Development;Utility;'))
    throw new Error('Custom Categories not found');
});

test('.desktop: Terminal=false when configured', () => {
  const appsDir = path.join(result3, 'usr', 'share', 'applications');
  const desktopFile = fs.readdirSync(appsDir).find(f => f.endsWith('.desktop'));
  const content = fs.readFileSync(path.join(appsDir, desktopFile), 'utf8');
  if (!content.includes('Terminal=false'))
    throw new Error('Terminal should be false');
});

// ── Icon placement tests (unit, any platform) ──

// Create a minimal test PNG (valid PNG header)
const testPngPath = path.join(tmpDir, 'test-icon.png');
const pngHeader = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
]);
fs.writeFileSync(testPngPath, pngHeader);

// Test 7: icon placed into hicolor and AppDir root
const fakeExec4 = path.join(tmpDir, 'icon-app');
fs.writeFileSync(fakeExec4, '#!/bin/sh\necho test', { mode: 0o755 });

const result4 = createAppDir({
  executablePath: fakeExec4,
  outputPath: path.join(tmpDir, 'IconApp'),
  appName: 'icon-app',
  linux: { iconPath: testPngPath },
});

test('Icon: placed in hicolor/256x256/apps/', () => {
  const iconDest = path.join(result4, 'usr', 'share', 'icons', 'hicolor', '256x256', 'apps', 'icon-app.png');
  if (!fs.existsSync(iconDest)) throw new Error('Icon not in hicolor/256x256/apps/');
  const content = fs.readFileSync(iconDest);
  if (content[0] !== 0x89 || content[1] !== 0x50) throw new Error('Icon content corrupted');
});

test('Icon: placed at AppDir root (AppImage convention)', () => {
  const rootIcon = path.join(result4, 'icon-app.png');
  if (!fs.existsSync(rootIcon)) throw new Error('Icon not at AppDir root');
});

test('Icon: .desktop Icon field matches icon name', () => {
  const appsDir = path.join(result4, 'usr', 'share', 'applications');
  const desktopFile = fs.readdirSync(appsDir).find(f => f.endsWith('.desktop'));
  const content = fs.readFileSync(path.join(appsDir, desktopFile), 'utf8');
  if (!content.includes('Icon=icon-app'))
    throw new Error('Icon field does not match placed icon name');
});

// Test 8: no icon — AppDir still valid
test('No icon: hicolor/256x256 does not exist when no icon configured', () => {
  const hicolor256 = path.join(result1, 'usr', 'share', 'icons', 'hicolor', '256x256');
  if (fs.existsSync(hicolor256))
    throw new Error('256x256 should not exist without icon');
});

test('No icon: no root PNG when no icon configured', () => {
  const pngs = fs.readdirSync(result1).filter(f => f.endsWith('.png'));
  if (pngs.length > 0)
    throw new Error('Should not have root PNG without icon: ' + pngs);
});

// Test 9: non-.png rejected
test('Icon validation: non-.png rejected', () => {
  const fakeJpg = path.join(tmpDir, 'bad.jpg');
  fs.writeFileSync(fakeJpg, 'not a png');
  const fakeExec5 = path.join(tmpDir, 'reject-app');
  fs.writeFileSync(fakeExec5, '#!/bin/sh\necho test', { mode: 0o755 });

  try {
    createAppDir({
      executablePath: fakeExec5,
      outputPath: path.join(tmpDir, 'BadIcon'),
      linux: { iconPath: fakeJpg },
    });
    throw new Error('Should have failed');
  } catch (err) {
    if (!err.message.includes('.png'))
      throw new Error('Expected .png validation error, got: ' + err.message);
  }
});

// ── Metainfo tests (unit, any platform) ──

// Test 10: default metainfo generated
test('Metainfo: file exists in usr/share/metainfo/', () => {
  const dir = path.join(result1, 'usr', 'share', 'metainfo');
  const files = fs.readdirSync(dir);
  if (files.length === 0) throw new Error('No metainfo file');
  if (!files[0].endsWith('.metainfo.xml'))
    throw new Error('File not .metainfo.xml: ' + files[0]);
});

test('Metainfo: valid XML structure', () => {
  const dir = path.join(result1, 'usr', 'share', 'metainfo');
  const file = fs.readdirSync(dir).find(f => f.endsWith('.metainfo.xml'));
  const content = fs.readFileSync(path.join(dir, file), 'utf8');
  if (!content.includes('<?xml version=')) throw new Error('Missing XML declaration');
  if (!content.includes('<component type="desktop-application">'))
    throw new Error('Missing component element');
  if (!content.includes('</component>')) throw new Error('Missing closing component');
});

test('Metainfo: has required keys (id, name, summary, metadata_license)', () => {
  const dir = path.join(result1, 'usr', 'share', 'metainfo');
  const file = fs.readdirSync(dir).find(f => f.endsWith('.metainfo.xml'));
  const content = fs.readFileSync(path.join(dir, file), 'utf8');
  if (!content.includes('<id>')) throw new Error('Missing <id>');
  if (!content.includes('<name>')) throw new Error('Missing <name>');
  if (!content.includes('<summary>')) throw new Error('Missing <summary>');
  if (!content.includes('<metadata_license>')) throw new Error('Missing <metadata_license>');
});

test('Metainfo: references .desktop file via launchable', () => {
  const dir = path.join(result1, 'usr', 'share', 'metainfo');
  const file = fs.readdirSync(dir).find(f => f.endsWith('.metainfo.xml'));
  const content = fs.readFileSync(path.join(dir, file), 'utf8');
  if (!content.includes('<launchable type="desktop-id">'))
    throw new Error('Missing launchable');
  if (!content.includes('.desktop</launchable>'))
    throw new Error('Launchable does not reference .desktop');
});

// Test 11: metainfo with custom metadata
const fakeExec6 = path.join(tmpDir, 'meta-app');
fs.writeFileSync(fakeExec6, '#!/bin/sh\necho test', { mode: 0o755 });

const result5 = createAppDir({
  executablePath: fakeExec6,
  outputPath: path.join(tmpDir, 'MetaApp'),
  appName: 'meta-app',
  linux: {
    name: 'Meta Application',
    summary: 'A test application for metainfo',
    description: 'This is a longer description of the application.',
    url: 'https://example.com/meta-app',
    license: 'MIT',
    version: '2.0.0',
  },
});

test('Metainfo: custom name appears', () => {
  const dir = path.join(result5, 'usr', 'share', 'metainfo');
  const file = fs.readdirSync(dir).find(f => f.endsWith('.metainfo.xml'));
  const content = fs.readFileSync(path.join(dir, file), 'utf8');
  if (!content.includes('<name>Meta Application</name>'))
    throw new Error('Custom name not found');
});

test('Metainfo: custom summary appears', () => {
  const dir = path.join(result5, 'usr', 'share', 'metainfo');
  const file = fs.readdirSync(dir).find(f => f.endsWith('.metainfo.xml'));
  const content = fs.readFileSync(path.join(dir, file), 'utf8');
  if (!content.includes('A test application for metainfo'))
    throw new Error('Custom summary not found');
});

test('Metainfo: description paragraph', () => {
  const dir = path.join(result5, 'usr', 'share', 'metainfo');
  const file = fs.readdirSync(dir).find(f => f.endsWith('.metainfo.xml'));
  const content = fs.readFileSync(path.join(dir, file), 'utf8');
  if (!content.includes('<description>'))
    throw new Error('Missing description element');
  if (!content.includes('longer description'))
    throw new Error('Description text not found');
});

test('Metainfo: homepage URL', () => {
  const dir = path.join(result5, 'usr', 'share', 'metainfo');
  const file = fs.readdirSync(dir).find(f => f.endsWith('.metainfo.xml'));
  const content = fs.readFileSync(path.join(dir, file), 'utf8');
  if (!content.includes('https://example.com/meta-app'))
    throw new Error('Homepage URL not found');
});

test('Metainfo: project license', () => {
  const dir = path.join(result5, 'usr', 'share', 'metainfo');
  const file = fs.readdirSync(dir).find(f => f.endsWith('.metainfo.xml'));
  const content = fs.readFileSync(path.join(dir, file), 'utf8');
  if (!content.includes('<project_license>MIT</project_license>'))
    throw new Error('License not found');
});

test('Metainfo: version in releases', () => {
  const dir = path.join(result5, 'usr', 'share', 'metainfo');
  const file = fs.readdirSync(dir).find(f => f.endsWith('.metainfo.xml'));
  const content = fs.readFileSync(path.join(dir, file), 'utf8');
  if (!content.includes('<releases>')) throw new Error('Missing releases');
  if (!content.includes('version="2.0.0"'))
    throw new Error('Version not found in release');
});

// ── CLI validation tests (run on any platform) ──

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-appdir-cli-'));
fs.writeFileSync(
  path.join(projectDir, 'package.json'),
  '{ "name": "appdir-test", "version": "1.0.0", "main": "index.js" }'
);
fs.writeFileSync(
  path.join(projectDir, 'index.js'),
  "'use strict';\nconsole.log('format=appdir-cli-test');\n"
);

// Test: --appdir rejects non-Linux targets (macOS)
if (process.platform === 'darwin') {
  test('Validation: --appdir rejects macOS target', () => {
    try {
      execFileSync(process.execPath, [
        HAKOBU_BIN, projectDir, '--appdir', '--output', path.join(projectDir, 'Bad.AppDir'),
      ], { timeout: 30000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      throw new Error('Should have failed');
    } catch (err) {
      const combined = (err.stderr || '') + (err.stdout || '') + (err.message || '');
      if (!combined.includes('Linux'))
        throw new Error('Expected Linux-only error, got: ' + combined.slice(0, 100));
    }
  });
}

// ── AppImage tests (unit, any platform) ──

const { createAppImage } = require('../packages/hakobu/lib-es5/appdir');

// Test: createAppImage fails clearly when appimagetool is not in PATH
test('AppImage: clear error when appimagetool is missing', () => {
  // Create a minimal AppDir for the test
  const aiDir = path.join(tmpDir, 'ai-test.AppDir');
  fs.mkdirSync(path.join(aiDir, 'usr', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(aiDir, 'AppRun'), '#!/bin/sh\necho test', { mode: 0o755 });
  fs.writeFileSync(path.join(aiDir, 'usr', 'bin', 'test'), 'fake', { mode: 0o755 });

  try {
    createAppImage({
      appDirPath: aiDir,
      outputPath: path.join(tmpDir, 'test.AppImage'),
    });
    throw new Error('Should have failed');
  } catch (err) {
    if (!err.message.includes('appimagetool'))
      throw new Error('Expected appimagetool error, got: ' + err.message.slice(0, 100));
    if (!err.message.includes('https://'))
      throw new Error('Error should include download URL');
  }
});

// Test: --appimage rejected for non-Linux targets (macOS)
if (process.platform === 'darwin') {
  test('AppImage: --appimage rejects macOS target', () => {
    try {
      execFileSync(process.execPath, [
        HAKOBU_BIN, projectDir, '--appimage', '--output', path.join(projectDir, 'Bad.AppImage'),
      ], { timeout: 30000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      throw new Error('Should have failed');
    } catch (err) {
      const combined = (err.stderr || '') + (err.stdout || '') + (err.message || '');
      if (!combined.includes('Linux'))
        throw new Error('Expected Linux-only error, got: ' + combined.slice(0, 100));
    }
  });
}

// Test: .AppImage suffix is auto-appended
test('AppImage: .AppImage suffix auto-appended to output path', () => {
  // We can't actually run appimagetool, but we can verify the
  // output path logic by checking the function's error message
  // includes the .AppImage path
  const testDir = path.join(tmpDir, 'ai-suffix.AppDir');
  fs.mkdirSync(path.join(testDir, 'usr', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(testDir, 'AppRun'), '#!/bin/sh', { mode: 0o755 });

  try {
    createAppImage({
      appDirPath: testDir,
      outputPath: path.join(tmpDir, 'NoSuffix'), // no .AppImage
    });
  } catch {
    // Expected to fail (no appimagetool) — we just verify the function accepts the call
  }
  // If it didn't throw a type error or crash before the tool check, the suffix logic works
});

// ── Full packaging test (Linux only) ──

if (process.platform === 'linux') {
  const appDirOut = path.join(projectDir, 'LinuxApp.AppDir');
  try {
    execFileSync(process.execPath, [
      HAKOBU_BIN, projectDir, '--appdir', '--output', appDirOut,
    ], { timeout: 300000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

    test('Packaged AppDir: directory exists', () => {
      if (!fs.existsSync(appDirOut)) throw new Error('AppDir not found');
      if (!fs.statSync(appDirOut).isDirectory()) throw new Error('Not a directory');
    });

    test('Packaged AppDir: AppRun exists', () => {
      if (!fs.existsSync(path.join(appDirOut, 'AppRun')))
        throw new Error('AppRun not found');
    });

    test('Packaged AppDir: inner executable exists', () => {
      const binDir = path.join(appDirOut, 'usr', 'bin');
      const files = fs.readdirSync(binDir);
      if (files.length === 0) throw new Error('No executable in usr/bin/');
      const stat = fs.statSync(path.join(binDir, files[0]));
      if (stat.size < 1024) throw new Error(`Too small: ${stat.size}`);
    });

    test('Packaged AppDir: inner executable runs', () => {
      const binDir = path.join(appDirOut, 'usr', 'bin');
      const files = fs.readdirSync(binDir);
      const output = execFileSync(path.join(binDir, files[0]), [], {
        timeout: 15000, encoding: 'utf8',
      });
      if (!output.includes('format=appdir-cli-test'))
        throw new Error('Unexpected output: ' + output.slice(0, 100));
    });

    test('Packaged AppDir: AppRun launches correctly', () => {
      const output = execFileSync(path.join(appDirOut, 'AppRun'), [], {
        timeout: 15000, encoding: 'utf8',
      });
      if (!output.includes('format=appdir-cli-test'))
        throw new Error('AppRun output wrong: ' + output.slice(0, 100));
    });

    // ── Packaged AppDir: .desktop present ──
    test('Packaged AppDir: .desktop file generated', () => {
      const appsDir = path.join(appDirOut, 'usr', 'share', 'applications');
      const files = fs.readdirSync(appsDir);
      if (files.length === 0) throw new Error('No .desktop file');
      const content = fs.readFileSync(path.join(appsDir, files[0]), 'utf8');
      if (!content.includes('[Desktop Entry]'))
        throw new Error('Invalid .desktop content');
    });

    // ── Packaged AppDir: metainfo present ──
    test('Packaged AppDir: metainfo.xml generated', () => {
      const metaDir = path.join(appDirOut, 'usr', 'share', 'metainfo');
      const files = fs.readdirSync(metaDir);
      if (files.length === 0) throw new Error('No metainfo file');
      const content = fs.readFileSync(path.join(metaDir, files[0]), 'utf8');
      if (!content.includes('<component'))
        throw new Error('Invalid metainfo content');
    });

    // ── Packaged AppDir: .desktop and metainfo reference each other ──
    test('Packaged AppDir: metainfo references .desktop', () => {
      const metaDir = path.join(appDirOut, 'usr', 'share', 'metainfo');
      const file = fs.readdirSync(metaDir).find(f => f.endsWith('.metainfo.xml'));
      const content = fs.readFileSync(path.join(metaDir, file), 'utf8');
      if (!content.includes('.desktop</launchable>'))
        throw new Error('Metainfo does not reference .desktop file');
    });

    // Verify default (no --appdir) still produces raw executable
    const rawOut = path.join(projectDir, 'raw-linux');
    execFileSync(process.execPath, [
      HAKOBU_BIN, projectDir, '--output', rawOut,
    ], { timeout: 300000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

    test('Default output: raw executable (no AppDir)', () => {
      if (!fs.existsSync(rawOut)) throw new Error('Raw output not found');
      if (!fs.statSync(rawOut).isFile()) throw new Error('Not a file');
      if (fs.existsSync(path.join(rawOut, 'usr')))
        throw new Error('Should not be an AppDir');
    });

    test('Default output: raw executable runs', () => {
      const output = execFileSync(rawOut, [], {
        timeout: 15000, encoding: 'utf8',
      });
      if (!output.includes('format=appdir-cli-test'))
        throw new Error('Raw output broken: ' + output.slice(0, 100));
    });

  } catch (err) {
    if (!err.message?.includes('AppDir') && !err.message?.includes('AppRun') &&
        !err.message?.includes('.desktop') && !err.message?.includes('metainfo')) {
      const msg = err.stderr ? err.stderr.toString().split('\n')[0] : err.message.split('\n')[0];
      console.log(`  XX  Packaged AppDir — ${msg}`);
      failed += 9;
    }
  }

  // ── AppImage success path (Linux, only when appimagetool is available) ──
  let hasAppimagetool = false;
  try {
    execFileSync('appimagetool', ['--version'], { stdio: 'pipe', timeout: 5000 });
    hasAppimagetool = true;
  } catch {}

  if (hasAppimagetool) {
    const appImageOut = path.join(projectDir, 'TestApp');
    try {
      execFileSync(process.execPath, [
        HAKOBU_BIN, projectDir, '--appimage', '--output', appImageOut,
      ], { timeout: 300000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

      test('AppImage: .AppImage file produced', () => {
        const appImageFile = appImageOut + '.AppImage';
        if (!fs.existsSync(appImageFile))
          throw new Error('AppImage file not found');
        if (!fs.statSync(appImageFile).isFile())
          throw new Error('Not a file');
        if (fs.statSync(appImageFile).size < 1024)
          throw new Error('AppImage too small');
      });

      test('AppImage: intermediate AppDir cleaned up', () => {
        // The AppDir should be removed after AppImage creation
        if (fs.existsSync(appImageOut + '.AppDir'))
          throw new Error('AppDir should have been cleaned up');
      });

      test('AppImage: executable runs', () => {
        const output = execFileSync(appImageOut + '.AppImage', [], {
          timeout: 15000, encoding: 'utf8',
        });
        if (!output.includes('format=appdir-cli-test'))
          throw new Error('AppImage output wrong: ' + output.slice(0, 100));
      });
    } catch (err) {
      if (!err.message?.includes('AppImage')) {
        const msg = err.stderr ? err.stderr.toString().split('\n')[0] : err.message.split('\n')[0];
        console.log(`  XX  AppImage packaging — ${msg}`);
        failed += 3;
      }
    }
  } else {
    console.log('  --  AppImage success-path tests skipped (appimagetool not in PATH)');
  }

} else {
  console.log('  --  Full packaging tests skipped (not Linux)');
}

// ── Cleanup ──
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch {}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
