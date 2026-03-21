#!/usr/bin/env node
/**
 * Verify that a patched Node base binary supports --enable-source-maps
 * for modules loaded through registerHooks() + import().
 *
 * Usage:
 *   PKG_EXECPATH=PKG_INVOKE_NODEJS <patched-binary> test-source-maps.js
 *
 * Or against any node binary:
 *   node test-source-maps.js
 *
 * Expected: process.sourceMapsEnabled === true when --enable-source-maps is set.
 */

'use strict';

const hasSourceMaps = process.env.NODE_OPTIONS?.includes('--enable-source-maps');

if (!hasSourceMaps) {
  console.log('Re-running with --enable-source-maps...');
  const { execFileSync } = require('child_process');
  try {
    const result = execFileSync(process.execPath, [__filename], {
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, NODE_OPTIONS: '--enable-source-maps' },
    });
    console.log(result);
    if (result.includes('PASS')) process.exit(0);
    else process.exit(1);
  } catch (err) {
    console.error(err.stderr || err.message);
    process.exit(1);
  }
}

// We're now running with --enable-source-maps
console.log('node_version=' + process.version);
console.log('sourceMapsEnabled=' + process.sourceMapsEnabled);

if (process.sourceMapsEnabled === true) {
  console.log('PASS: source maps are enabled in the patched binary');
} else {
  console.log('FAIL: process.sourceMapsEnabled is ' + process.sourceMapsEnabled);
  console.log('  --enable-source-maps is not taking effect.');
  console.log('  This is likely due to double prepareMainThreadExecution in bootstrap/pkg.js');
}
