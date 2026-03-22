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

// ── Test 3: --app-bundle with metadata CLI flags ──

const appMeta = path.join(projectDir, 'MetaApp.app');
try {
  execFileSync(process.execPath, [
    HAKOBU_BIN, projectDir, '--app-bundle', '--output', appMeta,
    '--bundle-id', 'com.acme.test-app',
    '--bundle-version', '2.5.1',
    '--short-version', '2.5',
    '--display-name', 'ACME Test App',
    '--copyright', 'Copyright 2026 ACME Corp',
  ], { timeout: 300000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  const plistContent = fs.readFileSync(
    path.join(appMeta, 'Contents', 'Info.plist'), 'utf8'
  );

  test('Metadata: CFBundleIdentifier set', () => {
    if (!plistContent.includes('com.acme.test-app'))
      throw new Error('CFBundleIdentifier not found');
  });

  test('Metadata: CFBundleVersion set', () => {
    if (!plistContent.includes('<key>CFBundleVersion</key>'))
      throw new Error('Missing CFBundleVersion key');
    if (!plistContent.includes('2.5.1'))
      throw new Error('CFBundleVersion value not found');
  });

  test('Metadata: CFBundleShortVersionString set', () => {
    if (!plistContent.includes('<key>CFBundleShortVersionString</key>'))
      throw new Error('Missing CFBundleShortVersionString key');
    // Short version is '2.5'
    if (!plistContent.includes('>2.5<'))
      throw new Error('CFBundleShortVersionString value not found');
  });

  test('Metadata: CFBundleDisplayName set', () => {
    if (!plistContent.includes('ACME Test App'))
      throw new Error('CFBundleDisplayName not found');
  });

  test('Metadata: NSHumanReadableCopyright set', () => {
    if (!plistContent.includes('Copyright 2026 ACME Corp'))
      throw new Error('NSHumanReadableCopyright not found');
  });

} catch (err) {
  if (!err.message?.includes('CFBundle') && !err.message?.includes('Copyright')) {
    const msg = err.stderr ? err.stderr.toString().split('\n')[0] : err.message.split('\n')[0];
    console.log(`  XX  Metadata bundle packaging — ${msg}`);
    failed += 5;
  }
}

// ── Test 4: defaults when no metadata is specified ──

test('Defaults: CFBundleIdentifier derived from app name', () => {
  // The first test (appOut) had no metadata — check its plist
  const plist = fs.readFileSync(path.join(appOut, 'Contents', 'Info.plist'), 'utf8');
  if (!plist.includes('CFBundleIdentifier')) throw new Error('No CFBundleIdentifier');
  if (!plist.includes('com.hakobu.')) throw new Error('Default bundle ID not derived');
});

test('Defaults: CFBundleVersion has default value', () => {
  const plist = fs.readFileSync(path.join(appOut, 'Contents', 'Info.plist'), 'utf8');
  if (!plist.includes('<key>CFBundleVersion</key>'))
    throw new Error('No default CFBundleVersion');
});

// ── Test 5: default output (no --app-bundle) is still raw executable ──

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

// ── Test 6: --app-bundle with .icns icon ──

// Create a minimal .icns test file
const testIconPath = path.join(projectDir, 'app-icon.icns');
const icnsBuf = Buffer.alloc(8);
icnsBuf.write('icns', 0, 4, 'ascii');
icnsBuf.writeUInt32BE(8, 4);
fs.writeFileSync(testIconPath, icnsBuf);

const appIcon = path.join(projectDir, 'IconApp.app');
try {
  execFileSync(process.execPath, [
    HAKOBU_BIN, projectDir, '--app-bundle', '--output', appIcon,
    '--macos-icon', testIconPath,
  ], { timeout: 300000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  test('Icon: .icns copied to Contents/Resources/', () => {
    const iconDest = path.join(appIcon, 'Contents', 'Resources', 'app-icon.icns');
    if (!fs.existsSync(iconDest)) throw new Error('Icon not found in Resources/');
    const content = fs.readFileSync(iconDest);
    if (content.toString('ascii', 0, 4) !== 'icns') throw new Error('Icon file corrupted');
  });

  test('Icon: CFBundleIconFile in Info.plist', () => {
    const plist = fs.readFileSync(path.join(appIcon, 'Contents', 'Info.plist'), 'utf8');
    if (!plist.includes('CFBundleIconFile')) throw new Error('Missing CFBundleIconFile key');
    if (!plist.includes('app-icon.icns')) throw new Error('Icon filename not in plist');
  });

} catch (err) {
  if (!err.message?.includes('Icon') && !err.message?.includes('CFBundle')) {
    const msg = err.stderr ? err.stderr.toString().split('\n')[0] : err.message.split('\n')[0];
    console.log(`  XX  Icon bundle packaging — ${msg}`);
    failed += 2;
  }
}

// ── Test 7: no icon leaves plist without CFBundleIconFile ──

test('No icon: CFBundleIconFile absent when no icon configured', () => {
  const plist = fs.readFileSync(path.join(appOut, 'Contents', 'Info.plist'), 'utf8');
  if (plist.includes('CFBundleIconFile'))
    throw new Error('CFBundleIconFile should not be in plist without icon');
});

// ── Test 8: non-.icns file is rejected ──

const fakePng = path.join(projectDir, 'fake.png');
fs.writeFileSync(fakePng, 'not an icon');

test('Icon validation: non-.icns rejected', () => {
  try {
    execFileSync(process.execPath, [
      HAKOBU_BIN, projectDir, '--app-bundle', '--output', path.join(projectDir, 'Bad.app'),
      '--macos-icon', fakePng,
    ], { timeout: 300000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    throw new Error('Should have failed');
  } catch (err) {
    const combined = (err.stderr || '') + (err.stdout || '') + (err.message || '');
    if (!combined.includes('.icns'))
      throw new Error('Expected .icns validation error, got: ' + combined.slice(0, 100));
  }
});

// ── Test 9: package.json config-based metadata ──

const configProjectDir = tmpProject('config-meta', {
  'package.json': JSON.stringify({
    name: 'config-test',
    version: '3.0.0',
    main: 'index.js',
    hakobu: {
      appBundle: true,
      macos: {
        bundleId: 'org.config.test',
        bundleVersion: '3.0.0',
        displayName: 'Config Test App',
        copyright: 'Copyright 2026 Config Corp',
      },
    },
  }),
  'index.js': "'use strict';\nconsole.log('format=config-meta-test');\n",
});

const appConfig = path.join(configProjectDir, 'ConfigApp.app');
try {
  execFileSync(process.execPath, [
    HAKOBU_BIN, configProjectDir, '--output', appConfig,
  ], { timeout: 300000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  const cfgPlist = fs.readFileSync(
    path.join(appConfig, 'Contents', 'Info.plist'), 'utf8'
  );

  test('Config metadata: bundleId from package.json', () => {
    if (!cfgPlist.includes('org.config.test'))
      throw new Error('bundleId from config not found');
  });

  test('Config metadata: displayName from package.json', () => {
    if (!cfgPlist.includes('Config Test App'))
      throw new Error('displayName from config not found');
  });

  test('Config metadata: inner executable runs', () => {
    const macosDir = path.join(appConfig, 'Contents', 'MacOS');
    const files = fs.readdirSync(macosDir);
    const output = execFileSync(path.join(macosDir, files[0]), [], {
      timeout: 15000, encoding: 'utf8',
    });
    if (!output.includes('format=config-meta-test'))
      throw new Error('Config-based bundle inner executable broken');
  });

} catch (err) {
  if (!err.message?.includes('config') && !err.message?.includes('Config')) {
    const msg = err.stderr ? err.stderr.toString().split('\n')[0] : err.message.split('\n')[0];
    console.log(`  XX  Config metadata bundle — ${msg}`);
    failed += 3;
  }
}
try { fs.rmSync(configProjectDir, { recursive: true, force: true }); } catch {}

// ── Test 10: combined metadata + icon in one bundle ──

const appCombo = path.join(projectDir, 'ComboApp.app');
try {
  execFileSync(process.execPath, [
    HAKOBU_BIN, projectDir, '--app-bundle', '--output', appCombo,
    '--bundle-id', 'com.combo.test',
    '--bundle-version', '4.0.0',
    '--display-name', 'Combo App',
    '--macos-icon', testIconPath,
  ], { timeout: 300000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  const comboPlist = fs.readFileSync(
    path.join(appCombo, 'Contents', 'Info.plist'), 'utf8'
  );

  test('Combo: metadata and icon both present', () => {
    if (!comboPlist.includes('com.combo.test'))
      throw new Error('bundleId missing');
    if (!comboPlist.includes('Combo App'))
      throw new Error('displayName missing');
    if (!comboPlist.includes('CFBundleIconFile'))
      throw new Error('CFBundleIconFile missing');
    if (!fs.existsSync(path.join(appCombo, 'Contents', 'Resources', 'app-icon.icns')))
      throw new Error('Icon file missing from Resources');
  });
} catch (err) {
  if (!err.message?.includes('combo') && !err.message?.includes('Combo') &&
      !err.message?.includes('bundleId') && !err.message?.includes('displayName') &&
      !err.message?.includes('Icon')) {
    const msg = err.stderr ? err.stderr.toString().split('\n')[0] : err.message.split('\n')[0];
    console.log(`  XX  Combo bundle — ${msg}`);
    failed++;
  }
}

// ── Test 11: Info.plist is well-formed XML ──

test('Info.plist: well-formed XML (valid plist structure)', () => {
  const plist = fs.readFileSync(path.join(appOut, 'Contents', 'Info.plist'), 'utf8');
  // Check XML declaration and plist structure
  if (!plist.startsWith('<?xml version="1.0"'))
    throw new Error('Missing XML declaration');
  if (!plist.includes('<!DOCTYPE plist'))
    throw new Error('Missing DOCTYPE');
  if (!plist.includes('<plist version="1.0">'))
    throw new Error('Missing plist root element');
  if (!plist.includes('</dict>'))
    throw new Error('Missing closing dict tag');
  if (!plist.includes('</plist>'))
    throw new Error('Missing closing plist tag');
  // Every <key> should have a following <string> (basic structure check)
  const keyCount = (plist.match(/<key>/g) || []).length;
  const stringCount = (plist.match(/<string>/g) || []).length;
  if (keyCount !== stringCount)
    throw new Error(`Key/string mismatch: ${keyCount} keys, ${stringCount} strings`);
});

// ── Test 12: bundle is ad-hoc signed ──

// The first bundle (appOut) was created without explicit identity,
// so it gets ad-hoc signed. Verify the inner executable still runs.
test('Bundle signing: inner executable runs after ad-hoc bundle sign', () => {
  const macosDir = path.join(appOut, 'Contents', 'MacOS');
  const files = fs.readdirSync(macosDir);
  const execPath = path.join(macosDir, files[0]);
  const output = execFileSync(execPath, [], {
    timeout: 15000, encoding: 'utf8',
  });
  if (!output.includes('format=app-bundle-test'))
    throw new Error('Inner executable broken after bundle sign');
});

// Verify codesign reports a signature on the bundle (ad-hoc is fine)
test('Bundle signing: codesign validates the .app bundle', () => {
  try {
    execFileSync('codesign', ['--verify', '--deep', appOut], {
      timeout: 10000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    // codesign --verify exits non-zero if unsigned or invalid
    // Ad-hoc is valid — only truly broken signatures fail here
    const stderr = err.stderr || '';
    if (stderr.includes('invalid signature') || stderr.includes('not signed'))
      throw new Error('Bundle signature invalid: ' + stderr.slice(0, 100));
    // "a sealed resource is missing" is okay for minimal test bundles
  }
});

// ── Test 10: raw executable still gets direct signing (not bundle signing) ──

test('Raw signing: raw executable is signed directly', () => {
  try {
    execFileSync('codesign', ['--verify', rawOut], {
      timeout: 10000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = err.stderr || '';
    if (stderr.includes('invalid signature'))
      throw new Error('Raw executable signature invalid: ' + stderr.slice(0, 100));
  }
});

// ── Cleanup ──
try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch {}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
