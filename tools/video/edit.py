"""Builds the demo video: footage matched to the narration line by line, labels, cards and captions.

    python edit.py <footage folder> <voice folder> <work folder> <out.mp4>

The footage folder holds raw.webm and marks.json from film.mjs. The voice folder holds the wav
files and index.json from voice.py. FFMPEG must point at an ffmpeg binary.

Set CARDS_ONLY=1 to draw the cards and one sample caption into the work folder and stop, so they
can be looked at before a full render.
"""
import json
import os
import subprocess
import sys
import textwrap

import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from script import LABELS, SHOT_ORDER  # noqa: E402

FOOT, VOICE, WORK, OUT = sys.argv[1:5]
FFMPEG = os.environ["FFMPEG"]
os.makedirs(WORK, exist_ok=True)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)

SR = 24000
FPS = 30
LEAD = 0.3
W, H = 1920, 1080
REG = r"C:\Windows\Fonts\segoeui.ttf"
SEMI = r"C:\Windows\Fonts\seguisb.ttf"
BOLD = r"C:\Windows\Fonts\segoeuib.ttf"
MONO = r"C:\Windows\Fonts\consola.ttf"
CAPTION = ImageFont.truetype(SEMI, 46)
CHIP = ImageFont.truetype(BOLD, 40)

# The page's own colours, so the cards belong to it.
PAPER = (255, 248, 230)
INK = (27, 27, 31)
SOFT = (85, 88, 106)
GREEN = (18, 163, 109)
GREEN_SOFT = (223, 246, 234)
YELLOW = (255, 212, 71)
CORAL = (255, 107, 53)
WHITE = (255, 255, 255)

CARDS_ONLY = os.environ.get("CARDS_ONLY") == "1"
marks = json.load(open(os.path.join(FOOT, "marks.json"))) if not CARDS_ONLY else {}
lines = json.load(open(os.path.join(VOICE, "index.json"))) if not CARDS_ONLY else []
RAW = os.path.join(FOOT, "raw.webm")


def m(name, offset=0.0):
    return max(0.0, marks[name] + offset)


# The footage sits in a frame drawn like the page's own cards, a black outline and an offset
# shadow, with a band of its own below for the captions. The page shows its confirmations
# ("Fed! 0.062 NEAR was just sent to Maya") at the bottom, where captions would cover them.
FX, FY, FW, FH = 192, 20, 1536, 864
EDGE, SHADOW = 5, 10
BAND_TOP = FY + FH + EDGE + SHADOW
FRAME = ",".join([
    f"pad={W}:{H}:{FX}:{FY}:color=0xFFF8E6",
    f"drawbox=x={FX - EDGE}:y={FY - EDGE}:w={FW + 2 * EDGE}:h={FH + 2 * EDGE}:color=0x1B1B1F:t={EDGE}",
    f"drawbox=x={FX + FW + EDGE}:y={FY - EDGE + SHADOW}:w={SHADOW}:h={FH + 2 * EDGE}:color=0x1B1B1F:t=fill",
    f"drawbox=x={FX - EDGE + SHADOW}:y={FY + FH + EDGE}:w={FW + 2 * EDGE}:h={SHADOW}:color=0x1B1B1F:t=fill",
])
FULL = f"scale={FW}:{FH}:flags=lanczos,{FRAME}"


def zoom(x, y, w):
    """Crops a 16:9 window of the 1600x900 footage, `w` wide with its corner at (x, y), and fills the frame with it."""
    return f"crop={w}:{w * 9 // 16}:{x}:{y},scale={FW}:{FH}:flags=lanczos,{FRAME}"


