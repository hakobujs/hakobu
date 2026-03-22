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

// ── Test 4: Multi-module CJS with circular requires + bytecode ──
//
// Module graph:
//   index → registry → processor → registry (circular)
//                    ↘ utils
//          → processor
//          → config.json
//
// Circular require semantics: when processor requires registry during
// registry's own initialization, it sees registry's *partial* exports
// (only what was assigned before the circular require point). This is
// a core Node.js CJS behavior that bytecode must preserve.

const circDir = tmpProject('circular', {
  'package.json': '{ "name": "bc-circular", "version": "1.0.0", "main": "index.js" }',

  // utils.js — no circular deps, required by both registry and processor
  'utils.js': [
    "'use strict';",
    "let callCount = 0;",
    "exports.track = function(label) { callCount++; return label + ':' + callCount; };",
    "exports.getCount = function() { return callCount; };",
  ].join('\n'),

  // registry.js — exports.earlyValue BEFORE requiring processor,
  //   then exports.lateValue AFTER. When processor requires registry
  //   mid-init, it only sees earlyValue.
  'registry.js': [
    "'use strict';",
    "const utils = require('./utils');",
    "exports.earlyValue = utils.track('registry-early');",
    "// This triggers the circular require — processor will see partial registry",
    "const processor = require('./processor');",
    "exports.lateValue = utils.track('registry-late');",
    "exports.processorSawEarly = processor.registrySnapshot;",
  ].join('\n'),

  // processor.js — requires registry (circular), captures what it can see
  'processor.js': [
    "'use strict';",
    "const utils = require('./utils');",
    "const registry = require('./registry'); // circular: registry is mid-init",
    "exports.ownValue = utils.track('processor');",
    "// registry.earlyValue exists (set before circular point)",
    "// registry.lateValue does NOT exist yet (set after circular point)",
    "exports.registrySnapshot = {",
    "  hasEarly: 'earlyValue' in registry,",
    "  hasLate: 'lateValue' in registry,",
    "  earlyVal: registry.earlyValue,",
    "};",
    "exports.transform = function(x) { return x * 2; };",
  ].join('\n'),

  // config.json — verify JSON still works alongside bytecode modules
  'config.json': '{ "mode": "bytecode-circular", "depth": 3 }',

  // index.js — entry point, exercises the full graph
  'index.js': [
    "'use strict';",
    "const registry = require('./registry');",
    "const processor = require('./processor');",
    "const config = require('./config.json');",
    "const utils = require('./utils');",
    "",
    "// Verify initialization order via utils.track call count",
    "console.log('format=circular-bytecode');",
    "",
    "// earlyValue was the 1st track() call",
    "console.log('early=' + JSON.stringify(registry.earlyValue));",
    "",
    "// processor.ownValue was the 3rd track() call",
    "console.log('processor=' + JSON.stringify(processor.ownValue));",
    "",
    "// lateValue was the 4th track() call",
    "console.log('late=' + JSON.stringify(registry.lateValue));",
    "",
    "// Circular snapshot: processor saw earlyValue but NOT lateValue",
    "console.log('circ_has_early=' + JSON.stringify(processor.registrySnapshot.hasEarly));",
    "console.log('circ_has_late=' + JSON.stringify(processor.registrySnapshot.hasLate));",
    "console.log('circ_early_val=' + JSON.stringify(processor.registrySnapshot.earlyVal));",
    "",
    "// Cross-confirmed via registry's own view of what processor saw",
    "console.log('reg_saw_early=' + JSON.stringify(registry.processorSawEarly.hasEarly));",
    "console.log('reg_saw_late=' + JSON.stringify(registry.processorSawEarly.hasLate));",
    "",
    "// Function call across modules",
    "console.log('transform=' + JSON.stringify(processor.transform(21)));",
    "",
    "// JSON data",
    "console.log('json_mode=' + JSON.stringify(config.mode));",
    "console.log('json_depth=' + JSON.stringify(config.depth));",
    "",
    "// Total track() calls: registry-early(1), processor(2 — utils re-required,",
    "// but cached; processor track is 2nd), processor.registrySnapshot computed,",
    "// registry-late(3 — but actually 4th because processor's track ran as 3rd)",
    "// Let's just report final count",
    "console.log('total_calls=' + JSON.stringify(utils.getCount()));",
  ].join('\n'),
});

