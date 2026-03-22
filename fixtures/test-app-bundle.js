#!/usr/bin/env node
/**
 * macOS .app bundle verification.
 *
 * Tests that --app-bundle produces a valid .app directory structure
 * with a working executable inside, and that default (non-bundle)
 * output is unaffected.
 *
 * Only runs on macOS — skips with exit 0 on other platforms.
 *
 * Run: node fixtures/test-app-bundle.js
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

if (process.platform !== 'darwin') {
  console.log('\n=== App Bundle Verification ===\n');
  console.log('  --  Skipped (not macOS)\n');
  process.exit(0);
}

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

function tmpProject(name, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hk-ab-${name}-`));
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(dir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

console.log('\n=== App Bundle Verification ===\n');

const projectDir = tmpProject('app-bundle', {
  'package.json': '{ "name": "test-app", "version": "1.0.0", "main": "index.js" }',
  'index.js': "'use strict';\nconsole.log('hello from app bundle');\nconsole.log('format=app-bundle-test');\n",
});

// ── Test 1: --app-bundle produces .app structure ──

const appOut = path.join(projectDir, 'TestApp.app');
try {
  execFileSync(process.execPath, [
    HAKOBU_BIN, projectDir, '--app-bundle', '--output', appOut,
  ], { timeout: 300000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  test('.app bundle: directory exists', () => {
    if (!fs.existsSync(appOut)) throw new Error('TestApp.app not found');
    if (!fs.statSync(appOut).isDirectory()) throw new Error('TestApp.app is not a directory');
  });

  test('.app bundle: Contents/MacOS/ exists', () => {
    const macosDir = path.join(appOut, 'Contents', 'MacOS');
    if (!fs.existsSync(macosDir)) throw new Error('Contents/MacOS/ not found');
  });

  test('.app bundle: executable inside MacOS/', () => {
    const macosDir = path.join(appOut, 'Contents', 'MacOS');
    const files = fs.readdirSync(macosDir);
    if (files.length === 0) throw new Error('No files in Contents/MacOS/');
    const execPath = path.join(macosDir, files[0]);
    const stat = fs.statSync(execPath);
    if (!stat.isFile()) throw new Error('Not a file');
    if (stat.size < 1024) throw new Error(`Too small: ${stat.size} bytes`);
  });

  test('.app bundle: Info.plist exists', () => {
    const plist = path.join(appOut, 'Contents', 'Info.plist');
    if (!fs.existsSync(plist)) throw new Error('Info.plist not found');
    const content = fs.readFileSync(plist, 'utf8');
    if (!content.includes('CFBundleExecutable')) throw new Error('Missing CFBundleExecutable');
    if (!content.includes('CFBundlePackageType')) throw new Error('Missing CFBundlePackageType');
  });

  test('.app bundle: Contents/Resources/ exists', () => {
    const resDir = path.join(appOut, 'Contents', 'Resources');
    if (!fs.existsSync(resDir)) throw new Error('Contents/Resources/ not found');
  });

  test('.app bundle: inner executable runs correctly', () => {
    const macosDir = path.join(appOut, 'Contents', 'MacOS');
    const files = fs.readdirSync(macosDir);
    const execPath = path.join(macosDir, files[0]);
    const output = execFileSync(execPath, [], {
      timeout: 15000, encoding: 'utf8',
    });
    if (!output.includes('format=app-bundle-test')) {
      throw new Error('Unexpected output: ' + output.slice(0, 100));
    }
  });

} catch (err) {
  if (!err.message?.includes('TestApp.app')) {
    const msg = err.stderr ? err.stderr.toString().split('\n')[0] : err.message.split('\n')[0];
    console.log(`  XX  .app bundle packaging — ${msg}`);
    failed += 6;
  }
}

// ── Test 2: --app-bundle auto-appends .app if missing ──

const appOut2 = path.join(projectDir, 'NoExt');
try {
  execFileSync(process.execPath, [
    HAKOBU_BIN, projectDir, '--app-bundle', '--output', appOut2,
  ], { timeout: 300000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  test('.app bundle: .app appended when missing from --output', () => {
    if (!fs.existsSync(appOut2 + '.app')) throw new Error('NoExt.app not found');
    if (!fs.existsSync(path.join(appOut2 + '.app', 'Contents', 'MacOS')))
      throw new Error('Missing Contents/MacOS');
  });
} catch (err) {
  const msg = err.stderr ? err.stderr.toString().split('\n')[0] : err.message.split('\n')[0];
  console.log(`  XX  .app auto-append — ${msg}`);
  failed++;
}

// ── Test 3: default output (no --app-bundle) is still raw executable ──

const rawOut = path.join(projectDir, 'raw-test');
try {
  execFileSync(process.execPath, [
    HAKOBU_BIN, projectDir, '--output', rawOut,
  ], { timeout: 300000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  test('Default output: raw executable (no .app)', () => {
    if (!fs.existsSync(rawOut)) throw new Error('Raw output not found');
    if (!fs.statSync(rawOut).isFile()) throw new Error('Raw output is not a file');
    // Should NOT have .app structure
    if (fs.existsSync(path.join(rawOut, 'Contents')))
      throw new Error('Raw output should not be a .app bundle');
  });

  test('Default output: raw executable runs', () => {
    const output = execFileSync(rawOut, [], {
      timeout: 15000, encoding: 'utf8',
    });
    if (!output.includes('format=app-bundle-test'))
      throw new Error('Unexpected output: ' + output.slice(0, 100));
  });
} catch (err) {
  const msg = err.stderr ? err.stderr.toString().split('\n')[0] : err.message.split('\n')[0];
  console.log(`  XX  Default raw output — ${msg}`);
  failed += 2;
}

// ── Cleanup ──
try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch {}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
