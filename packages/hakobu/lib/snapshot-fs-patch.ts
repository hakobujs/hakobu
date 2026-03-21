/**
 * Hakobu Snapshot Filesystem Patch
 *
 * Monkey-patches Node's `fs` module to intercept snapshot-owned paths
 * and route them to SnapshotFS. Non-snapshot paths pass through to the
 * real OS filesystem unchanged.
 *
 * This is the runtime integration layer. It follows the same pattern as
 * the inherited pkg bootstrap.js but delegates to the clean SnapshotFS
 * abstraction instead of the legacy VIRTUAL_FILESYSTEM.
 *
 * Usage (in the runtime bootstrap):
 *   const { patchFS, unpatchFS } = require('./snapshot-fs-patch');
 *   const sfs = new SnapshotFS(index, blob);
 *   const restore = patchFS(sfs);
 *   // ... app runs with patched fs ...
 *   restore(); // optional cleanup
 *
 * Only sync operations are patched in this first slice.
 * Async variants will be added when needed for the ESM loader.
 */

import fs from 'fs';
import Module from 'module';
import { SnapshotFS, isSnapshotPath, toNative } from './snapshot-fs';
import { toCanonical } from './snapshot-path';
import { extractAddon } from './addon-extract';

// ─────────────────────────────────────────────────────────────────────
// Path coercion (Node passes string | Buffer | URL)
// ─────────────────────────────────────────────────────────────────────

