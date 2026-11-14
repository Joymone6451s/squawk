"""Speaks the narration, one line at a time, and keeps the best of a few takes.

    python voice.py <output folder>

Each take is transcribed and scored against the words it was meant to say. A take that scores
0.93 or more is kept at once; otherwise the best of the takes is. Lines already in the output
folder's index are not made again, so a changed script only re-speaks the lines that changed.

Needs: chatterbox-tts, torch, faster-whisper, librosa, soundfile. FFMPEG must point at an ffmpeg
binary, and HF_HOME at a folder holding the two models.
"""
import difflib
import json
import os
import re
import subprocess
import sys
import time

import librosa
import soundfile as sf
import torch
from chatterbox.tts import ChatterboxTTS
from faster_whisper import WhisperModel

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from script import LINES  # noqa: E402

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
FFMPEG = os.environ["FFMPEG"]
TAKES = int(os.environ.get("TAKES", "3"))
ONLY = {int(n) for n in os.environ.get("ONLY", "").split(",") if n}
GOOD = 0.93
MAX_WPM = 172


def words(text):
    text = text.lower().replace("-", " ").replace("meme coin", "memecoin")
    return re.sub(r"[^a-z0-9 ]", "", text).split()


index_path = os.path.join(out, "index.json")
done = {i["say"]: i for i in json.load(open(index_path))} if os.path.exists(index_path) else {}
todo = [n for n, line in enumerate(LINES) if line[2] not in done and (not ONLY or n in ONLY)]
if todo:
    torch.set_num_threads(int(os.environ.get("VOICE_THREADS", "6")))
    model = ChatterboxTTS.from_pretrained(device="cpu")
    judge = WhisperModel("base.en", device="cpu", compute_type="int8", cpu_threads=3)
    print("models ready", flush=True)

index = []
for n, (shot, picture, say, caption, emotion, cfg, gap) in enumerate(LINES):
    final = os.path.join(out, f"line{n:02d}.wav")
    if say in done:
        entry = dict(done[say], n=n, shot=shot, picture=picture, text=caption or say, gap=gap)
        if entry["file"] != final:
            import shutil

            shutil.copyfile(entry["file"], final)
            entry["file"] = final
        print(f"== line {n:02d} already made", flush=True)
    elif n not in todo:
        continue
    else:
        best = None
        for take in range(TAKES):
            begun = time.time()
            torch.manual_seed(7000 + n * 17 + take * 101)
            wav = model.generate(say, exaggeration=emotion, cfg_weight=cfg, temperature=0.75)
            path = os.path.join(out, f"take_{n:02d}_{take}.wav")
            sf.write(path, wav.squeeze(0).numpy(), model.sr)
            audio, _ = librosa.load(path, sr=16000, mono=True)
            segments, _ = judge.transcribe(audio, language="en", beam_size=5, vad_filter=False)
            heard = " ".join(s.text.strip() for s in segments)
            score = difflib.SequenceMatcher(None, words(say), words(heard)).ratio()
            seconds = wav.shape[-1] / model.sr
            print(f"{n:02d}.{take} {seconds:4.1f}s {time.time() - begun:4.0f}s match {score:.2f} heard: {heard}", flush=True)
            if best is None or score > best[0]:
                best = (score, path, heard, seconds)
            if score >= GOOD:
                break
        score, path, heard, seconds = best
        wpm = len(say.split()) / max(seconds, 0.1) * 60
        tempo = max(0.84, min(1.0, MAX_WPM / wpm))
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", path, "-af", f"atempo={tempo:.3f}", "-ar", "24000", "-ac", "1", final], check=True)
        audio, _ = sf.read(final)
        final_seconds = len(audio) / 24000
        print(f"== line {n:02d} kept score {score:.2f}, {seconds:.1f}s -> {final_seconds:.1f}s at tempo {tempo:.2f}", flush=True)
        entry = {"n": n, "shot": shot, "picture": picture, "text": caption or say, "say": say, "heard": heard, "score": score, "file": final, "seconds": final_seconds, "gap": gap}
    index.append(entry)
    with open(index_path, "w") as f:
        json.dump(index + [v for k, v in done.items() if k not in {i["say"] for i in index}], f, indent=1)

if len(index) == len(LINES):
    with open(index_path, "w") as f:
        json.dump(index, f, indent=1)
weak = [(i["n"], i["heard"]) for i in index if i["score"] < GOOD]
print(f"VOICE DONE, {len(index)} of {len(LINES)} lines, total speech {sum(i['seconds'] for i in index):.1f}s, weak lines: {weak}", flush=True)
