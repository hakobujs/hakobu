'use strict';
/**
 * Scoped package + nested dependency fixture.
 *
 * Tests that:
 *   1. @scope/package resolution works (scoped npm packages)
 *   2. Transitive dependencies resolve from within the scoped package
 *   3. require.resolve works for both levels
 *   4. Runtime behavior is correct across the dependency chain
 */

const math = require('@test/math');

const checks = {};
checks.format = 'scoped-nested-deps';

// 1. Scoped package loaded
checks.scoped_loaded = typeof math.add === 'function';
checks.scoped_version = math.version;

// 2. Transitive dependency resolved and functional
checks.add_result = math.add(17, 25);
checks.multiply_result = math.multiply(6, 7);
checks.transitive_version = math.utilsVersion;

// 3. Invalid inputs handled by transitive validation
checks.validate_nan = isNaN(math.add('x', 5));

// 4. require.resolve for scoped package
checks.resolve_scoped = typeof require.resolve('@test/math') === 'string';

// 5. require.resolve for transitive dependency
checks.resolve_transitive = typeof require.resolve('shared-utils') === 'string';

for (const [k, v] of Object.entries(checks)) {
  console.log(`${k}=${JSON.stringify(v)}`);
}
