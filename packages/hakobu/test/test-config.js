/**
 * Tests for config normalization and legacy migration.
 *
 * Run: node packages/hakobu/test/test-config.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { normalizeConfig } = require('../lib-es5/config');

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

// Helper: create temp project with given package.json content
function withProject(pkgJson) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-cfg-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkgJson));
  fs.writeFileSync(path.join(dir, 'index.js'), 'console.log("ok")');
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

console.log('\n=== Config Normalization Tests ===\n');

// ── Modern config ──

test('modern: reads "hakobu" field from package.json', () => {
  const dir = withProject({
    name: 'test',
    hakobu: { entry: 'src/main.js', assets: ['templates/**'] }
  });
  try {
    const { options, warnings } = normalizeConfig({ projectRoot: dir });
    assert.strictEqual(options.entry, 'src/main.js');
    assert.deepStrictEqual(options.assets, ['templates/**']);
    // No legacy warnings
    const legacyWarnings = warnings.filter(w => w.option === 'pkg');
    assert.strictEqual(legacyWarnings.length, 0);
  } finally { cleanup(dir); }
});

test('modern: CLI flags override package.json config', () => {
  const dir = withProject({
    name: 'test',
    hakobu: { entry: 'src/main.js', target: 'node24-linux-x64' }
  });
  try {
    const { options } = normalizeConfig({
      projectRoot: dir,
      entry: 'cli.js',
      target: 'node24-macos-arm64',
    });
    assert.strictEqual(options.entry, 'cli.js');
    assert.strictEqual(options.target, 'node24-macos-arm64');
  } finally { cleanup(dir); }
});

test('modern: bundle config from package.json', () => {
  const dir = withProject({
    name: 'test',
    hakobu: { bundle: true, bundleExternal: ['electron'] }
  });
  try {
    const { options } = normalizeConfig({ projectRoot: dir });
    assert.strictEqual(options.bundle, true);
    assert.deepStrictEqual(options.bundleExternal, ['electron']);
  } finally { cleanup(dir); }
});

// ── Legacy config ──

test('legacy: reads "pkg" field with migration warning', () => {
  const dir = withProject({
    name: 'test',
    pkg: { assets: ['views/**'] }
  });
  try {
    const { options, warnings } = normalizeConfig({ projectRoot: dir });
    assert.deepStrictEqual(options.assets, ['views/**']);
    const pkgWarning = warnings.find(w => w.option === 'pkg' && w.type === 'migrated');
    assert(pkgWarning, 'should have migration warning for pkg field');
  } finally { cleanup(dir); }
});

test('legacy: pkg.scripts mapped to assets', () => {
  const dir = withProject({
    name: 'test',
    pkg: { scripts: ['lib/**/*.js'], assets: ['data/**'] }
  });
  try {
    const { options, warnings } = normalizeConfig({ projectRoot: dir });
    assert.deepStrictEqual(options.assets, ['data/**', 'lib/**/*.js']);
    const scriptWarning = warnings.find(w => w.option === 'pkg.scripts');
    assert(scriptWarning, 'should have migration warning for pkg.scripts');
    assert.strictEqual(scriptWarning.type, 'migrated');
  } finally { cleanup(dir); }
});

test('legacy: pkg.targets takes first target with warning', () => {
  const dir = withProject({
    name: 'test',
    pkg: { targets: ['node18-linux-x64', 'node18-win-x64'] }
  });
  try {
    const { options, warnings } = normalizeConfig({ projectRoot: dir });
    assert.strictEqual(options.target, 'node18-linux-x64');
    const multiWarning = warnings.find(w => w.option === 'pkg.targets' && w.type === 'deprecated');
    assert(multiWarning, 'should warn about multi-target');
  } finally { cleanup(dir); }
});

test('legacy: pkg.outputPath mapped to output', () => {
  const dir = withProject({
    name: 'test',
    pkg: { outputPath: './dist' }
  });
  try {
    const { options } = normalizeConfig({ projectRoot: dir });
    assert.strictEqual(options.output, './dist');
  } finally { cleanup(dir); }
});

