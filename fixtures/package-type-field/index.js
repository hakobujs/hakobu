import { createRequire } from 'node:module';
import { fromEsmFile } from './esm-file.js';

const require = createRequire(import.meta.url);
const { fromCjsSubdir } = require('./cjs-subdir/helper.js');

const checks = {};
checks.format = 'package-type-field';
checks.esm_from_type_module = fromEsmFile();
checks.cjs_from_type_commonjs = fromCjsSubdir();
checks.node_version = process.version;

for (const [k, v] of Object.entries(checks)) {
  console.log(`${k}=${JSON.stringify(v)}`);
}
