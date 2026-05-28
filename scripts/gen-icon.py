from PIL import Image, ImageDraw
import os

src_path = os.path.join(os.path.dirname(__file__), '..', 'public', 'YapperLogoAlpha.png')
out_path = os.path.join(os.path.dirname(__file__), '..', 'src-tauri', 'icons', 'icon-source-1024.png')

src = Image.open(src_path).convert('RGBA')

# Use existing alpha channel, fill all visible pixels with white
pixels = list(src.getdata())
clean = [(255, 255, 255, a) for r, g, b, a in pixels]
src.putdata(clean)

# 1024x1024 purple canvas (#6f4bd8)
SIZE = 1024
canvas = Image.new('RGBA', (SIZE, SIZE), (111, 75, 216, 255))

# Scale logo to 820x820 box, preserving aspect ratio
BOX = 820
ratio = min(BOX / src.width, BOX / src.height)
logo = src.resize((int(src.width * ratio), int(src.height * ratio)), Image.LANCZOS)

# Center on canvas
x = (SIZE - logo.width) // 2
y = (SIZE - logo.height) // 2
canvas.paste(logo, (x, y), logo)

# Rounded corner mask (radius 180px)
mask = Image.new('L', (SIZE, SIZE), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=180, fill=255)

result = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
result.paste(canvas, mask=mask)

result.save(out_path)
print(f'Saved {out_path}')
