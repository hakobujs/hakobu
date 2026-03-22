# Windows Authenticode Signing

Hakobu supports Authenticode signing for Windows executables (.exe).
Signed executables display your publisher name in Windows SmartScreen
and UAC dialogs instead of "Unknown Publisher."

## Signing Tiers

| Tier | What happens | When to use |
|------|-------------|-------------|
| **Unsigned** (default) | No signing — SmartScreen may warn "Unknown Publisher" | Local development, internal use |
| **Self-signed** | Signed with a self-issued certificate — SmartScreen still warns | Testing the signing pipeline |
| **Authenticode (OV/EV)** | Signed with a trusted CA certificate — SmartScreen trusts immediately (EV) or after reputation builds (OV) | Public distribution |

## Quick Start

### Sign with a PFX certificate

```bash
hakobu ./my-app --target node24-win-x64 --output ./dist/app.exe \
  --win-cert ./certs/my-cert.pfx --win-cert-password "secret"
```

Or set env vars:

```bash
export HAKOBU_WIN_CERT="./certs/my-cert.pfx"
export HAKOBU_WIN_CERT_PASSWORD="secret"
hakobu ./my-app --target node24-win-x64 --output ./dist/app.exe
```

## How It Works

When `HAKOBU_WIN_CERT` (or `--win-cert`) is set, Hakobu signs the
produced `.exe` after packaging. It tries two tools in order:

1. **signtool.exe** — Windows SDK tool (available on Windows, GitHub
   Actions windows-latest runners)
2. **osslsigncode** — cross-platform alternative (available via
   `brew install osslsigncode`, `apt install osslsigncode`, or
   `choco install osslsigncode`)

Both tools produce identical Authenticode signatures. Use whichever is
available in your environment.

Signing parameters:
- **Hash algorithm**: SHA-256
- **Timestamp**: RFC 3161 via DigiCert (default), configurable
- **Certificate format**: PKCS#12 (.pfx / .p12)

## Prerequisites

### Code Signing Certificate

You need an Authenticode code signing certificate from a trusted CA:

| Type | SmartScreen behavior | Cost | Providers |
|------|---------------------|------|-----------|
| **OV (Organization Validation)** | Builds reputation over time | ~$200-400/year | DigiCert, Sectigo, GlobalSign |
| **EV (Extended Validation)** | Immediate trust, no reputation period | ~$400-700/year | DigiCert, Sectigo, GlobalSign |

