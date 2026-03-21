'use strict';
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');

const checks = {};
checks.format = 'spawn-exec';

// 1. spawnSync: run a child script file (not -e eval — eval doesn't work in packaged mode)
const echoScript = path.join(__dirname, 'echo-child.js');
try {
  const result = spawnSync(process.execPath, [echoScript, 'spawn-arg'], {
    encoding: 'utf8',
    timeout: 10000,
  });
  checks.spawn_child_stdout = result.stdout.trim();
  checks.spawn_child_status = result.status;
} catch (err) {
  checks.spawn_child_stdout = 'ERROR:' + err.message.slice(0, 60);
  checks.spawn_child_status = -1;
}

// 2. Verify env inheritance: child sees injected env vars
try {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'env-child.js')], {
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, HAKOBU_TEST_VAR: 'inherited-ok' },
  });
  checks.env_inherit = result.stdout.trim();
} catch (err) {
  checks.env_inherit = 'ERROR:' + err.message.slice(0, 60);
}

// 3. Verify non-zero exit code propagation
try {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'exit-child.js')], {
    timeout: 10000,
  });
  checks.exit_code_propagated = result.status;
} catch (err) {
  checks.exit_code_propagated = 'ERROR:' + err.message.slice(0, 60);
}

// 4. Verify custom stdio (pipe) works
try {
  const result = spawnSync(process.execPath, [echoScript, 'piped'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 10000,
  });
  checks.custom_stdio_stdout = result.stdout.trim();
} catch (err) {
  checks.custom_stdio_stdout = 'ERROR:' + err.message.slice(0, 60);
}

// 5. process.execPath points to a real file
const fs = require('fs');
checks.execPath_exists = fs.existsSync(process.execPath);

checks.node_version = process.version;

for (const [k, v] of Object.entries(checks)) {
  console.log(`${k}=${JSON.stringify(v)}`);
}
