#!/usr/bin/env node

import { readFileSync } from 'fs';
import path from 'path';
import minimist from 'minimist';

import { log } from './log';
import { packageApp } from './packager';
import { commandTargets, commandInspect, commandDoctor } from './commands';

const { version } = JSON.parse(
  readFileSync(path.join(__dirname, '../package.json'), 'utf-8'),
);

const USAGE = `
hakobu v${version} — Package Node.js projects into executables

Usage:
  hakobu <project-root>                     Package a project
  hakobu targets                            Show available targets and cache
  hakobu inspect <project-root>             Analyze a project without packaging
  hakobu doctor <project-root> [--target]   Check if a project is ready to package

Options:
  --target <spec>     Target (e.g., node24-macos-arm64). Default: host
  --output <path>     Output executable path
  --entry <file>      Entry file (relative to project root)
  --help, -h          Show this help
  --version, -v       Show version
`.trim();

async function main() {
  if (process.env.CHDIR && process.env.CHDIR !== process.cwd()) {
    process.chdir(process.env.CHDIR);
  }

  const argv = minimist(process.argv.slice(2), {
    string: ['target', 'output', 'entry'],
    boolean: ['help', 'version'],
    alias: { h: 'help', v: 'version', o: 'output', t: 'target' },
  });

  if (argv.version) {
    console.log(version);
    return;
  }

  if (argv.help || argv._.length === 0) {
    console.log(USAGE);
    return;
  }

  const command = argv._[0];

  switch (command) {
    case 'targets':
      await commandTargets();
      break;

    case 'inspect':
      await commandInspect(argv._[1] || '.');
      break;

    case 'doctor':
      await commandDoctor(argv._[1] || '.', argv.target);
      break;

    default: {
      // Default: treat the first arg as a project root to package
      const projectRoot = path.resolve(command);
      await packageApp({
        projectRoot,
        entry: argv.entry,
        target: argv.target,
        output: argv.output,
      });
      break;
    }
  }
}

main().catch((error) => {
  if (!error.wasReported) log.error(error);
  process.exit(2);
});
