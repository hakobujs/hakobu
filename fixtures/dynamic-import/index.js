const checks = {};
checks.format = 'dynamic-import';

// Static string dynamic import (Hakobu can trace this)
try {
  const mod = await import('./lib/lazy.js');
  checks.dynamic_static_path = mod.LAZY_VALUE;
} catch (err) {
  checks.dynamic_static_path = 'ERROR:' + err.message.slice(0, 60);
}

// Dynamic import of builtin
try {
  const os = await import('node:os');
  checks.dynamic_builtin = typeof os.hostname === 'function';
} catch {
  checks.dynamic_builtin = false;
}

checks.node_version = process.version;

for (const [k, v] of Object.entries(checks)) {
  console.log(`${k}=${JSON.stringify(v)}`);
}
