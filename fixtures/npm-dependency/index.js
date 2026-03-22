'use strict';

// Real npm dependency test: picocolors (ANSI styling) + minimist (arg parsing)
// These are actual npm packages, not synthetic test modules.

const pc = require('picocolors');
const minimist = require('minimist');

const checks = {};
checks.format = 'npm-dependency';

// 1. picocolors: verify the module loaded and functions work
checks.pc_loaded = typeof pc.green === 'function';
checks.pc_green = pc.green('ok').includes('ok');
checks.pc_bold = pc.bold('test').includes('test');

// 2. minimist: verify arg parsing works correctly
const parsed = minimist(['--name', 'hakobu', '-v', '--count', '42', 'extra']);
checks.minimist_loaded = typeof minimist === 'function';
checks.minimist_name = parsed.name;
checks.minimist_v = parsed.v;
checks.minimist_count = parseInt(parsed.count, 10);
checks.minimist_positional = parsed._[0];

// 3. require.resolve works for npm dependencies
checks.resolve_picocolors = typeof require.resolve('picocolors') === 'string';
checks.resolve_minimist = typeof require.resolve('minimist') === 'string';

checks.node_version = process.version;

for (const [k, v] of Object.entries(checks)) {
  console.log(`${k}=${JSON.stringify(v)}`);
}