test('legacy: "hakobu" takes priority over "pkg"', () => {
  const dir = withProject({
    name: 'test',
    hakobu: { entry: 'modern.js' },
    pkg: { assets: ['old/**'] }
  });
  try {
    const { options, warnings } = normalizeConfig({ projectRoot: dir });
    assert.strictEqual(options.entry, 'modern.js');
    assert.strictEqual(options.assets, undefined); // pkg.assets ignored
    const bothWarning = warnings.find(w => w.option === 'pkg' && w.type === 'deprecated');
    assert(bothWarning, 'should warn about both fields present');
  } finally { cleanup(dir); }
});

// ── Unsupported legacy options ──

test('legacy: pkg.patches rejected as unsupported', () => {
  const dir = withProject({
    name: 'test',
    pkg: { patches: { 'some-pkg': [] } }
  });
  try {
    const { warnings } = normalizeConfig({ projectRoot: dir });
    const w = warnings.find(w => w.option === 'pkg.patches');
    assert(w, 'should have unsupported warning for patches');
    assert.strictEqual(w.type, 'unsupported');
  } finally { cleanup(dir); }
});

test('legacy: pkg.dictionary rejected as unsupported', () => {
  const dir = withProject({
    name: 'test',
    pkg: { dictionary: { 'some-pkg': {} } }
  });
  try {
    const { warnings } = normalizeConfig({ projectRoot: dir });
    const w = warnings.find(w => w.option === 'pkg.dictionary');
    assert(w);
    assert.strictEqual(w.type, 'unsupported');
  } finally { cleanup(dir); }
});

// ── CLI compatibility and validation ──

test('cli: --no-bytecode rejected', () => {
  const dir = withProject({ name: 'test' });
  try {
    const { warnings } = normalizeConfig({ projectRoot: dir, 'no-bytecode': true });
    const w = warnings.find(w => w.option === '--no-bytecode');
    assert(w);
    assert.strictEqual(w.type, 'unsupported');
  } finally { cleanup(dir); }
});

test('cli: --sea rejected', () => {
  const dir = withProject({ name: 'test' });
  try {
    const { warnings } = normalizeConfig({ projectRoot: dir, sea: true });
    const w = warnings.find(w => w.option === '--sea');
    assert(w);
    assert.strictEqual(w.type, 'unsupported');
  } finally { cleanup(dir); }
});

test('cli: --compress accepted', () => {
  const dir = withProject({ name: 'test' });
  try {
    const { options, warnings } = normalizeConfig({ projectRoot: dir, compress: 'GZip' });
    const w = warnings.find(w => w.option === '--compress');
    assert.strictEqual(w, undefined);
    assert.strictEqual(options.compress, 'gzip');
  } finally { cleanup(dir); }
});

test('cli: invalid --compress rejected', () => {
  const dir = withProject({ name: 'test' });
  try {
    const { options, warnings } = normalizeConfig({ projectRoot: dir, compress: 'LZMA' });
    const w = warnings.find(w => w.option === '--compress');
    assert(w);
    assert.strictEqual(w.type, 'unsupported');
    assert.strictEqual(options.compress, undefined);
  } finally { cleanup(dir); }
});

// ── Legacy CLI aliases ──

test('cli: --targets (plural) accepted with warning', () => {
  const dir = withProject({ name: 'test' });
  try {
    const { options, warnings } = normalizeConfig({
      projectRoot: dir,
      targets: 'node24-linux-x64,node24-win-x64',
    });
    assert.strictEqual(options.target, 'node24-linux-x64');
    const w = warnings.find(w => w.option === '--targets' && w.type === 'migrated');
    assert(w);
    const multi = warnings.find(w => w.option === '--targets' && w.type === 'deprecated');
    assert(multi, 'should warn about multi-target');
  } finally { cleanup(dir); }
});

test('cli: --out-path accepted with warning', () => {
  const dir = withProject({ name: 'test' });
  try {
    const { options, warnings } = normalizeConfig({
      projectRoot: dir,
      'out-path': './build',
    });
    assert.strictEqual(options.output, './build');
    const w = warnings.find(w => w.option === '--out-path');
    assert(w);
    assert.strictEqual(w.type, 'migrated');
  } finally { cleanup(dir); }
});

// ── No config ──

test('no config: works with bare project', () => {
  const dir = withProject({ name: 'test', main: 'index.js' });
  try {
    const { options, warnings } = normalizeConfig({ projectRoot: dir });
    assert.strictEqual(options.projectRoot, dir);
    assert.strictEqual(options.entry, undefined);
    assert.strictEqual(warnings.length, 0);
  } finally { cleanup(dir); }
});

// ── Summary ──
console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
