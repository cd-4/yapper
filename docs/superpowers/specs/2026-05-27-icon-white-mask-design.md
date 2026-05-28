# Icon White Mask Design

## Change

In `scripts/gen-icon.py`, after removing the white background, convert all remaining opaque pixels to white `(255, 255, 255, a)` instead of keeping their original color. This produces a white logo silhouette on the purple background.

Re-run `scripts/gen-icon.py` and `npm run tauri -- icon` to regenerate all platform variants from the updated source.

## Files Changed

- `scripts/gen-icon.py` — pixel conversion logic updated
- `src-tauri/icons/icon-source-1024.png` — regenerated
- `src-tauri/icons/` — all platform variants regenerated
