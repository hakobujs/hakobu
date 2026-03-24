---
name: Bug Report
about: Report a bug in Hakobu packaging, bundling, or runtime behavior
title: ""
labels: bug
assignees: ""
---

**Hakobu version**: (output of `hakobu --version`)
**Node.js version**: (output of `node --version`)
**Platform**: (e.g., macOS arm64, Ubuntu 22.04 x64, Windows 11 x64)

## Description

A clear description of the bug.

## Steps to Reproduce

1. Create a project with...
2. Run `hakobu ...`
3. Execute the output...

## Expected Behavior

What should happen.

## Actual Behavior

What actually happens. Include the full error output.

## Debug Output

Run with `--debug` and paste the output:

```
hakobu . --debug --output ./dist/app 2>&1
```

## Minimal Reproduction

If possible, provide a minimal project that reproduces the issue.
A `package.json` + entry file is ideal.

## Additional Context

- Bundle mode (`--bundle`)? Yes / No
- Bytecode mode (`--bytecode`)? Yes / No
- Compression (`--compress`)? None / Brotli / GZip
- Target: (e.g., `node24-linux-x64`)
