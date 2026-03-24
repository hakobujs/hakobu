'use strict';
/**
 * Native prebuild fixture — sharp/drivelist-style native package.
 *
 * Tests the hard pattern where a native package has:
 *   1. A .node addon in build/Release/ (loaded via process.dlopen)
 *   2. Sibling vendor files read via fs at runtime
 *   3. A JS wrapper that ties them together
 *
 * In packaged mode, the prelude must:
 *   - Extract the .node file to a temp/cache directory for dlopen
 *   - Copy the entire package directory so sibling files are accessible
 *   - Preserve the directory structure (build/Release/, vendor/, etc.)
 */

const pkg = require('native-pkg');

const checks = {};
checks.format = 'native-prebuild';

// 1. Native addon loaded and functions work
checks.addon_loaded = typeof pkg.add === 'function';
checks.add_result = pkg.add(17, 25);
checks.multiply_result = pkg.multiply(6, 7);
checks.native_version = pkg.version();

// 2. Vendor config file accessible (sibling file in package dir)
checks.vendor_loaded = pkg.vendorConfig !== null;
checks.vendor_library = pkg.vendorConfig ? pkg.vendorConfig.library : '';
checks.vendor_features = pkg.vendorConfig ? pkg.vendorConfig.features.length : 0;

// 3. Package metadata
checks.package_name = pkg.packageName;

for (const [k, v] of Object.entries(checks)) {
  console.log(`${k}=${JSON.stringify(v)}`);
}
