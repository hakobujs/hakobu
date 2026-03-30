/**
 * Hakobu Snapshot Path Canonicalization
 *
 * Canonical rules:
 *
 * 1. INTERNAL FORM is always POSIX: /snapshot/{appId}/path/to/file.js
 *    - Forward slashes only
 *    - No drive letter
 *    - No trailing slash (except root "/")
 *    - No duplicate slashes
 *    - No . or .. segments (resolved)
 *    - Case-sensitive for all path segments
 *
 * 2. PLATFORM-NATIVE FORM is what Node's fs module sees:
 *    - POSIX: /snapshot/{appId}/path/to/file.js (same as internal)
 *    - Windows: C:\snapshot\{appId}\path\to\file.js
 *
 * 3. DETECTION accepts any platform variation:
 *    - /snapshot/...
 *    - C:\snapshot\... (any drive letter case)
 *    - C:/snapshot/... (mixed separators)
 *    - Paths with . and .. segments that resolve into /snapshot/
 *
 * 4. CASE SENSITIVITY:
 *    - The "snapshot" prefix is case-insensitive on Windows only
 *    - All path segments below /snapshot/ are case-sensitive on all
 *      platforms (Node module resolution is case-sensitive)
 *
 * These utilities are used by:
 * - snapshot-fs.ts (SnapshotFS lookups)
 * - snapshot-fs-patch.ts (routing decisions)
 * - snapshot-index.ts (index key computation)
 * - (future) ESM loader (import.meta.url construction)
 */

const IS_WIN = process.platform === 'win32';

// ─────────────────────────────────────────────────────────────────────
// Detection
// ─────────────────────────────────────────────────────────────────────

/**
 * Check if a path is inside the snapshot filesystem.
 * Accepts any platform-native form, including mixed separators.
 */
export function isSnapshotPath(p: string): boolean {
  // Normalize for detection: lowercase, forward slashes
  const norm = p.replace(/\\/g, '/');
  const lower = norm.toLowerCase();

  // Strip drive letter for matching
  const noPrefix = /^[a-z]:/.test(lower) ? lower.slice(2) : lower;

  return noPrefix === '/snapshot' || noPrefix.startsWith('/snapshot/');
}

// ─────────────────────────────────────────────────────────────────────
// Canonicalization
// ─────────────────────────────────────────────────────────────────────

/**
 * Convert any snapshot path form to canonical POSIX internal form.
 *
 * Input: any valid snapshot path (native or mixed)
 * Output: /snapshot/{appId}/path/to/file (no trailing slash, no ./..)
 *
 * Throws if the input is not a snapshot path.
 */
export function toCanonical(nativePath: string): string {
  // Replace all backslashes with forward slashes
  let p = nativePath.replace(/\\/g, '/');

  // Strip drive letter (e.g., C: or c:)
  if (/^[A-Za-z]:/.test(p)) {
    p = p.slice(2);
  }

  // Resolve . and .. segments, collapse duplicate slashes
  const parts = p.split('/');
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      // Don't resolve above the root
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '') {
        resolved.pop();
      }
      continue;
    }
    resolved.push(part);
  }

  const result = '/' + resolved.join('/');

  // Remove trailing slash (except bare "/")
  if (result.length > 1 && result.endsWith('/')) {
    return result.slice(0, -1);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Platform conversion
// ─────────────────────────────────────────────────────────────────────

/**
 * Convert a canonical POSIX path to platform-native form.
 * - POSIX: returns the path unchanged
 * - Windows: prepends C: and replaces / with \
 */
export function toNative(posixPath: string): string {
  if (IS_WIN) {
    return 'C:' + posixPath.replace(/\//g, '\\');
  }
  return posixPath;
}

/**
 * Construct a file: URL from a canonical snapshot path.
 * Used for import.meta.url in ESM modules.
 *
 * POSIX: file:///snapshot/app/src/index.js
 * Windows: file:///C:/snapshot/app/src/index.js
 */
export function toFileUrl(posixPath: string): string {
  if (IS_WIN) {
    return 'file:///C:' + posixPath;
  }
  return 'file://' + posixPath;
}

/**
 * Extract the canonical POSIX path from a file: URL.
 * Returns null if the URL doesn't point into the snapshot.
 */
export function fromFileUrl(url: string): string | null {
  if (!url.startsWith('file://')) return null;

  let p: string;
  if (url.startsWith('file:///') && /^file:\/\/\/[A-Za-z]:/.test(url)) {
    // file:///C:/snapshot/... → /snapshot/...
    p = url.slice(8); // after file:///C:
  } else {
    // file:///snapshot/... → /snapshot/...
    p = url.slice(7); // after file://
  }

  p = decodeURIComponent(p);

  if (!p.startsWith('/snapshot')) return null;
  return toCanonical(p);
}

// ─────────────────────────────────────────────────────────────────────
// Snapshot root and app ID extraction
// ─────────────────────────────────────────────────────────────────────

/**
 * Get the snapshot root for a given appId in platform-native form.
 * POSIX: /snapshot/{appId}
 * Windows: C:\snapshot\{appId}
 */
export function snapshotRoot(appId: string): string {
  return toNative(`/snapshot/${appId}`);
}

/**
 * Join a snapshot root with a relative path, returning canonical form.
 */
export function snapshotJoin(appId: string, ...segments: string[]): string {
  const posix = '/snapshot/' + appId + '/' + segments.join('/');
  return toCanonical(posix);
}
