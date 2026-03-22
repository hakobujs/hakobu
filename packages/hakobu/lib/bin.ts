#!/usr/bin/env node

import { readFileSync } from 'fs';
import path from 'path';
import minimist from 'minimist';

import { log } from './log';
import { packageApp, packageMultiple } from './packager';
import { commandTargets, commandInspect, commandDoctor } from './commands';
import { normalizeConfig } from './config';
import type { ConfigWarning } from './config';

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
  --target <spec>     Target(s), comma-separated (e.g., node24-linux-x64,node24-win-x64)
                      Use 'all' for all published targets. Default: host
  --output <path>     Output executable path
  --entry <file>      Entry file (relative to project root)
  --help, -h          Show this help
  --version, -v       Show version

Bundle mode (optional — for TypeScript / monorepo projects):
  --bundle [name]     Pre-bundle with Rolldown before packaging
  --external <mod>    Keep module external when bundling (repeatable)

Advanced:
  --bytecode          Compile JS to V8 bytecode before packaging

macOS signing:
  --sign-identity <id>  Code-signing identity (default: ad-hoc)
                        Also: HAKOBU_SIGN_IDENTITY env var
  --notarize            Submit to Apple notarization after signing
                        Requires: HAKOBU_APPLE_ID, HAKOBU_APPLE_PASSWORD,
                        HAKOBU_APPLE_TEAM_ID env vars
                        See docs/macos-notarization.md

  Without --bundle, Hakobu packages JS files directly (native mode).
  With --bundle, Rolldown compiles TS and resolves dependencies first.
  See docs/bundle-mode.md for semantic differences and caveats.

Config:
  Hakobu reads the "hakobu" field from package.json:
    { "hakobu": { "entry": "src/index.js", "assets": ["templates/**"] } }

  Legacy "pkg" config is accepted with migration warnings.
  CLI flags override package.json config.

Examples:
  hakobu ./my-app --output ./dist/app                    Native mode
  hakobu ./my-ts-app --bundle --output ./dist/app        Bundle mode
  hakobu ./app --bundle --entry src/cli.ts --external electron
`.trim();

function printConfigWarnings(warnings: ConfigWarning[]): boolean {
  let hasUnsupported = false;
  for (const w of warnings) {
    if (w.type === 'unsupported') {
      log.error(`[config] ${w.message}`);
      hasUnsupported = true;
    } else if (w.type === 'deprecated') {
      log.warn(`[config] ${w.message}`);
    } else {
      log.info(`[config] ${w.message}`);
    }
  }
  return hasUnsupported;
}

async function main() {
  if (process.env.CHDIR && process.env.CHDIR !== process.cwd()) {
    process.chdir(process.env.CHDIR);
  }

  const argv = minimist(process.argv.slice(2), {
    string: ['target', 'targets', 'output', 'entry', 'external', 'config',
             'out-path', 'outdir', 'out-dir', 'compress', 'public-packages',
             'options', 'no-dict', 'sign-identity'],
    boolean: ['help', 'version', 'bytecode', 'no-bytecode', 'build', 'public', 'sea',
              'no-native-build', 'notarize'],
    alias: { h: 'help', v: 'version', o: 'output', t: 'target',
             c: 'config', b: 'build', d: 'debug', C: 'compress' },
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
      const { options, warnings } = normalizeConfig({
        projectRoot: path.resolve(command),
        entry: argv.entry,
        target: argv.target,
        output: argv.output,
        bundle: argv.bundle,
        external: argv.external,
        bytecode: argv.bytecode,
        // Legacy aliases
        targets: argv.targets,
        config: argv.config,
        'out-path': argv['out-path'],
        outdir: argv.outdir,
        'out-dir': argv['out-dir'],
        'no-bytecode': argv['no-bytecode'],
        compress: argv.compress,
        build: argv.build,
        public: argv.public,
        'public-packages': argv['public-packages'],
        sea: argv.sea,
        options: argv.options,
        'no-native-build': argv['no-native-build'],
        'no-dict': argv['no-dict'],
      });

      const hasUnsupported = printConfigWarnings(warnings);
      if (hasUnsupported) {
        log.error('Unsupported options detected. Remove them or see migration guidance above.');
        process.exit(1);
      }

      // Detect multi-target: comma-separated --target or 'all'
      const targetStr = options.target || '';
      const isMulti = targetStr.includes(',') || targetStr === 'all';

      // macOS signing options
      if (argv['sign-identity']) options.signIdentity = argv['sign-identity'];
      if (argv.notarize) options.notarize = true;

      if (isMulti) {
        const results = await packageMultiple({
          projectRoot: options.projectRoot,
          targets: [targetStr],
          outputDir: options.output,
          entry: options.entry,
          assets: options.assets,
          externals: options.externals,
          bundle: options.bundle,
          bundleExternal: options.bundleExternal,
          signIdentity: options.signIdentity,
          notarize: options.notarize,
        });
        const failed = results.filter(r => r.status === 'failed');
        if (failed.length > 0) process.exit(1);
      } else {
        await packageApp(options);
      }
      break;
    }
  }
}

main().catch((error) => {
  if (!error.wasReported) log.error(error);
  process.exit(2);
});