For open source projects, [SignPath Foundation](https://signpath.org/)
offers free EV signing for qualifying projects.

### Export as PFX

Your certificate must be in PKCS#12 format (.pfx or .p12), containing
both the certificate chain and private key.

**From Windows certificate store:**
```powershell
# Find your certificate
Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert

# Export to PFX
$cert = Get-ChildItem Cert:\CurrentUser\My\THUMBPRINT
$password = ConvertTo-SecureString -String "export-password" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath cert.pfx -Password $password
```

**From a CA-issued .crt + .key:**
```bash
openssl pkcs12 -export -out cert.pfx \
  -inkey private.key -in certificate.crt -certfile ca-chain.crt
```

### Signing Tool

**On Windows (GitHub Actions windows-latest):**
signtool.exe is pre-installed via Windows SDK.

**On macOS/Linux (cross-signing):**
```bash
# macOS
brew install osslsigncode

# Ubuntu/Debian
apt install osslsigncode

# Or build from source: https://github.com/mtrojnar/osslsigncode
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HAKOBU_WIN_CERT` | Yes (for signing) | Path to .pfx/.p12 certificate file |
| `HAKOBU_WIN_CERT_PASSWORD` | If cert is password-protected | Certificate password |
| `HAKOBU_WIN_TIMESTAMP_URL` | No | Timestamp server (default: `http://timestamp.digicert.com`) |

## CLI Flags

| Flag | Description |
|------|-------------|
| `--win-cert <path>` | Path to .pfx/.p12 certificate (overrides `HAKOBU_WIN_CERT`) |
| `--win-cert-password <pw>` | Certificate password (overrides `HAKOBU_WIN_CERT_PASSWORD`) |

## CI/CD Setup (GitHub Actions)

### Secrets

Add to your repository (Settings → Secrets and variables → Actions):

```
WIN_CERT_BASE64       # Base64-encoded .pfx file
WIN_CERT_PASSWORD     # PFX password
```

To encode your certificate:
```bash
base64 -i cert.pfx | tr -d '\n' > cert-base64.txt
# Copy contents of cert-base64.txt to the GitHub secret
```

### Workflow Example

```yaml
- name: Decode signing certificate
  if: runner.os == 'Windows'
  run: |
    echo "${{ secrets.WIN_CERT_BASE64 }}" > cert-base64.txt
    certutil -decode cert-base64.txt cert.pfx
    del cert-base64.txt
  shell: cmd

- name: Package and sign
  if: runner.os == 'Windows'
  env:
    HAKOBU_WIN_CERT: cert.pfx
    HAKOBU_WIN_CERT_PASSWORD: ${{ secrets.WIN_CERT_PASSWORD }}
  run: npx hakobu ./my-app --target node24-win-x64 --output ./dist/app.exe

- name: Clean up certificate
  if: always() && runner.os == 'Windows'
  run: del cert.pfx
  shell: cmd
```

### Cross-signing from macOS/Linux

You can sign Windows executables from macOS or Linux using osslsigncode:

```yaml
- name: Install osslsigncode
  run: |
    if [[ "$RUNNER_OS" == "macOS" ]]; then
      brew install osslsigncode
    else
      sudo apt-get install -y osslsigncode
    fi

- name: Decode certificate
  run: echo "${{ secrets.WIN_CERT_BASE64 }}" | base64 -d > cert.pfx

- name: Package and sign
  env:
    HAKOBU_WIN_CERT: cert.pfx
    HAKOBU_WIN_CERT_PASSWORD: ${{ secrets.WIN_CERT_PASSWORD }}
  run: npx hakobu ./my-app --target node24-win-x64 --output ./dist/app.exe

- name: Clean up
  if: always()
  run: rm -f cert.pfx
```

## Behavior When Credentials Are Absent

| Scenario | Behavior |
|----------|----------|
| No `HAKOBU_WIN_CERT` and no `--win-cert` | Unsigned executable (default, always works) |
| Certificate set but signing tool missing | Error with instructions to install signtool or osslsigncode |
| Certificate set but password wrong | Error from signing tool with diagnostic message |
| Non-Windows target with `--win-cert` | Flag is ignored (Authenticode is Windows-only) |

## Timestamp Servers

Timestamps prove the executable was signed while the certificate was
valid. The default server is DigiCert's:

```
http://timestamp.digicert.com
```

Alternatives:
```
http://timestamp.sectigo.com
http://timestamp.globalsign.com/tsa/r6advanced1
http://ts.ssl.com
```

Override with `HAKOBU_WIN_TIMESTAMP_URL`.

## Troubleshooting

### "SignTool Error: No certificates were found"

The .pfx file doesn't contain a valid code signing certificate, or the
password is wrong. Re-export the certificate and verify it works:

```powershell
signtool sign /f cert.pfx /p "password" /fd SHA256 test.exe
```

### "osslsigncode: PKCS12 error"

Wrong password or corrupt .pfx file. Verify with:

```bash
openssl pkcs12 -in cert.pfx -nokeys -info
```

### SmartScreen still shows "Unknown Publisher"

- **OV certificates** need to build reputation. Sign consistently and
  the warning will disappear over time.
- **EV certificates** are trusted immediately.
- Ensure the timestamp is included — unsigned timestamps cause warnings
  after certificate expiry.

### Verifying a signed executable

```powershell
# PowerShell
Get-AuthenticodeSignature .\app.exe

# signtool
signtool verify /pa /v .\app.exe
```

On macOS/Linux with osslsigncode:
```bash
osslsigncode verify -in app.exe
```
