import { execFileSync, execFile } from 'child_process';
import { promisify } from 'util';

import { log } from './log';

const execFileAsync = promisify(execFile);

function parseCStr(buf: Buffer) {
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === 0) {
      return buf.slice(0, i).toString();
    }
  }
}

function patchCommand(type: number, buf: Buffer, file: Buffer) {
  // segment_64
  if (type === 0x19) {
    const name = parseCStr(buf.slice(0, 16));

    if (name === '__LINKEDIT') {
      const fileoff = buf.readBigUInt64LE(32);
      const vmsizePatched = BigInt(file.length) - fileoff;
      const filesizePatched = vmsizePatched;

      buf.writeBigUInt64LE(vmsizePatched, 24);
      buf.writeBigUInt64LE(filesizePatched, 40);
    }
  }

  // symtab
  if (type === 0x2) {
    const stroff = buf.readUInt32LE(8);
    const strsizePatched = file.length - stroff;

    buf.writeUInt32LE(strsizePatched, 12);
  }
}

/**
 * It would be nice to explain the purpose of this patching function
 * @param file
 * @returns
 */
function patchMachOExecutable(file: Buffer) {
  const align = 8;
  const hsize = 32;

  const ncmds = file.readUInt32LE(16);
  const buf = file.slice(hsize);

  for (let offset = 0, i = 0; i < ncmds; i += 1) {
    const type = buf.readUInt32LE(offset);

    offset += 4;
    const size = buf.readUInt32LE(offset) - 8;

    offset += 4;
    patchCommand(type, buf.slice(offset, offset + size), file);

    offset += size;
    if (offset & align) {
      offset += align - (offset & align);
    }
  }

  return file;
}

/**
 * Sign a Mach-O executable.
 *
 * @param executable - Path to the executable
 * @param identity - Signing identity. Default: '-' (ad-hoc).
 *   For distribution, use a Developer ID identity:
 *   'Developer ID Application: Your Name (TEAMID)'
 *
 * Identity resolution order:
 *   1. Explicit `identity` argument
 *   2. HAKOBU_SIGN_IDENTITY env var
 *   3. Ad-hoc signing ('-')
 */
function signMachOExecutable(executable: string, identity?: string) {
  const id = identity || process.env.HAKOBU_SIGN_IDENTITY || '-';
  const args = [
    '--force',
    '--sign',
    id,
    '--options',
    'runtime', // hardened runtime — required for notarization
    '--timestamp', // secure timestamp — required for notarization
    executable,
  ];

  // Ad-hoc signing doesn't support --timestamp and doesn't need --options runtime
  if (id === '-') {
    try {
      execFileSync('codesign', ['-f', '--sign', '-', executable], {
        stdio: 'inherit',
      });
    } catch {
      execFileSync('ldid', ['-Cadhoc', '-S', executable], { stdio: 'inherit' });
    }
    return;
  }

  execFileSync('codesign', args, { stdio: 'inherit' });
}

function removeMachOExecutableSignature(executable: string) {
  execFileSync('codesign', ['--remove-signature', executable], {
    stdio: 'inherit',
  });
}

// ─────────────────────────────────────────────────────────────────────
// Notarization
// ─────────────────────────────────────────────────────────────────────

export interface NotarizeOptions {
  /** Path to the signed executable. */
  executable: string;

  /**
   * Apple ID email for notarization.
   * Resolved from argument → HAKOBU_APPLE_ID env var.
   */
  appleId?: string;

  /**
   * App-specific password for the Apple ID.
   * Resolved from argument → HAKOBU_APPLE_PASSWORD env var.
   *
   * Generate at https://appleid.apple.com/account/manage → App-Specific Passwords.
   */
  applePassword?: string;

  /**
   * Apple Developer Team ID.
   * Resolved from argument → HAKOBU_APPLE_TEAM_ID env var.
   */
  teamId?: string;
}

/**
 * Submit a signed macOS executable for Apple notarization, then staple
 * the notarization ticket to the binary.
 *
 * Prerequisites:
 *   - The executable must be signed with a Developer ID identity (not ad-hoc)
 *     with hardened runtime (--options runtime) and a secure timestamp (--timestamp)
 *   - Apple ID, app-specific password, and team ID must be provided
 *   - Xcode command-line tools must be installed (provides xcrun)
 *
 * The function:
 *   1. Zips the executable (notarytool requires a zip, dmg, or pkg)
 *   2. Submits to Apple via `xcrun notarytool submit --wait`
 *   3. Staples the ticket via `xcrun stapler staple`
 *   4. Cleans up the temp zip
 *
 * @throws If any step fails (missing credentials, submission rejected, etc.)
 */
