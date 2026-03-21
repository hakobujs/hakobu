'use strict';
const path = require('path');
const { greet } = require('./lib/greet');

const checks = {};
checks.format = 'cjs';
checks.greet = greet('world');
checks.dirname_defined = typeof __dirname === 'string';
checks.filename_defined = typeof __filename === 'string';
checks.require_resolve = typeof require.resolve === 'function';
checks.json_require = require('./data.json').key;
checks.node_version = process.version;

// Output deterministic check results
for (const [k, v] of Object.entries(checks)) {
  console.log(`${k}=${JSON.stringify(v)}`);
}
