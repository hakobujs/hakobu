# Contributing to Hakobu

Thank you for your interest in contributing to Hakobu. This guide explains how
to get started and what to expect.

## Getting Started

### Prerequisites

- Node.js 24+
- pnpm (any recent version)
- Git

### Setup

```bash
git clone https://github.com/hakobujs/hakobu.git
cd hakobu
pnpm install
pnpm build
```

### Running Tests

```bash
# Node-only fixture suite (fast, no packaging)
node fixtures/run.js --node-only

# Full fixture suite (packages executables, slower)
node fixtures/run.js

# Specialized verification tests
node fixtures/test-bytecode.js
node fixtures/test-sourcemap.js
node fixtures/test-multi-target.js
node fixtures/test-code-split.js
node fixtures/test-app-bundle.js     # macOS only
node fixtures/test-appdir.js         # Linux packaging tests on Linux
node fixtures/test-exit-cleanup.js
node fixtures/test-workspace-bundle.js
```

### Project Structure

```
hakobu/
  packages/
    hakobu/           CLI + programmatic API (@hakobu/hakobu)
    hakobu-fetch/     Patched Node binary manager (@hakobu/hakobu-fetch)
  fixtures/           Executable test fixtures
  docs/               Design docs and user guides
  .github/workflows/  CI/CD workflows
```

## Making Changes

### Workflow

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Run `pnpm build` to verify TypeScript compiles
5. Run `node fixtures/run.js --node-only` for a quick test
6. Run individual fixture tests relevant to your change
7. Open a pull request

### Commit Messages

Follow conventional commit format:

```
feat(bundler): add per-chunk __dirname injection
fix(resolver): handle conditional exports for CJS require()
chore(ci): update Node version in workflow
docs: update migration guide for multi-target
```

### What Makes a Good PR

- Focused on a single change
- Includes tests or fixture coverage for new behavior
- Does not break existing fixtures
- Describes the "why" in the PR description

## Areas for Contribution

### Good First Issues

- Fixture coverage for untested package patterns
- Documentation improvements
- Error message improvements
- Platform-specific bug reports with reproduction steps

### Needs Expertise

- Base binary build pipeline (Node C++ patches)
- Snapshot filesystem runtime (prelude/bootstrap.js)
- Bundle mode code-splitting and compatibility patches

## Reporting Issues

When reporting a bug:

1. Include the Hakobu version (`hakobu --version`)
2. Include your Node.js version and platform
3. Provide the smallest reproduction possible
4. Include the full error output (use `--debug` for verbose logging)

## License

By contributing, you agree that your contributions will be licensed under the
MIT License.
