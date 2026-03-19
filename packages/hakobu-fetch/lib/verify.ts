import { spawnSync } from 'child_process';

import { plusx } from './utils';

// Verification script for patched Node 24 base binaries.
//
// Tests that V8 bytecode compilation (cachedData/sourceless mode) works
// correctly in the patched binary. This is the core capability that enables
// hakobu snapshot execution.
//
// Node 24 ABI module version: 137 (NODE_MODULE_VERSION from node_version.h)
// CPU features field was removed in Node 12+ (ABI 72+), so no offset
// checks are needed for modern Node versions.
const script = `
  var vm = require('vm');
  var assert = require('assert');
  var text = '(function () { return 42; })';
  var modules = process.versions.modules | 0;
  var version = process.version;

  // Verify this is a Node 24 binary (ABI 137).
  assert(version.startsWith('v24.'), 'Expected Node 24.x, got ' + version);
  assert(modules === 137, 'Expected Node 24 ABI 137, got ' + modules);

  // Test 1: produceCachedData in sourceless mode
  var s1 = new vm.Script(text, { filename: 's1', produceCachedData: true, sourceless: true });
  assert(s1.cachedDataProduced, 's1.cachedDataProduced must be true');
  var cd = s1.cachedData;

  // Test 2: execute from cachedData in sourceless mode
  var s2 = new vm.Script(undefined, { filename: 's2', cachedData: cd, sourceless: true });
  var fn = s2.runInThisContext();
  var result = fn();
  assert.equal(result, 42, 'sourceless execution must return 42');

  // Test 3: produceCachedData in normal (non-sourceless) mode
  var s4 = new vm.Script(text, { filename: 's4', produceCachedData: true });
  assert(s4.cachedDataProduced, 's4.cachedDataProduced must be true');

  console.log('ok');
`;

export async function verify(local: string) {
  await plusx(local);
  // PKG_EXECPATH tells the patched binary to run as plain Node instead of
  // trying to load a snapshot. This env var name is baked into the C++ patches
  // and cannot be renamed until the patches themselves are updated.
  const result = spawnSync(local, ['-e', script], {
    env: { PKG_EXECPATH: 'PKG_INVOKE_NODEJS' },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Verification failed with exit code ${result.status}`);
  }
}