def pictures():
    # The offsets were tuned by looking at frames of the take filmed on 2026-11-11: the bake shot
    # runs until the new cracker count shows, the pick shot opens as Maya's post appears, the
    # dialog shot opens once the amount is fully typed, and the pile shot catches the second pile.
    # The streak zoom frames the round card alone, clear of Polly's speech bubble on its left.
    return {
        "hook": ("video", m("hook_start"), None),
        "bake": ("video", m("bake_click", -1.2), None),
        "feedpick": ("video", m("feed_dialog", -7.0), None),
        "feeddialog": ("video", m("feed_dialog"), None),
        "feeddone": ("video", m("feed_done", -0.4), None),
        "pile": ("video", m("pile_two", -1.2), None),
        "pilefull": ("video", m("full", -0.8), None),
        "countdown": ("video", m("countdown", -0.5), None),
        "asleep": ("video", m("asleep", -1.0), None),
        "wakeclick": ("video", m("wake_click", -2.2), None),
        "squawking": ("video", m("squawk", -0.4), None),
        "said": ("video", m("said_start"), None),
        "streak": ("video", m("streak_start"), zoom(642, 118, 812)),
        "books": ("video", m("books_start"), None),
        "keys": ("video", m("keys_start"), None),
        "end": ("video", m("end_start"), None),
    }


def run(args):
    result = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *args], capture_output=True, text=True)
    if result.returncode:
        raise SystemExit(result.stderr[-1800:])


