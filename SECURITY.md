# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x     | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in Hakobu, please report it
responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please report vulnerabilities via:

1. GitHub's private vulnerability reporting feature:
   [Report a vulnerability](https://github.com/hakobujs/hakobu/security/advisories/new)

2. Or email the maintainers directly (see repository contact info)

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

### Response Timeline

- **Acknowledgment**: within 48 hours
- **Initial assessment**: within 7 days
- **Fix or mitigation**: depends on severity, typically within 30 days

### Scope

The following are in scope:

- Hakobu CLI and programmatic API (`@hakobu/hakobu`)
- Patched Node binary manager (`@hakobu/hakobu-fetch`)
- Snapshot filesystem runtime (prelude/bootstrap)
- Base binary build pipeline and patches

The following are out of scope:

- Vulnerabilities in upstream Node.js (report to Node.js project)
- Vulnerabilities in bundled dependencies (report to the dependency)
- Issues that require physical access to the build machine

## Security Considerations

Hakobu packages Node.js source code into standalone executables. Users should
be aware that:

- **Source code is embedded** in the executable snapshot. Without bytecode
  mode, source is recoverable with effort. Do not rely on packaging alone
  for source protection.
- **Base binaries are patched Node.js builds**. Hakobu publishes SHA-256
  checksums for all base binaries. Verify checksums when fetching base
  binaries in sensitive environments.
- **Signing and notarization** are supported for macOS and Windows. Use
  them for distribution to end users.
