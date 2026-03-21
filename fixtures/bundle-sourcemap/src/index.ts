import { throwError } from './helper.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const checks: Record<string, unknown> = {};
checks.format = 'bundle-sourcemap';

// 1. Verify source map file exists alongside the bundle in the snapshot
try {
  const mapPath = join(__dirname, 'index.js.map');
  const mapContent = readFileSync(mapPath, 'utf8');
  const map = JSON.parse(mapContent);
  checks.map_readable = true;
  checks.map_has_sources = Array.isArray(map.sources);
  checks.map_has_mappings = typeof map.mappings === 'string' && map.mappings.length > 0;
  // Check that sources reference original .ts files
  checks.map_references_ts = map.sources.some((s: string) => s.endsWith('.ts'));
} catch {
  checks.map_readable = false;
  checks.map_has_sources = false;
  checks.map_has_mappings = false;
  checks.map_references_ts = false;
}

// 2. Verify stack trace from thrown error
try {
  throwError();
} catch (err: any) {
  const stack = err.stack || '';
  const lines = stack.split('\n');

  checks.error_message = err.message;
  // Check if the stack has at least the function name
  checks.stack_has_throwError = lines.some((l: string) => l.includes('throwError'));

  // When --enable-source-maps works (stock Node), this will be true.
  // On patched base binary, this will be false (known limitation).
  checks.stack_has_ts_source = lines.some((l: string) => l.includes('helper.ts'));

  // Show the first real stack frame for debugging
  const frame = lines.find((l: string) => l.includes('throwError'));
  checks.stack_frame = frame ? frame.trim() : '(not found)';
}

checks.node_version = process.version;

for (const [k, v] of Object.entries(checks)) {
  console.log(`${k}=${JSON.stringify(v)}`);
}
