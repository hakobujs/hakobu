#!/usr/bin/env node
/**
 * Workspace bundle verification.
 *
 * Tests that Hakobu's bundle mode correctly resolves workspace:*
 * dependencies (symlinked packages in a monorepo).
 *
 * The fixture has:
 *   packages/app  — TypeScript entry, depends on @workspace/lib
 *   packages/lib  — TypeScript library, symlinked into app/node_modules/
 *
 * Run: node fixtures/test-workspace-bundle.js
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HAKOBU_BIN = path.join(__dirname, '../packages/hakobu/lib-es5/bin.js');
const FIXTURE_DIR = path.join(__dirname, 'workspace-bundle/packages/app');

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

console.log('\n=== Workspace Bundle Verification ===\n');

// Package the workspace app with bundle mode
const ext = process.platform === 'win32' ? '.exe' : '';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-workspace-'));
const outPath = path.join(tmpDir, 'workspace-app' + ext);

let packStdout = '';
try {
  packStdout = execFileSync(process.execPath, [
    HAKOBU_BIN, FIXTURE_DIR,
    '--bundle', '--entry', 'src/index.ts',
    '--output', outPath,
  ], {
    timeout: 300000,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  test('Bundle: packages successfully', () => {
    if (!fs.existsSync(outPath)) throw new Error('Output not found');
  });

  test('Bundle: workspace dependency resolved by bundler', () => {
    // The bundler should have inlined the workspace lib — no unresolved warnings
    if (packStdout.includes('Could not resolve') && packStdout.includes('@workspace/lib'))
      throw new Error('Workspace dependency not resolved by bundler');
  });

  // Run the packaged executable
  const output = execFileSync(outPath, [], {
    timeout: 15000,
    encoding: 'utf8',
  });

  test('Runtime: executable runs correctly', () => {
    if (!output.includes('format=workspace-bundle'))
      throw new Error('Unexpected output: ' + output.slice(0, 100));
  });

  test('Runtime: workspace lib function works (greet)', () => {
    if (!output.includes('Hello from workspace lib, hakobu!'))
      throw new Error('greet() failed: ' + output);
  });

  test('Runtime: workspace lib function works (add)', () => {
    if (!output.includes('add_result=42'))
      throw new Error('add() failed: ' + output);
  });

  test('Runtime: workspace lib constant accessible', () => {
    if (!output.includes('lib_version="1.0.0"'))
      throw new Error('LIB_VERSION not found: ' + output);
  });

  test('Runtime: workspace resolution confirmed', () => {
    if (!output.includes('workspace_resolved=true'))
      throw new Error('workspace_resolved not true');
  });

} catch (err) {
  if (passed === 0) {
    const stderr = err.stderr ? err.stderr.toString().trim() : '';
    const stdout = err.stdout ? err.stdout.toString().trim() : '';
    console.error('  Package FAILED:', err.message.split('\n')[0]);
    if (stderr) {
      console.error('  STDERR (last 5 lines):');
      for (const line of stderr.split('\n').slice(-5)) console.error('    ' + line);
    }
    if (stdout) {
      console.error('  STDOUT (last 5 lines):');
      for (const line of stdout.split('\n').slice(-5)) console.error('    ' + line);
    }
    failed += 7;
  }
}

// Cleanup
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
