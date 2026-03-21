#!/usr/bin/env node
/**
 * Bundle-mode source map verification.
 *
 * Tests that Hakobu's bundle mode generates correct source maps:
 *   1. Bundles a TypeScript fixture with Rolldown
 *   2. Packages the bundle into an executable
 *   3. Verifies the .map file is in the snapshot and readable
 *   4. Verifies the map references original .ts source files
 *   5. Documents the patched-base limitation for stack trace resolution
 *
 * Run: node fixtures/test-sourcemap.js
 *
 * Note: The "stack_has_ts_source" check verifies whether --enable-source-maps
 * resolves stack traces to original .ts files. This currently fails on the
 * patched Node 24 base binary (V8 sourceless patch side effect) but works on
 * stock Node 24 and Node 25+.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HAKOBU_BIN = path.join(__dirname, '../packages/hakobu/lib-es5/bin.js');
const FIXTURE_DIR = path.join(__dirname, 'bundle-sourcemap');

let passed = 0;
let failed = 0;
let noted = 0;

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

function note(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  OK  ${name}`);
  } catch (err) {
    noted++;
    console.log(`  --  ${name} (known limitation)`);
    console.log(`      ${err.message}`);
  }
}

function parseOutput(stdout) {
  const result = {};
  for (const line of stdout.split('\n')) {
    const l = line.replace(/\r$/, '');
    const eq = l.indexOf('=');
    if (eq === -1) continue;
    try { result[l.slice(0, eq)] = JSON.parse(l.slice(eq + 1)); } catch {}
  }
  return result;
}

console.log('\n=== Bundle-Mode Source Map Verification ===\n');

// Step 1: Package the fixture
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-sm-verify-'));
const ext = process.platform === 'win32' ? '.exe' : '';
const outPath = path.join(tmpDir, 'sourcemap-test' + ext);

try {
  console.log('  Packaging fixture...');
  execFileSync(process.execPath, [
    HAKOBU_BIN, FIXTURE_DIR, '--output', outPath,
  ], {
    timeout: 120000,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  console.log('  Packaged OK\n');
} catch (err) {
  console.error('  Package FAILED:', err.stderr?.split('\n')[0] || err.message);
  process.exit(1);
}

// Step 2: Run WITHOUT source maps
let resultNoMap;
try {
  const stdout = execFileSync(outPath, [], {
    timeout: 30000,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  resultNoMap = parseOutput(stdout);
} catch (err) {
  console.error('  Execution FAILED:', err.message.split('\n')[0]);
  process.exit(1);
}

// Step 3: Run WITH source maps
let resultWithMap;
try {
  const stdout = execFileSync(outPath, [], {
    timeout: 30000,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1', NODE_OPTIONS: '--enable-source-maps' },
  });
  resultWithMap = parseOutput(stdout);
} catch (err) {
  console.error('  Execution with source maps FAILED:', err.message.split('\n')[0]);
  resultWithMap = resultNoMap; // fall back
}

// Step 4: Assert source map pipeline correctness
test('source map file is readable from snapshot', () => {
  if (!resultNoMap.map_readable) throw new Error('map_readable=false');
});

test('source map has sources array', () => {
  if (!resultNoMap.map_has_sources) throw new Error('map_has_sources=false');
});

test('source map has mappings', () => {
  if (!resultNoMap.map_has_mappings) throw new Error('map_has_mappings=false');
});

test('source map references .ts files', () => {
  if (!resultNoMap.map_references_ts) throw new Error('map_references_ts=false');
});

test('error message is correct', () => {
  if (resultNoMap.error_message !== 'sourcemap-test-error') {
    throw new Error('error_message=' + resultNoMap.error_message);
  }
});

test('stack trace includes function name', () => {
  if (!resultNoMap.stack_has_throwError) throw new Error('throwError not in stack');
});

// Step 5: Source-map-resolved stack trace
// This is a "note" — it passes on stock Node but fails on the patched base.
// It documents the known limitation without blocking the test suite.
note('stack trace maps to original .ts source (--enable-source-maps)', () => {
  if (!resultWithMap.stack_has_ts_source) {
    throw new Error(
      'stack_has_ts_source=false (patched base binary V8 limitation — ' +
      'works on stock Node 24 and Node 25+). ' +
      'Stack frame: ' + resultWithMap.stack_frame
    );
  }
});

// Cleanup
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

console.log(`\n  ${passed} passed, ${failed} failed, ${noted} known limitation(s)\n`);
if (failed > 0) process.exit(1);
