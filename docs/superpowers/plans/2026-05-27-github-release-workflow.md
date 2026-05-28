# GitHub Release Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manually-triggered GitHub Actions workflow that builds Yapper for macOS (universal), Windows, and Linux and publishes artifacts as a draft GitHub Release.

**Architecture:** A single workflow file with a 3-platform matrix. Each job installs platform dependencies, builds via `tauri-apps/tauri-action@v0`, and uploads artifacts to a shared draft GitHub Release keyed on the version input. The `GITHUB_TOKEN` secret is built-in — no extra secrets needed.

**Tech Stack:** GitHub Actions, `tauri-apps/tauri-action@v0`, `dtolnay/rust-toolchain@stable`, Node 20, Rust stable, `npm ci`.

---

### Task 1: Create the release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the directory and write the workflow file**

```bash
mkdir -p /Users/charliedudzik/repos/yapper/.github/workflows
```

Then create `.github/workflows/release.yml` with this exact content:

```yaml
name: Release

on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Release version (e.g. 0.1.0)'
        required: true
        default: '0.1.0'

jobs:
  release:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: ubuntu-22.04
            args: ''
          - platform: windows-latest
            args: ''
          - platform: macos-latest
            args: '--target universal-apple-darwin'

    runs-on: ${{ matrix.platform }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install Rust stable
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: Install Linux system dependencies
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

      - name: Install frontend dependencies
        run: npm ci

      - name: Build and release
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: v${{ inputs.version }}
          releaseName: 'Yapper v${{ inputs.version }}'
          releaseDraft: true
          prerelease: false
          args: ${{ matrix.args }}
```

- [ ] **Step 2: Validate YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('/Users/charliedudzik/repos/yapper/.github/workflows/release.yml')); print('YAML valid')"
```

Expected output: `YAML valid`

---

### Task 2: Manual verification (after pushing to GitHub)

- [ ] **Step 1: Push the branch and go to GitHub Actions**

Navigate to your repo on GitHub → Actions tab → "Release" workflow → "Run workflow".

- [ ] **Step 2: Enter a version and trigger**

Enter `0.1.0` (or any test version) and click "Run workflow".

- [ ] **Step 3: Verify all three jobs succeed**

All three matrix jobs (ubuntu, windows, macos) should go green. Expected duration: ~15–25 minutes.

- [ ] **Step 4: Verify draft release is created**

Go to GitHub → Releases. A draft release `Yapper v0.1.0` should exist with 4–6 assets:
  - Linux: `.AppImage`, `.deb`
  - Windows: `.exe` (NSIS installer), `.msi`
  - macOS: `.dmg` (universal)

- [ ] **Step 5: Publish the release**

Click "Edit" on the draft, review the assets, then click "Publish release" when ready.
