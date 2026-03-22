#!/usr/bin/env node
/**
 * Minimal repro for the patched-base source-map limitation.
 *
 * Tests: CJS shim → registerHooks() → import() → inline source map
 * This is exactly the code path Hakobu uses for ESM modules.
 *
 * Run against BOTH binaries:
 *   NODE_OPTIONS=--enable-source-maps /tmp/node-v24.14.0-darwin-arm64/bin/node repro-sourcemap.cjs
 *   PKG_EXECPATH=PKG_INVOKE_NODEJS NODE_OPTIONS=--enable-source-maps ~/.hakobu/cache/v0.1/built-v24.14.0-macos-arm64 repro-sourcemap.cjs
 */

'use strict';

const { registerHooks } = require('node:module');

// A module with an inline source map
const code = `export function throwIt() { throw new Error('repro-error'); }`;
const map = JSON.stringify({
  version: 3,
  file: 'generated.js',
  sources: ['original-source.ts'],
  sourcesContent: ['export function throwIt() { throw new Error("repro-error"); }'],
  mappings: 'AAAA,OAAO,SAAS,SAAS,GAAG,CAAC,MAAM,IAAI,MAAM,aAAa,EAAE,CAAC',
  names: []
});

const inlineMap = Buffer.from(map).toString('base64');
const sourceWithMap = code + '\n//# sourceMappingURL=data:application/json;base64,' + inlineMap;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'test-module') {
      return { url: 'file:///tmp/repro-generated.js', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'file:///tmp/repro-generated.js') {
      return { format: 'module', source: sourceWithMap, shortCircuit: true };
    }
    return nextLoad(url, context);
  }
});

// Diagnostic: check source map support state
console.log('process.sourceMapsEnabled=' + process.sourceMapsEnabled);
console.log('NODE_OPTIONS=' + (process.env.NODE_OPTIONS || ''));
console.log('PKG_EXECPATH=' + (process.env.PKG_EXECPATH || 'not set'));

import('test-module').then(mod => {
  try {
    mod.throwIt();
  } catch(e) {
    const lines = e.stack.split('\n');
    const hasMapped = lines.some(l => l.includes('original-source.ts'));
    console.log('stack_has_original_source=' + hasMapped);
    console.log('stack_line_1=' + lines[1].trim());
    if (hasMapped) {
      console.log('RESULT: PASS — source maps resolve correctly');
    } else {
      console.log('RESULT: FAIL — source maps NOT resolving');
    }
  }
});
