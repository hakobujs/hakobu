import { greet, add, LIB_VERSION } from '@workspace/lib';

console.log(`format=workspace-bundle`);
console.log(`greet_result=${JSON.stringify(greet('hakobu'))}`);
console.log(`add_result=${JSON.stringify(add(17, 25))}`);
console.log(`lib_version=${JSON.stringify(LIB_VERSION)}`);
console.log(`workspace_resolved=true`);
