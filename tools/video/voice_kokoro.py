"""Speaks the narration with Kokoro, a much smaller voice model than Chatterbox.

    python voice_kokoro.py <kokoro-v1.0.onnx> <voices-v1.0.bin> <output folder>

It writes the same files and the same index.json as voice.py, so edit.py can use either. Kokoro
has no emotion control, so lively lines get a slightly faster pace instead. Each line is checked
by transcription when faster-whisper is installed. FFMPEG must point at an ffmpeg binary.
"""
import difflib
import json
import os
import re
import subprocess
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from script import LINES  # noqa: E402

model, voices, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
FFMPEG = os.environ["FFMPEG"]
VOICE = os.environ.get("KOKORO_VOICE", "af_heart")
tts = Kokoro(model, voices)

try:
    from faster_whisper import WhisperModel

    judge = WhisperModel("base.en", device="cpu", compute_type="int8", cpu_threads=3)
except Exception as error:  # the check is optional
    print(f"no transcription check: {error}", flush=True)
    judge = None


def at_16k(path):
    """The clip as 16 kHz mono floats, the form the transcriber wants, resampled by ffmpeg."""
    low = path.replace(".wav", "_16k.wav")
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", path, "-ar", "16000", "-ac", "1", low], check=True)
    clip, _ = sf.read(low, dtype="float32")
    os.remove(low)
    return clip


def words(text):
    return re.sub(r"[^a-z0-9 ]", "", text.lower().replace("-", " ")).split()


index = []
for n, (shot, picture, say, caption, emotion, cfg, gap) in enumerate(LINES):
    # The most excited lines (emotion above 1) are spoken a little faster.
    speed = 1.0 + max(0.0, emotion - 0.9) * 0.25
    audio, rate = tts.create(say, voice=VOICE, speed=speed, lang="en-us")
    raw = os.path.join(out, f"raw_{n:02d}.wav")
    sf.write(raw, audio, rate)
    final = os.path.join(out, f"line{n:02d}.wav")
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-ar", "24000", "-ac", "1", final], check=True)
    seconds = len(sf.read(final)[0]) / 24000
    heard, score = "", 1.0
    if judge is not None:
        segments, _ = judge.transcribe(at_16k(final), language="en", beam_size=5, vad_filter=False)
        heard = " ".join(s.text.strip() for s in segments)
        score = difflib.SequenceMatcher(None, words(say), words(heard)).ratio()
    print(f"== line {n:02d} {seconds:4.1f}s match {score:.2f} heard: {heard}", flush=True)
    index.append({"n": n, "shot": shot, "picture": picture, "text": caption or say, "say": say, "heard": heard, "score": score, "file": final, "seconds": seconds, "gap": gap})

with open(os.path.join(out, "index.json"), "w") as f:
    json.dump(index, f, indent=1)
print(f"VOICE DONE, total speech {sum(i['seconds'] for i in index):.1f}s, weak lines: {[(i['n'], i['heard']) for i in index if i['score'] < 0.9]}", flush=True)
