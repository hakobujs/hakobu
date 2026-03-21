'use strict';
/**
 * External artifact fixture.
 *
 * Tests the patterns used to locate external binaries/artifacts
 * at runtime. This validates the resolution strategies without
 * needing actual browser binaries:
 *
 * 1. Environment variable override (HAKOBU_EXTERNAL_*)
 * 2. Executable-relative path (execDir/externals/name)
 * 3. process.execPath is a real path
 * 4. Path construction for artifact lookup
 */
const path = require('path');
const fs = require('fs');

const checks = {};
checks.format = 'external-artifact';

// 1. process.execPath is available and is a string
checks.execPath_is_string = typeof process.execPath === 'string';
checks.execPath_exists = fs.existsSync(process.execPath);

// 2. Can derive an executable-relative directory
const execDir = path.dirname(process.execPath);
checks.execDir_is_dir = fs.statSync(execDir).isDirectory();

// 3. External artifact lookup via env var
process.env.HAKOBU_EXTERNAL_TEST_ARTIFACT = __filename; // point to self as a test
const envKey = 'HAKOBU_EXTERNAL_TEST_ARTIFACT';
const envPath = process.env[envKey];
checks.env_lookup = envPath ? fs.existsSync(envPath) : false;
delete process.env.HAKOBU_EXTERNAL_TEST_ARTIFACT;

// 4. Exec-relative externals directory construction
const externalsDir = path.join(execDir, 'externals');
checks.externals_path_constructed = typeof externalsDir === 'string';

// 5. Path resolution patterns work consistently
const artifactPath = path.join(execDir, 'externals', 'my-browser', 'browser-bin');
checks.artifact_path_is_absolute = path.isAbsolute(artifactPath);

// 6. process.cwd() is available (external tools often use it)
checks.cwd_is_string = typeof process.cwd() === 'string';
checks.cwd_exists = fs.existsSync(process.cwd());

checks.node_version = process.version;

for (const [k, v] of Object.entries(checks)) {
  console.log(`${k}=${JSON.stringify(v)}`);
}
