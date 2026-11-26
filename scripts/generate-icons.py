"""Rebuild the committed PNG/ICO icon assets (optional: Python 3 + Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent / "resources"
scale = 2
image = Image.new("RGBA", (1024 * scale, 1024 * scale))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((84, 84, 1964, 1964), radius=440,
                       fill="#eaf3ed", outline="#cfe3d7", width=16)
points = [(235, 735), (235, 310), (335, 310), (465, 565), (595, 310),
          (695, 310), (695, 735), (602, 735), (602, 488), (465, 744),
          (328, 488), (328, 735)]
draw.polygon([(x * scale, y * scale) for x, y in points], fill="#3a8063")
draw.line([(1240, 730), (1580, 390)], fill="#3a8063", width=88)
draw.line([(1344, 390), (1580, 390), (1580, 626)], fill="#3a8063", width=88, joint="curve")
image = image.resize((1024, 1024), Image.Resampling.LANCZOS)
image.save(root / "icon.png")
image.save(root / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
