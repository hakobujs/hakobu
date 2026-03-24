'use strict';
/**
 * Pattern subpath exports fixture.
 *
 * Tests that packages using wildcard pattern exports
 * ("./*": "./src/*.js") resolve correctly through the pattern mapping.
 *
 * The dependency "pattern-dep" has:
 *   ".":  "./src/index.js"      (exact match)
 *   "./*": "./src/*.js"          (pattern — maps ./utils to ./src/utils.js)
 */

const main = require('pattern-dep');
const utils = require('pattern-dep/utils');
const math = require('pattern-dep/math');

const checks = {};
checks.format = 'pattern-exports';

// 1. Main export (exact match ".")
checks.main_loaded = typeof main.name === 'string';
checks.main_name = main.name;
checks.main_version = main.version;

// 2. Pattern subpath "./utils" → "./src/utils.js"
checks.utils_loaded = typeof utils.double === 'function';
checks.utils_module = utils.moduleName;
checks.utils_result = utils.double(21);

// 3. Pattern subpath "./math" → "./src/math.js"
checks.math_loaded = typeof math.add === 'function';
checks.math_module = math.moduleName;
checks.math_result = math.add(17, 25);

// 4. require.resolve works through pattern exports
checks.resolve_utils = typeof require.resolve('pattern-dep/utils') === 'string';
checks.resolve_math = typeof require.resolve('pattern-dep/math') === 'string';

for (const [k, v] of Object.entries(checks)) {
  console.log(`${k}=${JSON.stringify(v)}`);
}
