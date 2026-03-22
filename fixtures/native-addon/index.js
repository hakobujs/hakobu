'use strict';
/**
 * Native addon fixture.
 *
 * Loads a real compiled .node addon (built from src/addon.c via node-gyp)
 * and verifies:
 *   - the addon loads via require()
 *   - exported native functions execute correctly
 *   - require.resolve() returns a .node path
 *   - process.dlopen infrastructure works end-to-end
 *
 * In packaged mode, the prelude extracts the .node from the snapshot
 * to a temp directory and calls dlopen() on the real file.
 */
const path = require('path');

const checks = {};
checks.format = 'native-addon';

// Load the compiled addon
const addon = require('./build/Release/test_addon.node');

// 1. Module loaded as object
checks.addon_loaded = typeof addon === 'object' && addon !== null;

// 2. Exported functions exist
checks.add_exists = typeof addon.add === 'function';
checks.multiply_exists = typeof addon.multiply === 'function';
checks.version_exists = typeof addon.version === 'function';

// 3. Functions return correct results
checks.add_result = addon.add(17, 25);
checks.multiply_result = addon.multiply(6, 7);
checks.add_float = addon.add(1.5, 2.5);
checks.version_value = addon.version();

// 4. require.resolve works for .node files
try {
  const resolved = require.resolve('./build/Release/test_addon.node');
  checks.resolve_node = typeof resolved === 'string' && resolved.endsWith('.node');
} catch {
  checks.resolve_node = false;
}

for (const [k, v] of Object.entries(checks)) {
  console.log(`${k}=${JSON.stringify(v)}`);
}
