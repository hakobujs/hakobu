'use strict';
/**
 * CJS-consuming-ESM fixture.
 *
 * Tests the real-world pattern where a CJS application uses dynamic
 * import() to consume an ESM-only dependency. This is how packages
 * like chalk v5, got v12, execa v7, p-limit v4 must be consumed
 * from CJS code.
 *
 * Key behaviors verified:
 *   1. dynamic import() from CJS loads an ESM module
 *   2. named exports are accessible
 *   3. default export is accessible
 *   4. the ESM module can execute functions correctly
 */

async function main() {
  const checks = {};
  checks.format = 'cjs-imports-esm';

  // 1. Dynamic import of ESM-only dependency
  const dep = await import('esm-only-dep');

  // 2. Named exports accessible
  checks.has_greet = typeof dep.greet === 'function';
  checks.has_version = typeof dep.version === 'string';
  checks.version_value = dep.version;

  // 3. Default export accessible
  checks.has_default = typeof dep.default === 'object' && dep.default !== null;
  checks.default_has_greet = typeof dep.default.greet === 'function';

  // 4. Function execution works
  checks.greet_result = dep.greet('hakobu');

  // 5. Dynamic import of local CJS module (sanity check — should also work)
  const path = require('path');
  checks.path_works = typeof path.join === 'function';

  for (const [k, v] of Object.entries(checks)) {
    console.log(`${k}=${JSON.stringify(v)}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
