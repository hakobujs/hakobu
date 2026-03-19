# CLAUDE.md

Hakobu is a Node.js executable packager — the successor to `@yao-pkg/pkg`.

## Project structure

```
hakobu/
├── packages/
│   ├── hakobu/            # CLI + programmatic API  (@hakobu/hakobu)
│   └── hakobu-fetch/      # patched Node binary manager  (@hakobu/hakobu-fetch)
├── patches/node/24.x/     # Node source patches (future)
├── fixtures/              # executable test fixtures (future)
├── .kiro/specs/hakobu/    # spec-driven development docs
└── .github/workflows/     # CI/CD (future)
```

## Tooling

- **Monorepo**: pnpm workspaces (no Turborepo)
- **Language**: TypeScript, compiled to `lib-es5/` per package
- **Runtime target**: Node 24.x LTS
- **Package scope**: `@hakobu/*`
- **CLI binary**: `hakobu`

## Quick reference

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Build a single package
pnpm --filter @hakobu/hakobu build
pnpm --filter @hakobu/hakobu-fetch build

# Lint
pnpm lint

# Test
pnpm test
```

## Key context

- Forked from `@yao-pkg/pkg` (v6.14.1) and `@yao-pkg/pkg-fetch` (v3.5.32)
- Uses a patched Node binary + snapshot filesystem model (not Node SEA)
- Windows Playwright/Camoufox with custom stdio is a release-gate workload
- Design docs and requirements live in `.kiro/specs/hakobu/`
