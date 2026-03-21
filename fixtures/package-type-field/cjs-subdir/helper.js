// This .js file is CJS because its nearest package.json has "type": "commonjs"
'use strict';
exports.fromCjsSubdir = function() {
  return 'cjs-subdir-ok';
};