def caption_png(text, path):
    image = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    wrapped = textwrap.wrap(text, width=58)
    if len(wrapped) > 2:
        raise SystemExit(f"caption too long for the band below the footage: {text}")
    boxes = [draw.textbbox((0, 0), l, font=CAPTION) for l in wrapped]
    width = max(b[2] - b[0] for b in boxes)
    line_h = 62
    box_h = line_h * len(wrapped) + 40
    x0 = (W - width) // 2 - 36
    y0 = BAND_TOP + (H - BAND_TOP - box_h) // 2
    draw.rounded_rectangle([x0, y0, x0 + width + 72, y0 + box_h], radius=22, fill=(27, 27, 31, 232))
    y = y0 + 16
    for l, b in zip(wrapped, boxes):
        draw.text(((W - (b[2] - b[0])) // 2 - b[0], y), l, font=CAPTION, fill=WHITE + (255,))
        y += line_h
    image.save(path)


def chip_png(text, path):
    """The small label at the top of the screen that says which part this is."""
    image = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    box = draw.textbbox((0, 0), text, font=CHIP)
    w = box[2] - box[0]
    x0 = W // 2 - w // 2 - 40
    top = 22
    draw.rounded_rectangle([x0 + 5, top + 5, x0 + w + 85, top + 85], radius=40, fill=INK + (255,))
    draw.rounded_rectangle([x0, top, x0 + w + 80, top + 80], radius=40, fill=YELLOW + (255,), outline=INK + (255,), width=4)
    draw.text((W // 2 - w // 2 - box[0], top + 38 - (box[1] + box[3]) // 2), text, font=CHIP, fill=INK + (255,))
    image.save(path)


def card(path, title, rows, note=None):
    """A plain full-screen card. `rows` are (left words, right words, colour of the right words)."""
    image = Image.new("RGB", (W, H), PAPER)
    draw = ImageDraw.Draw(image)
    title_font = ImageFont.truetype(BOLD, 66)
    left_font = ImageFont.truetype(REG, 52)
    right_font = ImageFont.truetype(BOLD, 60)
    box = draw.textbbox((0, 0), title, font=title_font)
    draw.text(((W - (box[2] - box[0])) // 2, 120), title, font=title_font, fill=INK)
    y = 300
    for left, right, colour in rows:
        draw.rounded_rectangle([216, y - 20, 1716, y + 110], radius=28, fill=INK)
        draw.rounded_rectangle([210, y - 26, 1710, y + 104], radius=28, fill=WHITE, outline=INK, width=5)
        b = draw.textbbox((0, 0), left, font=left_font)
        draw.text((262, y + 39 - (b[1] + b[3]) // 2), left, font=left_font, fill=SOFT)
        b = draw.textbbox((0, 0), right, font=right_font)
        draw.text((1658 - (b[2] - b[0]), y + 39 - (b[1] + b[3]) // 2), right, font=right_font, fill=colour)
        y += 170
    if note:
        font = ImageFont.truetype(BOLD, 54)
        b = draw.textbbox((0, 0), note, font=font)
        draw.text(((W - (b[2] - b[0])) // 2, y + 10), note, font=font, fill=CORAL)
    image.save(path)


def code_card(path, title, code, note):
    """A card that shows a few lines of code, for the reusable near.social writer."""
    image = Image.new("RGB", (W, H), PAPER)
    draw = ImageDraw.Draw(image)
    title_font = ImageFont.truetype(BOLD, 62)
    box = draw.textbbox((0, 0), title, font=title_font)
    draw.text(((W - (box[2] - box[0])) // 2, 110), title, font=title_font, fill=INK)
    mono = ImageFont.truetype(MONO, 44)
    rows = code.split("\n")
    height = 70 * len(rows) + 80
    top = 270
    draw.rounded_rectangle([196, top + 6, 1736, top + height + 6], radius=28, fill=INK)
    draw.rounded_rectangle([190, top, 1730, top + height], radius=28, fill=(33, 37, 48), outline=INK, width=5)
    y = top + 40
    for row in rows:
        draw.text((250, y), row, font=mono, fill=(214, 255, 232) if not row.strip().startswith("//") else (150, 160, 180))
        y += 70
    font = ImageFont.truetype(SEMI, 48)
    b = draw.textbbox((0, 0), note, font=font)
    draw.text(((W - (b[2] - b[0])) // 2, top + height + 60), note, font=font, fill=SOFT)
    image.save(path)


IMAGES = {}
example = os.path.join(WORK, "card_example.png")
card(example, "For example", [
    ("You feed", "100 crackers", INK),
    ("The author gets", "0.075 NEAR", GREEN),
    ("Polly keeps", "0.025 NEAR", INK),
])
IMAGES["cardexample"] = example
WHY = [
    ("Authors", "get paid for good posts", GREEN),
    ("Fans", "decide what gets heard", INK),
    ("The early bird", "earns NEAR for waking her", CORAL),
]
for stage in range(1, 4):
    path = os.path.join(WORK, f"card_why{stage}.png")
    card(path, "Why people join in", WHY[:stage])
    IMAGES[f"cardwhy{stage}"] = path
tool = os.path.join(WORK, "card_tool.png")
code_card(
    tool,
    "Her voice is a free tool",
    "// inside any NEAR smart contract\nBatch::new()\n    .post(now_ms, \"gm from a contract\")\n    .follow(&alice)\n    .send(&social);",
    "One small file. No keys, no server. MIT license.",
)
IMAGES["cardtool"] = tool

if CARDS_ONLY:
    caption_png("The crackers get eaten. But most of the NEAR inside them goes straight to the author, right away.", os.path.join(WORK, "caption_test.png"))
    chip_png("2. Feed a post", os.path.join(WORK, "chip_test.png"))
    print("cards drawn in", WORK)
    raise SystemExit(0)

PICTURES = pictures()


def shot_timeline():
    out = {}
    for shot in SHOT_ORDER:
        items = [l for l in lines if l["shot"] == shot]
        t = LEAD
        placed = []
        for i, l in enumerate(items):
            audio, rate = sf.read(l["file"], dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            if rate != SR:
                raise SystemExit(f"unexpected sample rate {rate}")
            seconds = len(audio) / SR
            picture = f"cardwhy{i + 1}" if shot == "why" else l["picture"]
            placed.append({"start": t, "end": t + seconds, "audio": audio, "text": l["text"], "picture": picture})
            t += seconds + l["gap"]
        out[shot] = {"lines": placed, "duration": t + 0.1}
    return out


def groups(info):
    """Runs of lines that share a picture, each with how long that picture stays up."""
    out = []
    for line in info["lines"]:
        if out and out[-1]["picture"] == line["picture"]:
            continue
        out.append({"picture": line["picture"], "at": 0.0 if not out else line["start"]})
    for i, g in enumerate(out):
        g["length"] = (out[i + 1]["at"] if i + 1 < len(out) else info["duration"]) - g["at"]
    return out


def render_shot(index, shot, info):
    d = info["duration"]
    cuts = groups(info)
    args, chains, sources = [], [], {}
    count = 0
    for cut in cuts:
        name = cut["picture"]
        key = IMAGES.get(name, RAW)
        if key not in sources:
            if name in IMAGES:
                args += ["-loop", "1", "-framerate", str(FPS), "-t", f"{d + 1:.2f}"]
            args += ["-i", key]
            sources[key] = count
            count += 1
    for i, cut in enumerate(cuts):
        name = cut["picture"]
        if name in IMAGES:
            n = sources[IMAGES[name]]
            chains.append(f"[{n}:v]trim=duration={cut['length']:.3f},setpts=PTS-STARTPTS,fps={FPS},setsar=1,format=yuv420p[p{i}]")
        else:
            _, start, frame = PICTURES[name]
            n = sources[RAW]
            chains.append(f"[{n}:v]trim=start={start:.3f}:duration={cut['length']:.3f},setpts=PTS-STARTPTS,fps={FPS},{frame or FULL},setsar=1,format=yuv420p[p{i}]")
    joined = "".join(f"[p{i}]" for i in range(len(cuts)))
    chains.append(f"{joined}concat=n={len(cuts)}:v=1:a=0,tpad=stop_mode=clone:stop_duration=8,trim=duration={d:.3f},setpts=PTS-STARTPTS,fade=t=in:st=0:d=0.28,fade=t=out:st={max(0.0, d - 0.28):.3f}:d=0.28[v0]")
    last = "v0"
    step = 0
    if shot in LABELS:
        path = os.path.join(WORK, f"chip_{index:02d}.png")
        chip_png(LABELS[shot], path)
        args += ["-i", path]
        chains.append(f"[{last}][{count}:v]overlay=0:0[s{step}]")
        last = f"s{step}"
        step += 1
        count += 1
    for n, line in enumerate(info["lines"]):
        path = os.path.join(WORK, f"cap_{index:02d}_{n:02d}.png")
        caption_png(line["text"], path)
        args += ["-i", path]
        chains.append(f"[{last}][{count}:v]overlay=0:0:enable='between(t,{line['start'] - 0.05:.3f},{line['end'] + 0.12:.3f})'[s{step}]")
        last = f"s{step}"
        step += 1
        count += 1
    target = os.path.join(WORK, f"shot_{index:02d}_{shot}.mp4")
    run([*args, "-filter_complex", ";".join(chains), "-map", f"[{last}]", "-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", target])
    return target


timeline = shot_timeline()
total = sum(info["duration"] for info in timeline.values())
track = np.zeros(int((total + 0.5) * SR), dtype=np.float32)
cursor = 0.0
files, report, spoken = [], [], []
for index, shot in enumerate(SHOT_ORDER):
    info = timeline[shot]
    files.append(render_shot(index, shot, info))
    for line in info["lines"]:
        start = int((cursor + line["start"]) * SR)
        track[start:start + len(line["audio"])] += line["audio"]
        spoken.append({"shot": shot, "picture": line["picture"], "text": line["text"], "start": round(cursor + line["start"], 2), "end": round(cursor + line["end"], 2)})
    report.append(f"{shot:8s} {cursor:6.1f}s  {info['duration']:5.1f}s")
    cursor += info["duration"]

# Where each line lands in the finished video, for sheet.py to check pictures against words.
with open(os.path.join(WORK, "timeline.json"), "w", encoding="utf8") as f:
    json.dump(spoken, f, indent=1)
voice = os.path.join(WORK, "voice.wav")
sf.write(voice, np.clip(track, -1, 1), SR)
listing = os.path.join(WORK, "shots.txt")
with open(listing, "w", encoding="utf8") as f:
    for path in files:
        f.write(f"file '{path.replace(os.sep, '/')}'\n")
video = os.path.join(WORK, "video.mp4")
run(["-f", "concat", "-safe", "0", "-i", listing, "-c", "copy", video])
run(["-i", video, "-i", voice, "-map", "0:v", "-map", "1:a", "-af", "highpass=f=45,acompressor=threshold=-20dB:ratio=2.2:attack=6:release=120,loudnorm=I=-15:TP=-1.5:LRA=10", "-ar", "48000", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", OUT])
print("\n".join(report))
print(f"total {total:.1f}s -> {OUT} ({os.path.getsize(OUT) / 1e6:.1f} MB)")
