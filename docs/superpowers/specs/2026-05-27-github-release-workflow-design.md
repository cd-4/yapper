# GitHub Release Workflow Design

## Summary

Add a manually-triggered GitHub Actions workflow that builds Yapper for macOS, Windows, and Linux and publishes the artifacts as a draft GitHub Release.

## Trigger

`workflow_dispatch` with a single required input:
- `version` (string, default `0.1.0`) — used as the release tag (`v<version>`) and release name.

## Build Matrix

| Runner | Output artifacts |
|---|---|
| `ubuntu-22.04` | `.AppImage`, `.deb` |
| `windows-latest` | NSIS `.exe`, `.msi` |
| `macos-latest` | Universal `.dmg` (arm64 + x86_64) |

Jobs run in parallel with `fail-fast: false` so a single platform failure doesn't cancel the others.

## Steps (each job)

1. `actions/checkout@v4`
2. `actions/setup-node@v4` — Node 20 with npm cache
3. `dtolnay/rust-toolchain@stable` — macOS job also installs `aarch64-apple-darwin` and `x86_64-apple-darwin` targets
4. Install Linux system deps (Ubuntu only): `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`
5. `npm ci`
6. `tauri-apps/tauri-action@v0` — builds and uploads artifacts to a GitHub Release
   - `tagName`: `v${{ github.event.inputs.version }}`
   - `releaseName`: `Yapper v${{ github.event.inputs.version }}`
   - `releaseDraft: true`
   - `args`: `--target universal-apple-darwin` (macOS only, empty string for others)
   - `env.GITHUB_TOKEN`: `${{ secrets.GITHUB_TOKEN }}` (built-in, no setup required)

## Release Behavior

The action creates a **draft** release on GitHub. After the workflow completes, review the artifacts on the GitHub Releases page and publish manually.

If re-run with the same version tag, the action will update the existing draft.

## Code Signing

Not included. Unsigned builds will trigger macOS Gatekeeper warnings (right-click → Open to bypass) and Windows SmartScreen prompts. Signing can be added later via Tauri's signing config and GitHub secrets.

## Files Created

- `.github/workflows/release.yml`