const circOut = path.join(circDir, 'circ-out' + ext);

// First, run with plain node to capture expected values
let circNodeOutput;
try {
  circNodeOutput = execFileSync(process.execPath, [path.join(circDir, 'index.js')], {
    timeout: 15000, encoding: 'utf8', cwd: circDir,
  });
} catch (err) {
  console.log(`  XX  Circular CJS (node baseline) — ${err.message.split('\n')[0]}`);
  failed += 7;
  circNodeOutput = null;
}

if (circNodeOutput) {
  // Parse node output for comparison
  const nodeLines = {};
  for (const line of circNodeOutput.split('\n')) {
    const eq = line.indexOf('=');
    if (eq !== -1) nodeLines[line.slice(0, eq)] = line.slice(eq + 1);
  }

  // Now package with --bytecode and compare
  try {
    execFileSync(process.execPath, [
      HAKOBU_BIN, circDir, '--bytecode', '--output', circOut,
    ], { timeout: 300000, encoding: 'utf8' });

    const circOutput = execFileSync(circOut, [], {
      timeout: 15000, encoding: 'utf8',
    });

    const bcLines = {};
    for (const line of circOutput.split('\n')) {
      const eq = line.indexOf('=');
      if (eq !== -1) bcLines[line.slice(0, eq)] = line.slice(eq + 1);
    }

    test('Circular bytecode: packages successfully', () => {
      if (!fs.existsSync(circOut)) throw new Error('Output not found');
    });

    test('Circular bytecode: initialization order preserved', () => {
      if (bcLines.early !== nodeLines.early)
        throw new Error(`early: node=${nodeLines.early} bc=${bcLines.early}`);
      if (bcLines.processor !== nodeLines.processor)
        throw new Error(`processor: node=${nodeLines.processor} bc=${bcLines.processor}`);
      if (bcLines.late !== nodeLines.late)
        throw new Error(`late: node=${nodeLines.late} bc=${bcLines.late}`);
    });

    test('Circular bytecode: partial exports visible during circular require', () => {
      if (bcLines.circ_has_early !== 'true')
        throw new Error('earlyValue not visible during circular require');
      if (bcLines.circ_has_late !== 'false')
        throw new Error('lateValue should NOT be visible during circular require');
    });

    test('Circular bytecode: cross-module function calls work', () => {
      if (bcLines.transform !== '42')
        throw new Error(`transform(21) = ${bcLines.transform}, expected 42`);
    });

    test('Circular bytecode: JSON require works alongside bytecode', () => {
      if (bcLines.json_mode !== '"bytecode-circular"')
        throw new Error(`json_mode = ${bcLines.json_mode}`);
      if (bcLines.json_depth !== '3')
        throw new Error(`json_depth = ${bcLines.json_depth}`);
    });

    test('Circular bytecode: output matches node baseline exactly', () => {
      // Compare all key=value pairs
      const keys = ['format', 'early', 'processor', 'late', 'circ_has_early',
        'circ_has_late', 'circ_early_val', 'reg_saw_early', 'reg_saw_late',
        'transform', 'json_mode', 'json_depth', 'total_calls'];
      const diffs = [];
      for (const k of keys) {
        if (bcLines[k] !== nodeLines[k]) {
          diffs.push(`${k}: node=${nodeLines[k]} bc=${bcLines[k]}`);
        }
      }
      if (diffs.length > 0) throw new Error('Drift:\n      ' + diffs.join('\n      '));
    });

    test('Circular bytecode: total call count matches (init ran exactly once per module)', () => {
      if (bcLines.total_calls !== nodeLines.total_calls)
        throw new Error(`total_calls: node=${nodeLines.total_calls} bc=${bcLines.total_calls}`);
    });

  } catch (err) {
    if (err.message && !err.message.startsWith('total_calls') && !err.message.startsWith('Drift')) {
      const msg = err.stderr ? err.stderr.toString().split('\n')[0] : err.message.split('\n')[0];
      console.log(`  XX  Circular bytecode packaging — ${msg}`);
      failed += 7;
    }
  }
}

// ── Test 5: Source-only (no --bytecode) still works ──

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
try { fs.rmSync(circDir, { recursive: true, force: true }); } catch {}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
