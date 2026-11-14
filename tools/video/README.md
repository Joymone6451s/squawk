# How the demo video is made

Everything here runs on the author's machine. None of it is part of the product.

1. `node scripts/cast.mjs --parent <you>.testnet` makes the demo writers and fans.
2. Serve the page: `npx vite web --port 8766`.
3. Start the stand-in wallet for the fan who clicks:
   `node tools/video/wallet-server.mjs ana.<you>.testnet <speedrun coin> social`.
   It listens on 127.0.0.1:38767 only (or `WALLET_PORT`), signs only function calls to the receivers named, and keeps the
   key in its own process.
4. Film: `node tools/video/film.mjs <speedrun coin> <footage folder>`. It drives Microsoft Edge
   with `playwright-core` through one full round on the live coin and writes `raw.webm` and
   `marks.json`, the time of each shot.
5. Voice: `python tools/video/voice.py <voice folder>`, with `FFMPEG` and `HF_HOME` set. It speaks
   `script.py` line by line with Chatterbox TTS and keeps the best of three takes, scored by
   faster-whisper against the words of the script. On a machine short of memory,
   `python tools/video/voice_kokoro.py <kokoro-v1.0.onnx> <voices-v1.0.bin> <voice folder>` does
   the same with the much smaller Kokoro model and writes the same files.
6. Edit: `python tools/video/edit.py <footage folder> <voice folder> <work folder> <out.mp4>`.
   The shot list in `edit.py` says where in the footage each picture starts.
7. Check: `python tools/video/check_final.py <out.mp4> <wav>` transcribes the result, and
   `python tools/video/sheet.py <out.mp4> <work folder>/timeline.json <sheet.jpg>` draws one frame
   from the middle of every line, with its words, to check each picture against what is said.