function coercePath(p: unknown): string | null {
  if (typeof p === 'string') return p;
  if (Buffer.isBuffer(p)) return p.toString();
  if (p instanceof URL) {
    if (p.protocol === 'file:') {
      // file:///snapshot/app/... → /snapshot/app/...
      return process.platform === 'win32'
        ? p.pathname.replace(/^\//, '')
        : p.pathname;
    }
    return null; // non-file URL, let Node handle it
  }
  return null;
}

function isSnapshotArg(arg: unknown): boolean {
  const p = coercePath(arg);
  return p !== null && isSnapshotPath(p);
}

// ─────────────────────────────────────────────────────────────────────
// EROFS error for write operations
// ─────────────────────────────────────────────────────────────────────

function throwEROFS(syscall: string, arg: unknown): never {
  const p = coercePath(arg) ?? String(arg);
  const err = new Error(`${syscall} EROFS: read-only file system, '${p}'`) as NodeJS.ErrnoException;
  err.code = 'EROFS';
  err.errno = -30;
  err.syscall = syscall;
  err.path = p;
  throw err;
}

// ─────────────────────────────────────────────────────────────────────
// Patch entry point
// ─────────────────────────────────────────────────────────────────────

/**
 * Patch Node's `fs` module to route snapshot paths to the given
 * SnapshotFS instance. Returns a restore function that undoes the patch.
 */
export function patchFS(sfs: SnapshotFS): () => void {
  // Save originals
  const orig = {
    existsSync: fs.existsSync,
    statSync: fs.statSync,
    lstatSync: fs.lstatSync,
    readFileSync: fs.readFileSync,
    readdirSync: fs.readdirSync,
    realpathSync: fs.realpathSync,
    accessSync: fs.accessSync,
    writeFileSync: fs.writeFileSync,
    mkdirSync: fs.mkdirSync,
    unlinkSync: fs.unlinkSync,
    rmdirSync: fs.rmdirSync,
    renameSync: fs.renameSync,
    chmodSync: fs.chmodSync,
    copyFileSync: fs.copyFileSync,
  };

  const origRealpathNative = fs.realpathSync.native;

  // ── existsSync ──

  (fs as any).existsSync = function existsSync(path_: any): boolean {
    if (isSnapshotArg(path_)) {
      return sfs.existsSync(coercePath(path_)!);
    }
    return orig.existsSync.call(fs, path_);
  };

  // ── statSync ──

  (fs as any).statSync = function statSync(path_: any, options?: any) {
    if (isSnapshotArg(path_)) {
      try {
        return sfs.statSync(coercePath(path_)!);
      } catch (e: any) {
        if (options?.throwIfNoEntry === false && e.code === 'ENOENT') {
          return undefined;
        }
        throw e;
      }
    }
    return orig.statSync.call(fs, path_, options);
  };

  // ── lstatSync ──

  (fs as any).lstatSync = function lstatSync(path_: any, options?: any) {
    if (isSnapshotArg(path_)) {
      try {
        return sfs.lstatSync(coercePath(path_)!);
      } catch (e: any) {
        if (options?.throwIfNoEntry === false && e.code === 'ENOENT') {
          return undefined;
        }
        throw e;
      }
    }
    return orig.lstatSync.call(fs, path_, options);
  };

  // ── readFileSync ──

  (fs as any).readFileSync = function readFileSync(path_: any, options_?: any) {
    if (isSnapshotArg(path_)) {
      const p = coercePath(path_)!;
      const buffer = sfs.readFileSync(p);

      // Handle encoding option
      const encoding = typeof options_ === 'string'
        ? options_
        : options_?.encoding ?? null;

      if (encoding) {
        return buffer.toString(encoding as BufferEncoding);
      }
      return buffer;
    }
    return orig.readFileSync.call(fs, path_, options_);
  };

  // ── readdirSync ──

  (fs as any).readdirSync = function readdirSync(path_: any, options_?: any) {
    if (isSnapshotArg(path_)) {
      const entries = sfs.readdirSync(coercePath(path_)!);

      // Handle withFileTypes option
      if (options_?.withFileTypes) {
        const p = coercePath(path_)!;
        return entries.map((name: string) => {
          const fullPath = p.endsWith('/') ? p + name : p + '/' + name;
          const stat = sfs.existsSync(fullPath) ? sfs.statSync(fullPath) : null;
          return {
            name,
            isFile: () => stat?.isFile() ?? false,
            isDirectory: () => stat?.isDirectory() ?? false,
            isSymbolicLink: () => false,
            isBlockDevice: () => false,
            isCharacterDevice: () => false,
            isFIFO: () => false,
            isSocket: () => false,
          };
        });
      }

      return entries;
    }
    return orig.readdirSync.call(fs, path_, options_);
  };

  // ── realpathSync ──

  (fs as any).realpathSync = function realpathSync(path_: any, options?: any) {
    if (isSnapshotArg(path_)) {
      return sfs.realpathSync(coercePath(path_)!);
    }
    return orig.realpathSync.call(fs, path_, options);
  };

  // Preserve realpathSync.native
  (fs as any).realpathSync.native = function realpathSyncNative(path_: any, options?: any) {
    if (isSnapshotArg(path_)) {
      return sfs.realpathSync(coercePath(path_)!);
    }
    return origRealpathNative.call(fs, path_, options);
  };

  // ── accessSync ──

  (fs as any).accessSync = function accessSync(path_: any, mode_?: number) {
    if (isSnapshotArg(path_)) {
      const p = coercePath(path_)!;
      // Read access always succeeds if the path exists
      if (!sfs.existsSync(p)) {
        const err = new Error(`ENOENT: no such file or directory, access '${p}'`) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        err.errno = -2;
        err.syscall = 'access';
        err.path = p;
        throw err;
      }
      // Write access on snapshot paths fails
      const W_OK = 2;
      if (mode_ !== undefined && (mode_ & W_OK)) {
        const err = new Error(`EROFS: read-only file system, access '${p}'`) as NodeJS.ErrnoException;
        err.code = 'EROFS';
        err.errno = -30;
        err.syscall = 'access';
        err.path = p;
        throw err;
      }
      return; // read-only access OK
    }
    return orig.accessSync.call(fs, path_, mode_);
  };

  // ── Write operations → EROFS ──

  (fs as any).writeFileSync = function writeFileSync(path_: any, ...rest: any[]) {
    if (isSnapshotArg(path_)) throwEROFS('write', path_);
    return (orig.writeFileSync as any).call(fs, path_, ...rest);
  };

  (fs as any).mkdirSync = function mkdirSync(path_: any, ...rest: any[]) {
    if (isSnapshotArg(path_)) throwEROFS('mkdir', path_);
    return (orig.mkdirSync as any).call(fs, path_, ...rest);
  };

  (fs as any).unlinkSync = function unlinkSync(path_: any) {
    if (isSnapshotArg(path_)) throwEROFS('unlink', path_);
    return orig.unlinkSync.call(fs, path_);
  };

  (fs as any).rmdirSync = function rmdirSync(path_: any, ...rest: any[]) {
    if (isSnapshotArg(path_)) throwEROFS('rmdir', path_);
    return (orig.rmdirSync as any).call(fs, path_, ...rest);
  };

  (fs as any).renameSync = function renameSync(oldPath: any, newPath: any) {
    if (isSnapshotArg(oldPath) || isSnapshotArg(newPath)) {
      throwEROFS('rename', isSnapshotArg(oldPath) ? oldPath : newPath);
    }
    return orig.renameSync.call(fs, oldPath, newPath);
  };

  (fs as any).chmodSync = function chmodSync(path_: any, mode: any) {
    if (isSnapshotArg(path_)) throwEROFS('chmod', path_);
    return orig.chmodSync.call(fs, path_, mode);
  };

  (fs as any).copyFileSync = function copyFileSync(src: any, dest: any, ...rest: any[]) {
    if (isSnapshotArg(dest)) throwEROFS('copyfile', dest);
    // Reading from snapshot is OK — write the data through host FS
    if (isSnapshotArg(src)) {
      const content = sfs.readFileSync(coercePath(src)!);
      return orig.writeFileSync.call(fs, dest, content);
    }
    return (orig.copyFileSync as any).call(fs, src, dest, ...rest);
  };

  // ── CJS Module resolution patch ──
  // Node's require() uses Module._resolveFilename which calls internal
  // C++ file operations that bypass our fs patches. We patch
  // _resolveFilename to recognize snapshot paths directly.

  const origResolveFilename = (Module as any)._resolveFilename;

  (Module as any)._resolveFilename = function _resolveFilename(
    request: string,
    parent: any,
    isMain: boolean,
    options: any,
  ) {
    let resolved: string | null = null;

    // Absolute snapshot path
    if (isSnapshotArg(request)) {
      const p = coercePath(request)!;
      if (sfs.existsSync(p)) resolved = p;
    }

    // Relative require from within snapshot (./foo, ../bar)
    if (!resolved && (request.startsWith('.') || request.startsWith('/')) && parent?.filename && isSnapshotArg(parent.filename)) {
      const parentDir = parent.filename.substring(0, parent.filename.lastIndexOf('/'));
      const candidate = toCanonical(parentDir + '/' + request);
      resolved = tryResolveInSnapshot(candidate, sfs);
    }

    // Bare specifier from within snapshot (package name)
    if (!resolved && parent?.filename && isSnapshotArg(parent.filename) && !request.startsWith('.') && !request.startsWith('/')) {
      resolved = tryResolveBareInSnapshot(request, parent.filename, sfs);
    }

    if (resolved) {
      // Native addons (.node) cannot be loaded from the snapshot via
      // dlopen() — they must exist as real files. Extract to the
      // deterministic cache and return the extracted path.
      if (resolved.endsWith('.node') && isSnapshotPath(resolved)) {
        const extracted = extractAddon(resolved, sfs);
        return extracted.extractedPath;
      }
      return resolved;
    }

    return origResolveFilename.call(this, request, parent, isMain, options);
  };

  // (ensureSnapshotModuleCached removed — preloading is handled by bootstrap)

  // Patch Module._compile to read snapshot source via SnapshotFS
  // when the filename is a snapshot path.
  const origCompile = (Module as any).prototype._compile;

  (Module as any).prototype._compile = function _compile(
    content: string,
    filename: string,
  ) {
    if (isSnapshotArg(filename)) {
      // Read the real content from snapshot (the CJS loader may have
      // passed empty or wrong content since the file doesn't exist
      // on the real filesystem).
      const p = coercePath(filename)!;
      if (sfs.existsSync(p) && sfs.statSync(p).isFile()) {
        content = sfs.readFileSync(p).toString('utf8');
      }
    }
    return origCompile.call(this, content, filename);
  };

  // ── CJS resolution helpers ──

  function tryResolveInSnapshot(candidate: string, sfsInst: SnapshotFS): string | null {
    const EXTS = ['.js', '.cjs', '.mjs', '.json', '.node'];
    // Exact file
    if (sfsInst.existsSync(candidate) && sfsInst.statSync(candidate).isFile()) return candidate;
    // With extensions
    for (const ext of EXTS) {
      const withExt = candidate + ext;
      if (sfsInst.existsSync(withExt) && sfsInst.statSync(withExt).isFile()) return withExt;
    }
    // Directory with index
    if (sfsInst.existsSync(candidate) && sfsInst.statSync(candidate).isDirectory()) {
      const pjPath = candidate + '/package.json';
      if (sfsInst.existsSync(pjPath)) {
        const pkg = sfsInst.getPackage(pjPath);
        if (pkg?.main) {
          const mainPath = toCanonical(candidate + '/' + pkg.main);
          const resolved = tryResolveInSnapshot(mainPath, sfsInst);
          if (resolved) return resolved;
        }
      }
      for (const ext of EXTS) {
        const indexPath = candidate + '/index' + ext;
        if (sfsInst.existsSync(indexPath)) return indexPath;
      }
    }
    return null;
  }

  function tryResolveBareInSnapshot(specifier: string, parentFilename: string, sfsInst: SnapshotFS): string | null {
    const pkgName = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0];
    const subpath = specifier.slice(pkgName.length);
    const appId = sfsInst.getAppId();
    const snapRoot = '/snapshot/' + appId;

    let searchDir = parentFilename.substring(0, parentFilename.lastIndexOf('/'));
    while (searchDir.startsWith(snapRoot)) {
      const nmDir = searchDir + '/node_modules/' + pkgName;
      if (sfsInst.existsSync(nmDir)) {
        if (!subpath) {
          // Root import — check exports, then main, then index
          const pkgJsonPath = nmDir + '/package.json';
          const pkg = sfsInst.existsSync(pkgJsonPath) ? sfsInst.getPackage(pkgJsonPath) : null;
          if (pkg?.main) {
            const resolved = tryResolveInSnapshot(toCanonical(nmDir + '/' + pkg.main), sfsInst);
            if (resolved) return resolved;
          }
          const resolved = tryResolveInSnapshot(nmDir + '/index', sfsInst);
          if (resolved) return resolved;
        } else {
          const resolved = tryResolveInSnapshot(toCanonical(nmDir + subpath), sfsInst);
          if (resolved) return resolved;
        }
        return null;
      }
      searchDir = searchDir.substring(0, searchDir.lastIndexOf('/'));
    }
    return null;
  }

  // ── Restore function ──

  return function unpatchFS() {
    (fs as any).existsSync = orig.existsSync;
    (fs as any).statSync = orig.statSync;
    (fs as any).lstatSync = orig.lstatSync;
    (fs as any).readFileSync = orig.readFileSync;
    (fs as any).readdirSync = orig.readdirSync;
    (fs as any).realpathSync = orig.realpathSync;
    (fs as any).realpathSync.native = origRealpathNative;
    (fs as any).accessSync = orig.accessSync;
    (fs as any).writeFileSync = orig.writeFileSync;
    (fs as any).mkdirSync = orig.mkdirSync;
    (fs as any).unlinkSync = orig.unlinkSync;
    (fs as any).rmdirSync = orig.rmdirSync;
    (fs as any).renameSync = orig.renameSync;
    (fs as any).chmodSync = orig.chmodSync;
    (fs as any).copyFileSync = orig.copyFileSync;
    (Module as any)._resolveFilename = origResolveFilename;
    (Module as any).prototype._compile = origCompile;
  };
}
