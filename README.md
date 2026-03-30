<p align="center">
  <img src="https://docs.hakobujs.dev/logo.png" alt="Hakobu" width="120" />
</p>

<h1 align="center">Hakobu</h1>

<p align="center">
  <strong>The modern Node.js packager — the successor to @yao-pkg/pkg.</strong><br/>
  Package your Node.js app into a standalone cross-platform executable.
</p>

<p align="center">
  <a href="https://docs.hakobujs.dev">Documentation</a> · <a href="#features">Features</a> · <a href="#skills">Skills</a> · <a href="#license">License</a>
</p>

<p align="center">
  <a href="https://github.com/hakobujs/hakobu/actions/workflows/ci.yml"><img src="https://github.com/hakobujs/hakobu/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/@hakobu/hakobu"><img src="https://img.shields.io/npm/v/@hakobu/hakobu?label=release&color=blue" alt="npm version" /></a>
  <a href="https://github.com/hakobujs/hakobu/blob/main/LICENSE"><img src="https://img.shields.io/github/license/hakobujs/hakobu" alt="license" /></a>
  <a href="https://www.npmjs.com/package/@hakobu/hakobu"><img src="https://img.shields.io/npm/dm/@hakobu/hakobu?label=downloads&color=green" alt="downloads" /></a>
  <a href="https://github.com/hakobujs/hakobu/stargazers"><img src="https://img.shields.io/github/stars/hakobujs/hakobu" alt="stars" /></a>
</p>

---

## Features

- **Cross-platform builds** — Produce standalone executables for Linux, macOS, and Windows from a single machine.
- **ESM + CJS support** — Full native ESM support including `import`, `import()`, and `import.meta`, alongside complete CJS compatibility.
- **Rolldown built-in** — Optional bundle mode with Rolldown for TypeScript, monorepos, and tree-shaking before packaging.
- **Snapshot filesystem** — Assets, templates, and modules are embedded into a virtual filesystem served from memory.
- **Instant startup** — V8 snapshots skip module-loading overhead for near-instant launch times.
- **Native addon support** — `.node` files are detected, extracted, and cached at runtime automatically.
- **macOS signing & notarization** — Code sign with Developer ID and submit to Apple notarization in one command.
- **Windows PE metadata** — Inject product name, version, company, icon, and Authenticode signatures.
- **Linux AppDir & AppImage** — Produce AppDir structures or self-contained AppImage files.
- **Compression** — Reduce binary size with Brotli or GZip snapshot compression.
- **Programmatic API** — Use `exec()` from Node.js scripts for CI/CD integration and automation.
- **Drop-in replacement** — Migrate from `@yao-pkg/pkg` with minimal changes. Legacy `"pkg"` config is accepted.

## Documentation

Visit [docs.hakobujs.dev](https://docs.hakobujs.dev) for the full documentation, guides, and API reference.

## Skills

Using an AI coding agent? Install the Hakobu skill for CLI reference and code generation across Claude Code, GitHub Copilot, Cursor, Cline, Gemini CLI, and more:

```bash
npx skills add hakobujs/hakobu-skill
```

## License

MIT
