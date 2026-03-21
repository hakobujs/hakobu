import { greet } from './lib/greet.js';
import { join } from 'node:path';

const checks = {};
checks.format = 'esm';
checks.greet = greet('world');
checks.import_meta_url_defined = typeof import.meta.url === 'string';
checks.import_meta_url_protocol = new URL(import.meta.url).protocol;
checks.join_works = join('a', 'b').includes('b');
checks.node_version = process.version;

for (const [k, v] of Object.entries(checks)) {
  console.log(`${k}=${JSON.stringify(v)}`);
}