async function notarizeMachOExecutable(opts: NotarizeOptions): Promise<void> {
  const {
    executable,
    appleId = process.env.HAKOBU_APPLE_ID,
    applePassword = process.env.HAKOBU_APPLE_PASSWORD,
    teamId = process.env.HAKOBU_APPLE_TEAM_ID,
  } = opts;

  if (!appleId || !applePassword || !teamId) {
    const missing = [];
    if (!appleId) missing.push('HAKOBU_APPLE_ID');
    if (!applePassword) missing.push('HAKOBU_APPLE_PASSWORD');
    if (!teamId) missing.push('HAKOBU_APPLE_TEAM_ID');
    throw new Error(
      `Cannot notarize: missing ${missing.join(', ')}. ` +
        `Set these env vars or pass them as options. See docs/macos-notarization.md.`,
    );
  }

  // 1. Create a zip for submission (notarytool requires zip/dmg/pkg)
  const zipPath = executable + '.zip';
  log.info('Creating zip for notarization submission...');
  execFileSync('ditto', ['-c', '-k', '--keepParent', executable, zipPath], {
    stdio: 'pipe',
  });

  try {
    // 2. Submit and wait for notarization result
    log.info(
      'Submitting to Apple notary service (this may take a few minutes)...',
    );
    const { stdout } = await execFileAsync(
      'xcrun',
      [
        'notarytool',
        'submit',
        zipPath,
        '--apple-id',
        appleId,
        '--password',
        applePassword,
        '--team-id',
        teamId,
        '--wait',
      ],
      { timeout: 600000 },
    ); // 10 minute timeout

    log.info(`Notarization result:\n${stdout}`);

    if (
      stdout.includes('status: Invalid') ||
      stdout.includes('status: Rejected')
    ) {
      throw new Error(
        'Apple notarization was rejected. Run:\n' +
          '  xcrun notarytool log <submission-id> --apple-id ... --password ... --team-id ...\n' +
          'to see the full rejection reason.',
      );
    }

    // 3. Staple the notarization ticket to the executable
    log.info('Stapling notarization ticket...');
    execFileSync('xcrun', ['stapler', 'staple', executable], {
      stdio: 'inherit',
    });

    log.info('Notarization complete — executable is notarized and stapled.');
  } finally {
    // 4. Clean up temp zip
    try {
      const fs = require('fs');
      fs.unlinkSync(zipPath);
    } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────
// App bundle signing
// ─────────────────────────────────────────────────────────────────────

/**
 * Sign a macOS .app bundle.
 *
 * Uses `codesign --deep` to recursively sign all code in the bundle.
 * This replaces any ad-hoc signature on the inner executable with a
 * proper bundle signature.
 *
 * Identity resolution is the same as signMachOExecutable.
 */
function signAppBundle(bundlePath: string, identity?: string) {
  const id = identity || process.env.HAKOBU_SIGN_IDENTITY || '-';

  if (id === '-') {
    // Ad-hoc: sign the bundle without timestamp/hardened runtime
    try {
      execFileSync(
        'codesign',
        ['--deep', '--force', '--sign', '-', bundlePath],
        {
          stdio: 'inherit',
        },
      );
    } catch {
      // Non-fatal for ad-hoc — bundle may still work
    }
    return;
  }

  execFileSync(
    'codesign',
    [
      '--deep',
      '--force',
      '--sign',
      id,
      '--options',
      'runtime',
      '--timestamp',
      bundlePath,
    ],
    { stdio: 'inherit' },
  );
}

/**
 * Submit a signed macOS .app bundle for Apple notarization.
 *
 * Similar to notarizeMachOExecutable but targets a .app directory:
 *   1. Zips the .app bundle (ditto preserves bundle structure)
 *   2. Submits to Apple via notarytool
 *   3. Staples the ticket to the .app bundle
 */
async function notarizeAppBundle(opts: NotarizeOptions): Promise<void> {
  const {
    executable: bundlePath,
    appleId = process.env.HAKOBU_APPLE_ID,
    applePassword = process.env.HAKOBU_APPLE_PASSWORD,
    teamId = process.env.HAKOBU_APPLE_TEAM_ID,
  } = opts;

  if (!appleId || !applePassword || !teamId) {
    const missing = [];
    if (!appleId) missing.push('HAKOBU_APPLE_ID');
    if (!applePassword) missing.push('HAKOBU_APPLE_PASSWORD');
    if (!teamId) missing.push('HAKOBU_APPLE_TEAM_ID');
    throw new Error(
      `Cannot notarize: missing ${missing.join(', ')}. ` +
        `Set these env vars or pass them as options. See docs/macos-notarization.md.`,
    );
  }

  const zipPath = bundlePath + '.zip';
  log.info('Creating zip of .app bundle for notarization...');
  execFileSync('ditto', ['-c', '-k', '--keepParent', bundlePath, zipPath], {
    stdio: 'pipe',
  });

  try {
    log.info('Submitting .app bundle to Apple notary service...');
    const { stdout } = await execFileAsync(
      'xcrun',
      [
        'notarytool',
        'submit',
        zipPath,
        '--apple-id',
        appleId,
        '--password',
        applePassword,
        '--team-id',
        teamId,
        '--wait',
      ],
      { timeout: 600000 },
    );

    log.info(`Notarization result:\n${stdout}`);

    if (
      stdout.includes('status: Invalid') ||
      stdout.includes('status: Rejected')
    ) {
      throw new Error(
        'Apple notarization was rejected. Run:\n' +
          '  xcrun notarytool log <submission-id> --apple-id ... --password ... --team-id ...\n' +
          'to see the full rejection reason.',
      );
    }

    log.info('Stapling notarization ticket to .app bundle...');
    execFileSync('xcrun', ['stapler', 'staple', bundlePath], {
      stdio: 'inherit',
    });

    log.info('Notarization complete — .app bundle is notarized and stapled.');
  } finally {
    try {
      const fs = require('fs');
      fs.unlinkSync(zipPath);
    } catch {}
  }
}

export {
  patchMachOExecutable,
  removeMachOExecutableSignature,
  signMachOExecutable,
  notarizeMachOExecutable,
  signAppBundle,
  notarizeAppBundle,
};
