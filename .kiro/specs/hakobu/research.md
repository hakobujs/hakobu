# Research Notes

This file captures the external facts used to shape the Hakobu spec set.

## Runtime and Packaging Findings

### `vercel/pkg` Line

- `vercel/pkg` is archived and deprecated.
- `vercel/pkg-fetch` is archived and deprecated.
- Historical issue history shows real ESM limitations, not just missing polish.

Implication:
- Hakobu should not start from archived `vercel/pkg`.
- A fork of the actively maintained `@yao-pkg` line is the more practical base.

### `@yao-pkg` Line

- `@yao-pkg/pkg` and `@yao-pkg/pkg-fetch` are the active continuation line.
- They still inherit the old `pkg` runtime model rather than Node SEA's
  single-script execution model.

Implication:
- Hakobu can preserve a multi-file snapshot runtime and does not need to adopt a
  SEA-style packaging contract.

### Node SEA

- Node SEA remains an injected-script model rather than a `pkg`-style snapshot
  runtime.
- SEA is workable for some single-binary use cases, but it is a worse fit for
  minimal-churn migration from `pkg`.

Implication:
- Hakobu should not treat SEA as the architectural baseline.

### Bun Compile

- Bun compiled binaries work well for many cases, but the Windows Playwright
  and Camoufox case exposed a critical child-process compatibility gap around
  extra `stdio` descriptors.

Implication:
- Hakobu's runtime must preserve Node child-process behavior, especially on
  Windows.

### Deno

- Deno is more promising than Bun for some process and compatibility cases, but
  it is not a clean fit for a project whose natural migration path is the `pkg`
  ecosystem.

Implication:
- Deno is not the preferred base for Hakobu.

## Node 24 and ESM Findings

### Node 24 LTS

- `Node 24.x` is the primary target line for the project.
- Node 24 exposes modern module customization hooks through `node:module`.

Implication:
- Hakobu should target Node 24 first instead of trying to maintain broad
  historical Node-line support from day one.
- Native ESM support should be designed around Node 24 capabilities rather than
  retrofitted to older loader models.

### Native ESM

- Native ESM support is more than loading `.mjs`.
- A real solution must preserve:
  - static `import`
  - dynamic `import()`
  - `package.json` `type`
  - `exports`
  - `imports`
  - `import.meta.url`
  - `createRequire()`
  - mixed ESM/CommonJS interop

Implication:
- Hakobu cannot claim full native ESM support if it only provides a bundling
  workaround or a CommonJS wrapper.

## Workload Findings

### Windows Playwright and Camoufox

- The practical workload that exposed Bun's weakness is the Firefox/Camoufox
  Juggler launch path that relies on custom child-process `stdio`.
- This workload is a strong acceptance test because it exercises real Node
  process semantics rather than a synthetic micro-benchmark.

Implication:
- Windows Playwright/Camoufox should be treated as a release-gate fixture, not
  only as an ad hoc test.

## Bundler Findings

- Rollup, Rolldown, Vite, and similar tools help with prebundling, but they do
  not replace runtime ESM semantics inside the executable.
- Rolldown is a strong optional integration candidate because it aligns with the
  Rollup model while being fast enough for CLI workflows.

Implication:
- Hakobu should support optional bundle mode, but native mode must remain the
  primary contract.

## CI/CD Findings

### GitHub Actions

- GitHub Actions is the cheapest and most practical public OSS CI/CD baseline
  for this project.
- Public repositories can use GitHub-hosted standard runners without the same
  cost pressure as private repositories.
- GitHub Releases fits naturally with patched base binaries and packaged
  artifacts.

Implication:
- Hakobu should standardize on GitHub Actions plus GitHub Releases first, then
  expand to paid runners or self-hosted runners only if the public matrix is not
  enough.

## Naming Findings

- The project brand should not look like a temporary `pkg` patch release.
- `Hakobu` was selected because it fits the product idea of carrying or
  transporting an app inside a packaged executable.
- The chosen logo direction is an open cube.

Implication:
- Use `Hakobu` as the primary OSS identity instead of `pkg-next`, `pkg2`, or a
  direct `yao-pkg` derivative.

