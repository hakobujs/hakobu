'use strict';
/**
 * Native addon fixture.
 *
 * Tests that native addon-related mechanics work correctly:
 * - process.dlopen is callable
 * - .node file detection in require.resolve works
 * - Error messages for missing addons are clear
 *
 * We don't ship a real compiled .node file (that would require
 * platform-specific builds). Instead we test the infrastructure
 * that handles addons: detection, error paths, and fallbacks.
 */
const path = require('path');

const checks = {};
checks.format = 'addons';

// 1. process.dlopen exists and is a function
checks.dlopen_exists = typeof process.dlopen === 'function';

// 2. require.resolve works for .node paths (non-existent file gives clear error)
try {
  require.resolve('./fake-addon.node');
  checks.resolve_node_file = 'found'; // shouldn't happen
} catch (err) {
  checks.resolve_node_file = err.code === 'MODULE_NOT_FOUND' ? 'not-found-ok' : 'ERROR:' + err.code;
}

// 3. Loading a non-existent .node file gives the right error
try {
  require('./missing.node');
  checks.require_missing_node = 'loaded'; // shouldn't happen
} catch (err) {
  checks.require_missing_node = err.code === 'MODULE_NOT_FOUND' ? 'not-found-ok' : 'ERROR:' + err.code;
}

// 4. Native addon path derivation works
const addonDir = path.join(__dirname, 'build', 'Release');
checks.addon_path_join = typeof addonDir === 'string' && addonDir.includes('build');

// 5. process.config exists (needed by node-gyp/prebuild for native addons)
checks.process_config_exists = typeof process.config === 'object';
checks.process_config_has_variables = typeof process.config?.variables === 'object';

checks.node_version = process.version;

for (const [k, v] of Object.entries(checks)) {
  console.log(`${k}=${JSON.stringify(v)}`);
}
