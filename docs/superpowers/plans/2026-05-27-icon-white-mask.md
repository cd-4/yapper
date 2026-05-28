# Icon White Mask Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the icon generation script so the logo appears as a white silhouette on the purple background, then regenerate all platform icon variants.

**Architecture:** One line changes in `scripts/gen-icon.py` — after stripping the white background, remaining opaque pixels are remapped to white instead of keeping their original color. The script is re-run and `tauri icon` regenerates all variants.

**Tech Stack:** Python 3 + Pillow, Tauri CLI (`npm run tauri`).

---

### Task 1: Update gen-icon.py and regenerate icons

**Files:**
- Modify: `scripts/gen-icon.py`
- Modify: `src-tauri/icons/icon-source-1024.png` (regenerated)
- Modify: `src-tauri/icons/` (all platform variants regenerated)

- [ ] **Step 1: Update the pixel conversion in gen-icon.py**

In `scripts/gen-icon.py`, find:

```python
clean = [(r, g, b, 0) if r > 240 and g > 240 and b > 240 else (r, g, b, a)
         for r, g, b, a in pixels]
```

Replace with:

```python
clean = [(r, g, b, 0) if r > 240 and g > 240 and b > 240 else (255, 255, 255, a)
         for r, g, b, a in pixels]
```

- [ ] **Step 2: Re-run the generation script**

```bash
python3 /Users/charliedudzik/repos/yapper/scripts/gen-icon.py
```

Expected output:
```
Saved .../src-tauri/icons/icon-source-1024.png
```

- [ ] **Step 3: Verify the source PNG — logo pixels should now be white**

```bash
python3 -c "
from PIL import Image
img = Image.open('/Users/charliedudzik/repos/yapper/src-tauri/icons/icon-source-1024.png')
print(f'Corner alpha: {img.getpixel((0, 0))[3]} (expect 0)')
print(f'Center pixel: {img.getpixel((512, 512))} (expect white or purple, not black)')
"
```

Expected: center pixel is either `(255, 255, 255, 255)` (white logo) or `(111, 75, 216, 255)` (purple background where no logo content falls).

- [ ] **Step 4: Regenerate all platform variants**

```bash
cd /Users/charliedudzik/repos/yapper && npm run tauri -- icon src-tauri/icons/icon-source-1024.png
```

Expected: same output as before — ICNS, ICO, PNGs, Windows Store assets all generated with no errors.

- [ ] **Step 5: Visual check**

```bash
python3 -c "
from PIL import Image
img = Image.open('/Users/charliedudzik/repos/yapper/src-tauri/icons/icon-source-1024.png')
img.save('/tmp/icon-preview.png')
print('Saved preview to /tmp/icon-preview.png')
"
open /tmp/icon-preview.png
```

Confirm the icon shows a white logo silhouette on a purple background with rounded corners.
