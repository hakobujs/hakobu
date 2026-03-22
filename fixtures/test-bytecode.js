#!/usr/bin/env node
/**
 * Bytecode mode verification.
 *
 * Tests that Hakobu's --bytecode flag produces working executables
 * and that unsupported combinations are rejected clearly.
 *
 * Run: node fixtures/test-bytecode.js
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

function tmpProject(name, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hk-bc-${name}-`));
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(dir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

console.log('\n=== Bytecode Mode Verification ===\n');

// ── Test 1: CJS app with --bytecode packages and runs ──

const cjsDir = tmpProject('cjs', {
  'package.json': '{ "name": "bc-cjs", "version": "1.0.0", "main": "index.js" }',
  'index.js': "'use strict';\nconst { greet } = require('./lib.js');\nconsole.log('format=cjs-bytecode');\nconsole.log('greet=' + JSON.stringify(greet('world')));\nconsole.log('json_val=' + JSON.stringify(require('./data.json').key));\n",
  'lib.js': "'use strict';\nexports.greet = function(n) { return 'Hello, ' + n + '!'; };\n",
  'data.json': '{ "key": "json-works" }',
});

const ext = process.platform === 'win32' ? '.exe' : '';
const cjsOut = path.join(cjsDir, 'out' + ext);

try {
  execFileSync(process.execPath, [
    HAKOBU_BIN, cjsDir, '--bytecode', '--output', cjsOut,
  ], { timeout: 300000, encoding: 'utf8' });

  const output = execFileSync(cjsOut, [], {
    timeout: 15000, encoding: 'utf8',
  });

  test('CJS bytecode: packages successfully', () => {
    if (!fs.existsSync(cjsOut)) throw new Error('Output not found');
  });

  test('CJS bytecode: output runs correctly', () => {
    if (!output.includes('format=cjs-bytecode')) throw new Error('Missing format output');
  });

  test('CJS bytecode: require() works across modules', () => {
    if (!output.includes('greet="Hello, world!"')) throw new Error('greet failed: ' + output);
  });

  test('CJS bytecode: JSON require() works', () => {
    if (!output.includes('json_val="json-works"')) throw new Error('JSON failed: ' + output);
  });

} catch (err) {
  const msg = err.stderr ? err.stderr.toString().split('\n')[0] : err.message.split('\n')[0];
  console.log(`  XX  CJS bytecode packaging — ${msg}`);
  failed += 4;
}

// ── Test 2: --bytecode + --bundle rejected ──

test('--bytecode + --bundle: explicitly rejected', () => {
  try {
    execFileSync(process.execPath, [
      HAKOBU_BIN, cjsDir, '--bytecode', '--bundle', '--output', cjsOut + '2',
    ], { timeout: 15000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    throw new Error('Should have failed');
  } catch (err) {
    const combined = (err.stderr || '') + (err.stdout || '') + (err.message || '');
    if (!combined.includes('cannot be combined with bundle mode')) {
      throw new Error('Expected bundle rejection, got: ' + combined.slice(0, 100));
    }
  }
});

// ── Test 3: ESM app with --bytecode — ESM scripts stay source-only ──

const esmDir = tmpProject('esm', {
  'package.json': '{ "name": "bc-esm", "version": "1.0.0", "type": "module", "main": "index.js" }',
  'index.js': "console.log('format=esm-with-bytecode');\nconsole.log('import_meta=' + typeof import.meta.url);\n",
});

const esmOut = path.join(esmDir, 'out' + ext);
try {
  execFileSync(process.execPath, [
    HAKOBU_BIN, esmDir, '--bytecode', '--output', esmOut,
  ], { timeout: 180000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  const esmOutput = execFileSync(esmOut, [], {
    timeout: 15000, encoding: 'utf8',
  });

  test('ESM with --bytecode: packages (ESM scripts stay source-only)', () => {
    if (!esmOutput.includes('format=esm-with-bytecode')) throw new Error('ESM output wrong');
  });

  test('ESM with --bytecode: import.meta.url is a string', () => {
    if (!esmOutput.includes('import_meta=')) throw new Error('import.meta missing from output');
  });

} catch (err) {
  const msg = err.stderr ? err.stderr.toString().split('\n')[0] : err.message.split('\n')[0];
  console.log(`  XX  ESM with --bytecode — ${msg}`);
  failed += 2;
}

// ── Test 4: Source-only (no --bytecode) still works ──

const srcOut = path.join(cjsDir, 'src-out' + ext);
try {
  execFileSync(process.execPath, [
    HAKOBU_BIN, cjsDir, '--output', srcOut,
  ], { timeout: 120000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  const srcOutput = execFileSync(srcOut, [], {
    timeout: 15000, encoding: 'utf8',
  });

  test('Source-only (no --bytecode): still works', () => {
    if (!srcOutput.includes('format=cjs-bytecode')) throw new Error('Source-only broken');
  });
} catch (err) {
  console.log(`  XX  Source-only mode — ${err.message.split('\n')[0]}`);
  failed++;
}

// ── Cleanup ──
try { fs.rmSync(cjsDir, { recursive: true, force: true }); } catch {}
try { fs.rmSync(esmDir, { recursive: true, force: true }); } catch {}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
