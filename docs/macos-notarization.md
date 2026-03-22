# macOS Notarization

Hakobu supports Apple notarization for macOS executables. Notarization
lets your packaged app run without Gatekeeper warnings on end-user machines.

## Signing Tiers

| Tier | What happens | When to use |
|------|-------------|-------------|
| **Ad-hoc** (default) | `codesign --sign -` — executable runs on the build machine and can be distributed to users who right-click → Open | Local development, CI fixtures |
| **Developer ID** | `codesign --sign "Developer ID Application: ..."` with hardened runtime | Internal distribution, pre-notarization |
| **Notarized** | Developer ID signed + Apple notary ticket stapled | Public distribution |

## Quick Start

### 1. Sign with Developer ID

```bash
hakobu ./my-app --output ./dist/app \
  --sign-identity "Developer ID Application: Your Name (TEAMID)"
```

Or set the env var once:

```bash
export HAKOBU_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
hakobu ./my-app --output ./dist/app
```

### 2. Sign and Notarize

```bash
export HAKOBU_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export HAKOBU_APPLE_ID="you@example.com"
export HAKOBU_APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # app-specific password
export HAKOBU_APPLE_TEAM_ID="ABCDE12345"

hakobu ./my-app --output ./dist/app --notarize
```

This will:
1. Package the executable
2. Sign with your Developer ID identity (hardened runtime + secure timestamp)
3. Submit to Apple's notary service
4. Wait for approval (typically 1-5 minutes)
5. Staple the notarization ticket to the executable

## Prerequisites

### Apple Developer Account

You need an [Apple Developer Program](https://developer.apple.com/programs/)
membership ($99/year). Free accounts cannot notarize.

### Developer ID Certificate

1. Open Keychain Access → Certificate Assistant → Request a Certificate
2. In [Apple Developer portal](https://developer.apple.com/account/resources/certificates/list),
   create a **Developer ID Application** certificate
3. Download and install it in your Keychain
4. Verify it's available:
   ```bash
   security find-identity -v -p codesigning
   ```
   You should see something like:
   ```
   1) ABCDEF... "Developer ID Application: Your Name (TEAMID)"
   ```

### App-Specific Password

Apple notarization requires an app-specific password (not your regular
Apple ID password):

1. Go to [appleid.apple.com](https://appleid.apple.com/account/manage)
2. Sign in → Security → App-Specific Passwords → Generate
3. Save the password — you'll need it for `HAKOBU_APPLE_PASSWORD`

## Environment Variables

| Variable | Required for | Description |
|----------|-------------|-------------|
| `HAKOBU_SIGN_IDENTITY` | Developer ID signing | Full identity string from `security find-identity` |
| `HAKOBU_APPLE_ID` | Notarization | Apple ID email address |
| `HAKOBU_APPLE_PASSWORD` | Notarization | App-specific password |
| `HAKOBU_APPLE_TEAM_ID` | Notarization | 10-character Team ID from Apple Developer portal |

## CLI Flags

| Flag | Description |
|------|-------------|
| `--sign-identity <id>` | Code-signing identity (overrides `HAKOBU_SIGN_IDENTITY`) |
| `--notarize` | Submit to Apple notarization after signing |

## CI/CD Setup (GitHub Actions)

Add secrets to your repository:

```yaml
# Repository Settings → Secrets and variables → Actions
APPLE_DEVELOPER_ID_P12       # Base64-encoded .p12 certificate
APPLE_DEVELOPER_ID_PASSWORD  # Password for the .p12
APPLE_ID                     # Apple ID email
APPLE_APP_SPECIFIC_PASSWORD  # App-specific password
APPLE_TEAM_ID                # Team ID
```

Example workflow step:

```yaml
- name: Install signing certificate
  env:
    P12_BASE64: ${{ secrets.APPLE_DEVELOPER_ID_P12 }}
    P12_PASSWORD: ${{ secrets.APPLE_DEVELOPER_ID_PASSWORD }}
  run: |
    echo "$P12_BASE64" | base64 --decode > cert.p12
    security create-keychain -p "" build.keychain
    security default-keychain -s build.keychain
    security unlock-keychain -p "" build.keychain
    security import cert.p12 -k build.keychain -P "$P12_PASSWORD" -T /usr/bin/codesign
    security set-key-partition-list -S apple-tool:,apple: -s -k "" build.keychain
    rm cert.p12

- name: Package and notarize
  env:
    HAKOBU_SIGN_IDENTITY: "Developer ID Application: Your Name (TEAMID)"
    HAKOBU_APPLE_ID: ${{ secrets.APPLE_ID }}
    HAKOBU_APPLE_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
    HAKOBU_APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
  run: |
    npx hakobu ./my-app --output ./dist/app --notarize
```

## Behavior When Credentials Are Absent

| Scenario | Behavior |
|----------|----------|
| No signing identity | Ad-hoc signing (default, always works) |
| `--sign-identity` but no `--notarize` | Developer ID signed, not notarized |
| `--notarize` without credentials | Error with message listing missing env vars |
| Non-macOS target with `--notarize` | Flag is ignored (notarization is macOS-only) |

## Troubleshooting

### "The signature of the binary is invalid"

The `__LINKEDIT` segment must be patched correctly before signing. Hakobu
does this automatically. If you see this error, the Mach-O patching may
have failed — file a bug.

### "Unable to sign the macOS executable"

Ensure `codesign` is available (Xcode Command Line Tools). On CI runners
without Xcode, install with:

```bash
xcode-select --install
```

### Notarization rejected

Run the notarytool log command shown in the error output to see Apple's
rejection reasons. Common issues:

- Missing hardened runtime (`--options runtime`) — Hakobu adds this
  automatically when using a Developer ID identity
- Unsigned embedded frameworks — not applicable for Hakobu executables
- Network issues during submission — retry

### Checking notarization status manually

```bash
xcrun notarytool history --apple-id EMAIL --password PASS --team-id TEAM
xcrun notarytool log SUBMISSION_ID --apple-id EMAIL --password PASS --team-id TEAM
```

### Verifying a notarized executable

```bash
# Check signature
codesign -dv --verbose=4 ./my-app

# Check notarization ticket
xcrun stapler validate ./my-app

# Check Gatekeeper assessment
spctl --assess --type execute -vv ./my-app
```
