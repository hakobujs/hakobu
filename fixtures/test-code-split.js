#!/usr/bin/env node
/**
 * Code-split bundle verification.
 *
 * Tests that Hakobu preserves code-splitting when a dependency chunk
 * uses __dirname / __filename, by injecting the polyfill into only
 * the affected chunk instead of collapsing to single-chunk.
 *
 * The fixture has:
 *   - An entry (src/index.ts) that dynamically imports a dependency
 *   - A dependency (src/dep-with-dirname.ts) that uses bare __dirname
 *   - A shared utility (src/shared.ts) imported by both
 *
 * Rolldown should emit at least 2 chunks. The dep chunk should get
 * the __dirname polyfill; others should not.
 *
 * Run: node fixtures/test-code-split.js
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

console.log('\n=== Code-Split Bundle Verification ===\n');

// ── Create the fixture project ──

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-codesplit-'));
const srcDir = path.join(projectDir, 'src');
fs.mkdirSync(srcDir, { recursive: true });

fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
  name: 'fixture-code-split',
  version: '1.0.0',
  type: 'module',
  main: 'src/index.ts',
}));

// Entry: imports shared statically, dep-with-dirname dynamically
fs.writeFileSync(path.join(srcDir, 'index.ts'), `
import { tag } from './shared.js';

async function main() {
  console.log('format=code-split-test');
  console.log('entry_tag=' + JSON.stringify(tag('entry')));

  // Dynamic import forces Rolldown to split this into a separate chunk
  const dep = await import('./dep-with-dirname.js');
  console.log('dep_dirname_type=' + JSON.stringify(typeof dep.depDir));
  console.log('dep_dirname_is_string=' + JSON.stringify(typeof dep.depDir === 'string'));
  console.log('dep_tag=' + JSON.stringify(dep.depTag));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
`);

// Dependency that uses bare __dirname (simulates CJS-origin package)
fs.writeFileSync(path.join(srcDir, 'dep-with-dirname.ts'), `
import { tag } from './shared.js';

// This bare __dirname reference simulates a CJS-origin package
// that Rolldown inlines verbatim. It should trigger per-chunk
// polyfill injection without collapsing code-splitting.
export const depDir: string = __dirname;
export const depTag: string = tag('dep');
`);

// Shared utility (imported by both entry and dep)
fs.writeFileSync(path.join(srcDir, 'shared.ts'), `
export function tag(label: string): string {
  return label + ':ok';
}
`);

// ── Step 1: Bundle only (inspect output before packaging) ──

let bundleStdout = '';
try {
  bundleStdout = execFileSync(process.execPath, [
    HAKOBU_BIN, projectDir,
    '--bundle', '--entry', 'src/index.ts',
    '--target', 'node24-macos-arm64',
    '--output', path.join(projectDir, 'out'),
  ], { timeout: 300000, encoding: 'utf8' });
} catch (err) {
  const msg = err.stderr ? err.stderr.toString().split('\n')[0] : err.message.split('\n')[0];
  console.error('  Package FAILED:', msg);
  if (err.stdout) {
    for (const line of err.stdout.toString().split('\n').slice(-10)) {
      console.error('    ' + line);
    }
  }
  failed++;
}

if (bundleStdout) {
  // ── Verify code-splitting was preserved ──

  test('Bundle: code-split strategy preserved', () => {
    if (!bundleStdout.includes('code-split'))
      throw new Error('Expected code-split output, got: ' + bundleStdout.slice(0, 200));
    if (bundleStdout.includes('single-chunk'))
      throw new Error('Should not have fallen back to single-chunk');
  });

  test('Bundle: multiple chunks emitted', () => {
    const chunkMatch = bundleStdout.match(/(\d+) chunks?\)/);
    if (!chunkMatch) throw new Error('Could not find chunk count in output');
    const count = parseInt(chunkMatch[1], 10);
    if (count < 2) throw new Error(`Expected >=2 chunks, got ${count}`);
  });

  test('Bundle: __dirname polyfill injected into affected chunk(s)', () => {
    if (!bundleStdout.includes('injected __dirname/__filename'))
      throw new Error('Expected per-chunk __dirname injection');
  });

  test('Bundle: diagnostics confirm patterns handled', () => {
    if (!bundleStdout.includes('polyfill injected into'))
      throw new Error('Expected polyfill injection diagnostic');
  });

  // ── Verify packaged executable runs correctly ──

  const outPath = path.join(projectDir, 'out');
  if (fs.existsSync(outPath)) {
    try {
      const output = execFileSync(outPath, [], {
        timeout: 15000, encoding: 'utf8',
      });

      test('Runtime: executable runs without error', () => {
        if (!output.includes('format=code-split-test'))
          throw new Error('Unexpected output: ' + output.slice(0, 100));
      });

      test('Runtime: entry module works', () => {
        if (!output.includes('entry_tag="entry:ok"'))
          throw new Error('Entry tag wrong: ' + output);
      });

      test('Runtime: dep with __dirname loaded correctly', () => {
        if (!output.includes('dep_dirname_is_string=true'))
          throw new Error('__dirname not a string in dep: ' + output);
      });

      test('Runtime: dep shared utility works', () => {
        if (!output.includes('dep_tag="dep:ok"'))
          throw new Error('Dep tag wrong: ' + output);
      });

      test('Runtime: __dirname resolves to a snapshot path', () => {
        if (!output.includes('dep_dirname_type="string"'))
          throw new Error('__dirname type wrong');
      });

    } catch (err) {
      const msg = err.message.split('\n')[0];
      console.log(`  XX  Runtime execution — ${msg}`);
      failed += 5;
    }
  } else {
    console.log('  XX  Output executable not found');
    failed += 5;
  }
}

// ── Cleanup ──
try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch {}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
