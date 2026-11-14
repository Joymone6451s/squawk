"""Draws a contact sheet of the finished video: one frame from the middle of every narration line,
with the line's words under it, so each picture can be checked against what is being said.

    python sheet.py <video> <timeline.json written by edit.py> <sheet.jpg>

FFMPEG must point at an ffmpeg binary.
"""
import json
import os
import subprocess
import sys
import tempfile
import textwrap

from PIL import Image, ImageDraw, ImageFont

video, timeline, out = sys.argv[1:4]
FFMPEG = os.environ["FFMPEG"]
lines = json.load(open(timeline, encoding="utf8"))
TW, TH, TEXT_H, COLS, GAP = 480, 270, 92, 4, 6
font = ImageFont.truetype(r"C:\Windows\Fonts\segoeui.ttf", 17)
bold = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 17)
rows = (len(lines) + COLS - 1) // COLS
sheet = Image.new("RGB", (COLS * (TW + GAP) + GAP, rows * (TH + TEXT_H + GAP) + GAP), (20, 20, 24))
draw = ImageDraw.Draw(sheet)
with tempfile.TemporaryDirectory() as tmp:
    for n, line in enumerate(lines):
        at = (line["start"] + line["end"]) / 2
        frame = os.path.join(tmp, f"{n:02d}.png")
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{at:.2f}", "-i", video, "-frames:v", "1", "-vf", f"scale={TW}:{TH}", frame], check=True)
        x = GAP + (n % COLS) * (TW + GAP)
        y = GAP + (n // COLS) * (TH + TEXT_H + GAP)
        with Image.open(frame) as picture:
            sheet.paste(picture.convert("RGB"), (x, y))
        draw.text((x + 4, y + TH + 4), f"{n:02d}  {at:5.1f}s  {line['picture']}", font=bold, fill=(255, 212, 71))
        for k, row in enumerate(textwrap.wrap(line["text"], width=52)[:3]):
            draw.text((x + 4, y + TH + 26 + k * 21), row, font=font, fill=(235, 235, 240))
sheet.save(out, quality=88)
print(f"{len(lines)} frames -> {out}")
