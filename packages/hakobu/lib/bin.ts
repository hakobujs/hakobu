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
  --debug, -d         Show detailed packaging diagnostics

Bundle mode (optional — for TypeScript / monorepo projects):
  --bundle [name]     Pre-bundle with Rolldown before packaging
  --external <mod>    Keep module external when bundling (repeatable)

Advanced:
  --bytecode          Compile JS to V8 bytecode before packaging
  --compress <algo>   Compress snapshot payload (Brotli or GZip)
  --options <flags>   Bake V8 flags into executable (comma-separated)
  --build, -b         Force local build of base binary (skip download)
                      Example: --options "expose-gc,max-heap-size=34"
  --app-bundle        Wrap macOS output in a .app bundle (macOS only)
                      Output path becomes the .app directory
  --appdir            Wrap Linux output in an AppDir (Linux only)
                      Output path becomes the .AppDir directory
  --appimage          Build an AppImage from AppDir (Linux only)
                      Requires external appimagetool in PATH

macOS bundle metadata (used with --app-bundle):
  --bundle-id <id>      CFBundleIdentifier (e.g., com.example.my-app)
  --bundle-version <v>  CFBundleVersion (e.g., 1.2.3)
  --short-version <v>   CFBundleShortVersionString (defaults to bundle-version)
  --display-name <n>    CFBundleDisplayName
  --copyright <s>       NSHumanReadableCopyright
  --macos-icon <path>   Path to .icns file for the app icon
                        Also configurable via "hakobu.macos" in package.json

Linux AppDir metadata (used with --appdir):
  --desktop-name <n>    Application name in .desktop file
  --desktop-comment <s> Short description / tooltip
  --desktop-categories <c>  Semicolon-separated categories (e.g., Utility;Development;)
  --desktop-terminal    App needs a terminal (default: true)
  --no-desktop-terminal App does not need a terminal
  --linux-icon <path>   Path to .png file for the app icon
                        Also configurable via "hakobu.linux" in package.json

Signing:
  --sign-identity <id>  macOS code-signing identity (default: ad-hoc)
                        Also: HAKOBU_SIGN_IDENTITY env var
  --notarize            Submit to Apple notarization after signing
                        Requires: HAKOBU_APPLE_ID, HAKOBU_APPLE_PASSWORD,
                        HAKOBU_APPLE_TEAM_ID env vars
                        See docs/macos-notarization.md
  --win-cert <path>     Windows Authenticode .pfx/.p12 certificate
                        Also: HAKOBU_WIN_CERT env var
  --win-cert-password   Certificate password
                        Also: HAKOBU_WIN_CERT_PASSWORD env var
                        See docs/windows-signing.md

Windows metadata (PE VERSIONINFO):
  --product-name <n>    Product name in file properties
  --file-description <d> Description shown in Task Manager
  --company-name <n>    Company / publisher name
  --file-version <v>    File version (e.g., 1.2.3)
  --product-version <v> Product version (defaults to file version)
  --icon <path>         .ico file to embed as application icon
                        See docs/exe-metadata.md

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
             'options', 'no-dict', 'sign-identity', 'win-cert', 'win-cert-password',
             'product-name', 'file-description', 'company-name', 'file-version',
             'product-version', 'icon',
             'bundle-id', 'bundle-version', 'short-version', 'display-name', 'copyright',
             'macos-icon', 'desktop-name', 'desktop-comment', 'desktop-categories',
             'linux-icon'],
    boolean: ['help', 'version', 'bytecode', 'no-bytecode', 'build', 'public', 'sea',
              'no-native-build', 'notarize', 'app-bundle', 'appdir',
              'desktop-terminal', 'no-desktop-terminal', 'appimage'],
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

  // Debug mode — activates verbose logging throughout the pipeline
  if (argv.debug) {
    log.debugMode = true;
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

      // Signing options
      if (argv['sign-identity']) options.signIdentity = argv['sign-identity'];
      if (argv.notarize) options.notarize = true;
      if (argv['win-cert']) options.winCertPath = argv['win-cert'];
      if (argv['win-cert-password']) options.winCertPassword = argv['win-cert-password'];

      // App bundle / AppDir
      if (argv['app-bundle']) options.appBundle = true;
      if (argv.appdir) options.appDir = true;
      if (argv.appimage) options.appImage = true;

      // macOS bundle metadata — CLI flags override config
      const cliMacos: Record<string, string> = {};
      if (argv['bundle-id']) cliMacos.bundleId = argv['bundle-id'];
      if (argv['bundle-version']) cliMacos.bundleVersion = argv['bundle-version'];
      if (argv['short-version']) cliMacos.shortVersion = argv['short-version'];
      if (argv['display-name']) cliMacos.displayName = argv['display-name'];
      if (argv.copyright) cliMacos.copyright = argv.copyright;
      if (argv['macos-icon']) cliMacos.icon = argv['macos-icon'];
      if (Object.keys(cliMacos).length > 0) {
        options.macos = { ...options.macos, ...cliMacos };
      }

      // Linux desktop metadata — CLI flags override config
      const cliLinux: Record<string, any> = {};
      if (argv['desktop-name']) cliLinux.name = argv['desktop-name'];
      if (argv['desktop-comment']) cliLinux.comment = argv['desktop-comment'];
      if (argv['desktop-categories']) cliLinux.categories = argv['desktop-categories'];
      if (argv['desktop-terminal']) cliLinux.terminal = true;
      if (argv['no-desktop-terminal']) cliLinux.terminal = false;
      if (argv['linux-icon']) cliLinux.iconPath = argv['linux-icon'];
      if (Object.keys(cliLinux).length > 0) {
        options.linux = { ...options.linux, ...cliLinux };
      }

      // PE metadata — CLI flags override config
      const cliMeta: Record<string, string> = {};
      if (argv['product-name']) cliMeta.productName = argv['product-name'];
      if (argv['file-description']) cliMeta.fileDescription = argv['file-description'];
      if (argv['company-name']) cliMeta.companyName = argv['company-name'];
      if (argv['file-version']) cliMeta.fileVersion = argv['file-version'];
      if (argv['product-version']) cliMeta.productVersion = argv['product-version'];
      if (argv.icon) cliMeta.icon = argv.icon;
      if (Object.keys(cliMeta).length > 0) {
        options.metadata = { ...options.metadata, ...cliMeta };
      }

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
          winCertPath: options.winCertPath,
          winCertPassword: options.winCertPassword,
          metadata: options.metadata,
          appBundle: options.appBundle,
          macos: options.macos,
          appDir: options.appDir,
          linux: options.linux,
          appImage: options.appImage,
          compress: options.compress,
          options: options.options,
          forceBuild: options.forceBuild,
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
