"""Transcribes the finished video's soundtrack, to confirm the narration is all there and in order.

    python check_final.py <video> <wav to write>

FFMPEG must point at an ffmpeg binary.
"""
import difflib
import os
import re
import subprocess
import sys

import librosa
import numpy as np
from faster_whisper import WhisperModel

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from script import LINES  # noqa: E402

video, wav = sys.argv[1:3]
subprocess.run([os.environ["FFMPEG"], "-hide_banner", "-loglevel", "error", "-y", "-i", video, "-ac", "1", "-ar", "16000", wav], check=True)
audio, sr = librosa.load(wav, sr=16000, mono=True)
print(f"soundtrack {len(audio) / sr:.1f}s")
model = WhisperModel("base.en", device="cpu", compute_type="int8", cpu_threads=4)
segments, _ = model.transcribe(audio, language="en", beam_size=5, vad_filter=False)
heard = []
for s in segments:
    print(f"{s.start:5.1f}  {s.text.strip()}")
    heard.append(s.text.strip())


def words(text):
    return re.sub(r"[^a-z0-9 ]", "", text.lower().replace("-", " ")).split()


said = words(" ".join(line[2] for line in LINES))
score = difflib.SequenceMatcher(None, said, words(" ".join(heard))).ratio()
print(f"match against the script: {score:.2f} over {len(said)} words")
rms = librosa.feature.rms(y=audio, frame_length=1024, hop_length=512)[0]
print(f"share of the soundtrack that is near silence: {(rms < 0.004).mean() * 100:.0f}%")
print(f"loudness spread, 10th to 90th percentile: {20 * np.log10(np.percentile(rms, 90) / max(np.percentile(rms, 10), 1e-5)):.0f} dB")
