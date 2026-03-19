# Hakobu Spec Set

This folder contains the spec-driven development docs for `Hakobu`, the planned
successor to `@yao-pkg/pkg` and `@yao-pkg/pkg-fetch`.

Project intent:
- target `Node 24.x` LTS first
- deliver full native ESM support, not only bundled-entry compatibility
- preserve a `pkg`-style multi-file snapshot runtime instead of a SEA-style
  single embedded script model
- keep Node child-process behavior intact so Windows Playwright/Camoufox works
- use GitHub Actions as the primary public OSS CI/CD platform

Documents:
- `requirements.md`
  Product requirements in EARS form
- `design.md`
  Technical design for the fork, runtime model, and build pipeline
- `tasks.md`
  Detailed implementation plan
- `adr-001-fork-vs-scratch.md`
  Architecture decision record for starting from a fork instead of a rewrite

Current decision snapshot:
- product name: `Hakobu`
- packaging strategy: fork `@yao-pkg/pkg` and `@yao-pkg/pkg-fetch`
- runtime target: `Node 24.x` LTS
- module target: native ESM and CommonJS
- CI/CD target: GitHub Actions + GitHub Releases

