#!/usr/bin/env node
/**
 * Hakobu Fixture Runner
 *
 * Runs each fixture in two modes:
 *   1. Unpackaged: `node <fixture>/index.js`
 *   2. Packaged:   `hakobu <fixture> → execute`
 *
 * Compares the key=value output from both modes against expect.json.
 * Flags any semantic drift between unpackaged and packaged execution.
 *
 * Usage:
 *   node fixtures/run.js              Run all fixtures
 *   node fixtures/run.js esm-basic    Run one fixture
 *   node fixtures/run.js --node-only  Only run unpackaged (fast check)
 */

'use strict';

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const FIXTURES_DIR = __dirname;
const HAKOBU_BIN = path.join(__dirname, '../packages/hakobu/lib-es5/bin.js');

const args = process.argv.slice(2);
const nodeOnly = args.includes('--node-only');
const filterName = args.find(a => !a.startsWith('-'));

// Discover fixtures (dirs with package.json + expect.json)
const fixtures = fs.readdirSync(FIXTURES_DIR)
  .filter(name => {
    if (name === 'node_modules' || name.startsWith('.')) return false;
    const dir = path.join(FIXTURES_DIR, name);
    return fs.statSync(dir).isDirectory()
      && fs.existsSync(path.join(dir, 'package.json'))
      && fs.existsSync(path.join(dir, 'expect.json'));
  })
  .filter(name => !filterName || name === filterName)
  .sort();

if (fixtures.length === 0) {
  console.error('No fixtures found' + (filterName ? ` matching "${filterName}"` : ''));
  process.exit(1);
}

// Parse key=value output into object
function parseOutput(stdout) {
  const result = {};
  // Split on \n and trim \r for Windows compatibility
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq);
    try {
      result[key] = JSON.parse(line.slice(eq + 1));
    } catch {
      result[key] = line.slice(eq + 1);
    }
  }
  return result;
}

// Compare actual vs expected, return list of mismatches
function compare(actual, expected) {
  const mismatches = [];
  for (const [key, expectedVal] of Object.entries(expected)) {
    if (!(key in actual)) {
      mismatches.push({ key, expected: expectedVal, actual: '(missing)' });
    } else if (JSON.stringify(actual[key]) !== JSON.stringify(expectedVal)) {
      mismatches.push({ key, expected: expectedVal, actual: actual[key] });
    }
  }
  return mismatches;
}

// Check if a fixture requires bundle mode (TypeScript source can't run on plain Node)
function requiresBundle(fixtureDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'package.json'), 'utf8'));
  return !!(pkg.hakobu && pkg.hakobu.bundle);
}

// Run a fixture with node (unpackaged)
function runNode(fixtureDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'package.json'), 'utf8'));
  const entry = pkg.main || 'index.js';
  const stdout = execFileSync(process.execPath, [path.join(fixtureDir, entry)], {
    timeout: 30000,
    encoding: 'utf8',
    cwd: fixtureDir,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  return parseOutput(stdout);
}

// Package and run a fixture with Hakobu
function runPackaged(fixtureDir, fixtureName) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hk-fix-${fixtureName}-`));
  const ext = process.platform === 'win32' ? '.exe' : '';
  const outPath = path.join(tmpDir, fixtureName + ext);

  try {
    // Package
    execFileSync(process.execPath, [
      HAKOBU_BIN, fixtureDir, '--output', outPath,
    ], {
      timeout: 120000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Execute
    const stdout = execFileSync(outPath, [], {
      timeout: 30000,
      encoding: 'utf8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    return parseOutput(stdout);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// Run all fixtures
let totalPass = 0;
let totalFail = 0;
let totalSkip = 0;

console.log(`\n=== Hakobu Fixture Runner ===\n`);
console.log(`  Fixtures: ${fixtures.length}`);
console.log(`  Mode:     ${nodeOnly ? 'node-only' : 'node + packaged'}\n`);

for (const name of fixtures) {
  const dir = path.join(FIXTURES_DIR, name);
  const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expect.json'), 'utf8'));

  // ── Node (unpackaged) ──
  let nodeResult;
  const isBundleOnly = requiresBundle(dir);

  if (isBundleOnly) {
    // Bundle-mode fixtures (TypeScript) can't run on plain Node
    console.log(`  --  ${name} (node) — skipped (bundle-mode-only)`);
    totalSkip++;
  } else {
    try {
      nodeResult = runNode(dir);
      const mismatches = compare(nodeResult, expected);
      if (mismatches.length === 0) {
        console.log(`  OK  ${name} (node)`);
        totalPass++;
      } else {
        console.log(`  XX  ${name} (node)`);
        for (const m of mismatches) {
          console.log(`      ${m.key}: expected=${JSON.stringify(m.expected)} got=${JSON.stringify(m.actual)}`);
        }
        totalFail++;
      }
    } catch (err) {
      console.log(`  XX  ${name} (node) — ${err.message.split('\n')[0]}`);
      totalFail++;
    }
  }

  // ── Packaged ──
  if (nodeOnly) {
    totalSkip++;
    continue;
  }

  try {
    const pkgResult = runPackaged(dir, name);
    const mismatches = compare(pkgResult, expected);

    if (mismatches.length === 0) {
      console.log(`  OK  ${name} (packaged)`);
      totalPass++;
    } else {
      console.log(`  XX  ${name} (packaged)`);
      for (const m of mismatches) {
        console.log(`      ${m.key}: expected=${JSON.stringify(m.expected)} got=${JSON.stringify(m.actual)}`);
      }
      totalFail++;
    }

    // ── Drift check: compare node output vs packaged output ──
    if (nodeResult) {
      const drifts = [];
      const allKeys = new Set([...Object.keys(nodeResult), ...Object.keys(pkgResult)]);
      for (const key of allKeys) {
        if (key === 'node_version') continue; // expected to differ (host vs packaged)
        if (JSON.stringify(nodeResult[key]) !== JSON.stringify(pkgResult[key])) {
          drifts.push({ key, node: nodeResult[key], packaged: pkgResult[key] });
        }
      }
      if (drifts.length > 0) {
        console.log(`  !!  ${name} (drift between node and packaged)`);
        for (const d of drifts) {
          console.log(`      ${d.key}: node=${JSON.stringify(d.node)} pkg=${JSON.stringify(d.packaged)}`);
        }
      }
    }
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : '';
    const msg = stderr ? stderr.split('\n').slice(-3).join(' | ') : err.message.split('\n')[0];

    // Bundle-mode fixtures may fail if Rolldown is not available (optional dep).
    // Treat bundler-not-found as a skip, not a hard failure.
    const isBundlerMissing = isBundleOnly && (
      msg.includes('rolldown') || msg.includes('Rolldown') ||
      stderr.includes('rolldown') || stderr.includes('Rolldown')
    );

    if (isBundlerMissing) {
      console.log(`  --  ${name} (packaged) — skipped (Rolldown not available)`);
      totalSkip++;
    } else {
      console.log(`  XX  ${name} (packaged) — ${msg}`);
      totalFail++;
    }
  }
}

console.log(`\n  ${totalPass} passed, ${totalFail} failed${totalSkip ? `, ${totalSkip} skipped` : ''}\n`);
if (totalFail > 0) process.exit(1);
