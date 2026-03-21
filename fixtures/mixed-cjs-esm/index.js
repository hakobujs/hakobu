// ESM entry that imports a CJS module via createRequire
import { createRequire } from 'node:module';
import { esmHelper } from './lib/esm-helper.js';

const require = createRequire(import.meta.url);
const cjsModule = require('./lib/cjs-helper.cjs');

const checks = {};
checks.format = 'mixed';
checks.esm_value = esmHelper();
checks.cjs_value = cjsModule.cjsHelper();
checks.cjs_json = require('./data.json').mixed;
checks.create_require_works = true;
checks.node_version = process.version;

for (const [k, v] of Object.entries(checks)) {
  console.log(`${k}=${JSON.stringify(v)}`);
}
