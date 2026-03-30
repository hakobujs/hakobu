/**
 * Windows Authenticode Signing
 *
 * Signs Windows PE executables (.exe) using Authenticode via signtool.exe
 * (Windows SDK) or osslsigncode (cross-platform, for signing from
 * macOS/Linux CI).
 *
 * Signing is opt-in: when no certificate is configured, Hakobu produces
 * unsigned executables (which is the normal case for local development).
 *
 * Environment variables:
 *   HAKOBU_WIN_CERT        - Path to .pfx/.p12 certificate file
 *   HAKOBU_WIN_CERT_PASSWORD - Certificate password
 *   HAKOBU_WIN_TIMESTAMP_URL - Timestamp server URL (default: http://timestamp.digicert.com)
 *
 * See docs/windows-signing.md for full setup instructions.
 */

import { execFileSync } from 'child_process';

import { log } from './log';

// ─────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_TIMESTAMP_URL = 'http://timestamp.digicert.com';

export interface WindowsSignOptions {
  /** Path to the .exe to sign. */
  executable: string;

  /**
   * Path to the .pfx / .p12 certificate file.
   * Resolved from argument → HAKOBU_WIN_CERT env var.
   */
  certPath?: string;

  /**
   * Certificate password.
   * Resolved from argument → HAKOBU_WIN_CERT_PASSWORD env var.
   */
  certPassword?: string;

  /**
   * RFC 3161 timestamp server URL.
   * Default: http://timestamp.digicert.com
   * Also: HAKOBU_WIN_TIMESTAMP_URL env var.
   */
  timestampUrl?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Signing
// ─────────────────────────────────────────────────────────────────────

/**
 * Check whether Windows signing credentials are configured.
 * Returns true if a certificate path is available (via option or env var).
 */
export function hasWindowsSigningCredentials(certPath?: string): boolean {
  return !!(certPath || process.env.HAKOBU_WIN_CERT);
}

/**
 * Sign a Windows PE executable with Authenticode.
 *
 * Tries signtool.exe first (available on Windows with Windows SDK),
 * then falls back to osslsigncode (available cross-platform via
 * brew/apt/choco).
 *
 * @throws If signing credentials are missing or both tools fail.
 */
export function signWindowsExecutable(opts: WindowsSignOptions): void {
  const certPath = opts.certPath || process.env.HAKOBU_WIN_CERT;
  const certPassword =
    opts.certPassword || process.env.HAKOBU_WIN_CERT_PASSWORD;
  const timestampUrl =
    opts.timestampUrl ||
    process.env.HAKOBU_WIN_TIMESTAMP_URL ||
    DEFAULT_TIMESTAMP_URL;

  if (!certPath) {
    throw new Error(
      'Cannot sign Windows executable: no certificate configured.\n' +
        'Set HAKOBU_WIN_CERT to the path of your .pfx/.p12 file.\n' +
        'See docs/windows-signing.md for setup instructions.',
    );
  }

  // Try signtool.exe (Windows SDK)
  if (trySigntool(opts.executable, certPath, certPassword, timestampUrl)) {
    return;
  }

  // Fall back to osslsigncode (cross-platform)
  if (tryOsslsigncode(opts.executable, certPath, certPassword, timestampUrl)) {
    return;
  }

  throw new Error(
    'Authenticode signing failed: neither signtool.exe nor osslsigncode found.\n' +
      'On Windows: install Windows SDK (provides signtool.exe).\n' +
      'On macOS/Linux: install osslsigncode (brew install osslsigncode / apt install osslsigncode).\n' +
      'See docs/windows-signing.md for details.',
  );
}

/**
 * Try signing with signtool.exe (Windows SDK).
 * Returns true on success, false if signtool is not available.
 */
function trySigntool(
  executable: string,
  certPath: string,
  certPassword: string | undefined,
  timestampUrl: string,
): boolean {
  const args = [
    'sign',
    '/f',
    certPath,
    '/fd',
    'SHA256',
    '/tr',
    timestampUrl,
    '/td',
    'SHA256',
  ];

  if (certPassword) {
    args.push('/p', certPassword);
  }

  args.push(executable);

  try {
    execFileSync('signtool', args, { stdio: 'pipe' });
    log.info(`Signed ${executable} with signtool (Authenticode SHA-256)`);
    return true;
  } catch (err: any) {
    // ENOENT means signtool not found — fall through to osslsigncode
    if (err.code === 'ENOENT') return false;
    // signtool found but signing failed — throw
    throw new Error(
      `signtool signing failed: ${err.message}\n` +
        'Check that your certificate is valid and the password is correct.',
    );
  }
}

/**
 * Try signing with osslsigncode (cross-platform Authenticode signing).
 * Returns true on success, false if osslsigncode is not available.
 */
function tryOsslsigncode(
  executable: string,
  certPath: string,
  certPassword: string | undefined,
  timestampUrl: string,
): boolean {
  // osslsigncode signs in-place by writing to a temp file and replacing.
  // Use -in and -out with the same file via a temp intermediate.
  const tmpOut = executable + '.signed';
  const args = [
    'sign',
    '-pkcs12',
    certPath,
    '-h',
    'sha256',
    '-ts',
    timestampUrl,
    '-in',
    executable,
    '-out',
    tmpOut,
  ];

  if (certPassword) {
    args.push('-pass', certPassword);
  }

  try {
    execFileSync('osslsigncode', args, { stdio: 'pipe' });
    // Replace original with signed version
    const fs = require('fs');
    fs.renameSync(tmpOut, executable);
    log.info(`Signed ${executable} with osslsigncode (Authenticode SHA-256)`);
    return true;
  } catch (err: any) {
    // Clean up temp file on failure
    try {
      require('fs').unlinkSync(tmpOut);
    } catch {}
    if (err.code === 'ENOENT') return false;
    throw new Error(
      `osslsigncode signing failed: ${err.message}\n` +
        'Check that your certificate is valid and the password is correct.',
    );
  }
}
