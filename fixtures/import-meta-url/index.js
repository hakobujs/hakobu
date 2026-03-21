import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const checks = {};
checks.format = 'import-meta-url';
checks.url_is_string = typeof import.meta.url === 'string';
checks.url_starts_with_file = import.meta.url.startsWith('file:');
checks.url_ends_with_index_js = import.meta.url.endsWith('/index.js');
checks.dirname_from_url_is_string = typeof __dirname === 'string';

// Read a sibling file using the derived __dirname
try {
  const data = readFileSync(join(__dirname, 'sibling.txt'), 'utf8');
  checks.sibling_read = data.trim();
} catch (err) {
  checks.sibling_read = 'ERROR:' + err.code;
}

checks.node_version = process.version;

for (const [k, v] of Object.entries(checks)) {
  console.log(`${k}=${JSON.stringify(v)}`);
}
