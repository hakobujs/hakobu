#!/usr/bin/env node
/**
 * Exit cleanup verification.
 *
 * Tests that temp files created during compressed payload extraction
 * are cleaned up even when the app calls process.exit() explicitly.
 *
 * The bug: the prelude used process.on('beforeExit', ...) which does
 * NOT fire on process.exit(). The fix uses process.on('exit', ...).
 *
 * Run: node fixtures/test-exit-cleanup.js
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

console.log('\n=== Exit Cleanup Verification ===\n');

// Create a project that calls process.exit()
const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-exit-cleanup-'));
fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
  name: 'exit-cleanup-test', version: '1.0.0', main: 'index.js',
}));
fs.writeFileSync(path.join(projectDir, 'index.js'), `
'use strict';
console.log('format=exit-cleanup');
console.log('exit_code=0');
process.exit(0);
`);

const ext = process.platform === 'win32' ? '.exe' : '';

// ── Test 1: Compressed build with process.exit() cleans up ──

const compOut = path.join(projectDir, 'compressed' + ext);
try {
  execFileSync(process.execPath, [
    HAKOBU_BIN, projectDir,
    '--compress', 'Brotli',
    '--output', compOut,
  ], { timeout: 300000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  // Record pkg-* temp dirs BEFORE running the executable
  const tmpdir = os.tmpdir();
  const beforeDirs = fs.readdirSync(tmpdir).filter(d => d.startsWith('pkg-'));

  // Run the compressed executable (it calls process.exit(0))
  const output = execFileSync(compOut, [], {
    timeout: 15000, encoding: 'utf8',
  });

  test('Compressed + process.exit(): runs correctly', () => {
    if (!output.includes('format=exit-cleanup'))
      throw new Error('Unexpected output: ' + output.slice(0, 100));
  });

  // Check for new pkg-* temp dirs AFTER running
  const afterDirs = fs.readdirSync(tmpdir).filter(d => d.startsWith('pkg-'));
  const newDirs = afterDirs.filter(d => !beforeDirs.includes(d));

  test('Compressed + process.exit(): no temp dirs left behind', () => {
    if (newDirs.length > 0) {
      throw new Error(`Temp dir(s) left behind: ${newDirs.join(', ')}`);
    }
  });

} catch (err) {
  if (passed === 0) {
    const msg = err.stderr ? err.stderr.toString().split('\n')[0] : err.message.split('\n')[0];
    console.error('  Package FAILED:', msg);
    failed += 2;
  }
}

// ── Test 2: Uncompressed build with process.exit() also works ──

const plainOut = path.join(projectDir, 'plain' + ext);
try {
  execFileSync(process.execPath, [
    HAKOBU_BIN, projectDir,
    '--output', plainOut,
  ], { timeout: 300000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  const output = execFileSync(plainOut, [], {
    timeout: 15000, encoding: 'utf8',
  });

  test('Uncompressed + process.exit(): runs correctly', () => {
    if (!output.includes('format=exit-cleanup'))
      throw new Error('Unexpected output: ' + output.slice(0, 100));
  });

} catch (err) {
  const msg = err.stderr ? err.stderr.toString().split('\n')[0] : err.message.split('\n')[0];
  console.error('  Uncompressed FAILED:', msg);
  failed++;
}

// ── Test 3: Normal exit (no process.exit()) still works ──

fs.writeFileSync(path.join(projectDir, 'index.js'), `
'use strict';
console.log('format=normal-exit');
// No process.exit() — normal completion
`);

const normalOut = path.join(projectDir, 'normal' + ext);
try {
  execFileSync(process.execPath, [
    HAKOBU_BIN, projectDir,
    '--compress', 'GZip',
    '--output', normalOut,
  ], { timeout: 300000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  const tmpdir = os.tmpdir();
  const beforeDirs = fs.readdirSync(tmpdir).filter(d => d.startsWith('pkg-'));

  const output = execFileSync(normalOut, [], {
    timeout: 15000, encoding: 'utf8',
  });

  const afterDirs = fs.readdirSync(tmpdir).filter(d => d.startsWith('pkg-'));
  const newDirs = afterDirs.filter(d => !beforeDirs.includes(d));

  test('GZip + normal exit: runs correctly', () => {
    if (!output.includes('format=normal-exit'))
      throw new Error('Unexpected output: ' + output.slice(0, 100));
  });

  test('GZip + normal exit: no temp dirs left behind', () => {
    if (newDirs.length > 0) {
      throw new Error(`Temp dir(s) left behind: ${newDirs.join(', ')}`);
    }
  });

} catch (err) {
  if (!err.message?.includes('format=')) {
    const msg = err.stderr ? err.stderr.toString().split('\n')[0] : err.message.split('\n')[0];
    console.error('  GZip normal FAILED:', msg);
    failed += 2;
  }
}

// Cleanup
try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch {}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
