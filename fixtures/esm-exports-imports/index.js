import { fromImportsMap } from '#utils';
import { mainExport } from 'test-dep';
import { subpathExport } from 'test-dep/helper';

const checks = {};
checks.format = 'esm-exports-imports';
checks.imports_map = fromImportsMap();
checks.exports_main = mainExport();
checks.exports_subpath = subpathExport();
checks.node_version = process.version;

for (const [k, v] of Object.entries(checks)) {
  console.log(`${k}=${JSON.stringify(v)}`);
}
