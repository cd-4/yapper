<p align="center">
  <img src="YapperLogo.png" alt="Yapper Logo" width="200" />
</p>

<h1 align="center">Yapper</h1>

<p align="center">
  A Git-friendly desktop UI for <a href="https://crates.io/crates/yapitest">yapitest</a> API testing
</p>

<p align="center">
  <a href="https://github.com/cd-4/yapper/releases/latest">
    <img src="https://img.shields.io/github/v/release/cd-4/yapper?style=flat-square&color=blue" alt="Latest Release" />
  </a>
  <a href="https://github.com/cd-4/yapper/actions/workflows/release.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/cd-4/yapper/release.yml?style=flat-square&label=build" alt="Build Status" />
  </a>
  <img src="https://img.shields.io/badge/tauri-2.x-24C8D8?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/svelte-5.x-FF3E00?style=flat-square&logo=svelte&logoColor=white" alt="Svelte 5" />
  <img src="https://img.shields.io/badge/rust-1.80+-CE422B?style=flat-square&logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node >=18" />
  <a href="https://github.com/cd-4/yapper/issues">
    <img src="https://img.shields.io/github/issues/cd-4/yapper?style=flat-square" alt="Open Issues" />
  </a>
</p>

---

## Overview

Yapper is a cross-platform desktop application that provides a visual builder for creating, editing, and running API tests defined in YAML. Tests live as plain files in your repository, making them easy to review, diff, and version alongside your code.

## Features

- **Visual test builder** — compose HTTP request steps without writing YAML by hand
- **YAML-backed** — tests are stored as readable YAML files that diff cleanly in PRs
- **Multi-project support** — open and switch between multiple test directories
- **Config management** — define shared variables, base URLs, and reusable step sets
- **Inline test results** — run tests and see pass/fail with assertion details in the UI
- **Cross-platform** — native binaries for macOS (Universal), Windows, and Linux

## Download

Grab the latest installer for your platform from the [Releases](https://github.com/cd-4/yapper/releases/latest) page.

| Platform | File |
|----------|------|
| macOS (Apple Silicon + Intel) | `.dmg` (Universal) |
| Windows | `.msi` / `.exe` |
| Linux | `.AppImage` / `.deb` |

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://rustup.rs/) (stable)
- On Linux: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`

### Setup

```bash
npm install
```

### Run in dev mode

```bash
npm run tauri:dev
```

### Build

```bash
npm run tauri:build
```

Compiled binaries land in `src-tauri/target/release/bundle/`.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | [Svelte 5](https://svelte.dev) + TypeScript |
| Desktop shell | [Tauri 2](https://tauri.app) |
| Test runner | [yapitest](https://crates.io/crates/yapitest) |
| Build tool | [Vite 6](https://vitejs.dev) |
