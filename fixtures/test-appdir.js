#!/usr/bin/env node
/**
 * Linux AppDir verification.
 *
 * Tests that --appdir produces a valid AppDir directory structure
 * and that default (non-AppDir) output is unaffected.
 *
 * Structure tests (createAppDir function) run on all platforms.
 * Full packaging tests (hakobu --appdir) only run on Linux.
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

  } catch (err) {
    if (!err.message?.includes('AppDir') && !err.message?.includes('AppRun')) {
      const msg = err.stderr ? err.stderr.toString().split('\n')[0] : err.message.split('\n')[0];
      console.log(`  XX  Packaged AppDir — ${msg}`);
      failed += 6;
    }
  }
} else {
  console.log('  --  Full packaging tests skipped (not Linux)');
}

// ── Cleanup ──
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch {}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
