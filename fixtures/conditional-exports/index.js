'use strict';
/**
 * Conditional exports fixture.
 *
 * Tests that packages using conditional exports (import/require/default)
 * resolve to the correct entry point in CJS context.
 *
 * The dependency "cond-dep" has:
 *   ".":       { import: esm.mjs, require: cjs.cjs, default: default.js }
 *   "./utils": { import: utils-esm.mjs, require: utils-cjs.cjs, default: utils-default.js }
 *
 * In CJS context (this file), both should resolve to the "require" condition.
 */

const dep = require('cond-dep');
const utils = require('cond-dep/utils');

const checks = {};
checks.format = 'conditional-exports';

// 1. Main export resolved via "require" condition
checks.main_loaded = typeof dep.getCondition === 'function';
checks.main_condition = dep.getCondition();
checks.main_value = dep.getValue();

// 2. Subpath export resolved via "require" condition
checks.utils_loaded = typeof utils.utilCondition === 'function';
checks.utils_condition = utils.utilCondition();
checks.utils_double = utils.double(21);

// 3. require.resolve works for conditional exports
checks.resolve_main = typeof require.resolve('cond-dep') === 'string';
checks.resolve_utils = typeof require.resolve('cond-dep/utils') === 'string';

// 4. Resolved path ends with the CJS file (not ESM or default)
const mainPath = require.resolve('cond-dep');
checks.main_path_is_cjs = mainPath.endsWith('.cjs') || mainPath.endsWith('cjs.cjs');

for (const [k, v] of Object.entries(checks)) {
  console.log(`${k}=${JSON.stringify(v)}`);
}
