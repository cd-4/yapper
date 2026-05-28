# App Icon Fix Design

## Problem

`src-tauri/icons/icon.png` is 843×632 (non-square), causing the icon to be squashed horizontally in every platform's square icon slot. The `.ico` contains only a 32×32 image (too small for Windows). There is no `.icns` file for macOS.

## Fix

### Step 1: Generate 1024×1024 source PNG (Python/Pillow)

File: `src-tauri/icons/icon-source-1024.png`

1. Load `src-tauri/icons/icon.png` (843×632, RGBA)
2. Remove white background: pixels where R>240, G>240, B>240 → fully transparent
3. Create a 1024×1024 RGBA canvas filled with `#6f4bd8` (the app's `--accent-strong` purple)
4. Scale the logo to fit within an 820×820 box (80% fill), preserving aspect ratio
5. Center-paste the logo onto the canvas
6. Apply a rounded rectangle mask with radius 180px to clip the canvas corners to transparent
7. Save as `src-tauri/icons/icon-source-1024.png`

### Step 2: Generate platform icon variants

Run:
```
npm run tauri -- icon src-tauri/icons/icon-source-1024.png
```

This generates in `src-tauri/icons/`:
- `32x32.png` — Linux/general small
- `128x128.png` — Linux/general medium
- `128x128@2x.png` — Linux/general retina
- `icon.icns` — macOS (macOS applies its own rounded square mask on top)
- `icon.ico` — Windows multi-resolution (16, 32, 48, 64, 128, 256px)

### Step 3: Update tauri.conf.json

Replace the current icon array:
```json
"icon": ["icons/icon.png", "icons/icon.ico"]
```
With:
```json
"icon": [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.icns",
  "icons/icon.ico"
]
```

## Files Changed

- `src-tauri/icons/icon-source-1024.png` — new source (kept for future edits)
- `src-tauri/icons/32x32.png` — generated
- `src-tauri/icons/128x128.png` — generated
- `src-tauri/icons/128x128@2x.png` — generated
- `src-tauri/icons/icon.icns` — generated
- `src-tauri/icons/icon.ico` — regenerated (multi-resolution)
- `src-tauri/tauri.conf.json` — icon array updated
