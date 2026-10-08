# ============================================================
# musicgen_server.py — Motif Lab 本机 AI 录音棚服务
# 契约（app.js 约定）：GET /health → 200；POST /generate
#   {prompt, melody: dataURI, duration} → WAV 字节
# 用法：
#   pip install audiocraft fastapi "uvicorn[standard]" soundfile
#   python musicgen_server.py          # 首次下载约 3.5GB(medium)
#   MODEL=facebook/musicgen-small python musicgen_server.py   # 显存不够用小档
# ============================================================
import os, base64, io, wave

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

MODEL_NAME = os.environ.get("MODEL", "facebook/musicgen-medium")
PORT = int(os.environ.get("PORT", 7860))
DEVICE = os.environ.get("DEVICE", "cuda")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

print(f"[motif-lab studio] loading {MODEL_NAME} on {DEVICE} (first run downloads weights)…")
from audiocraft.models import MusicGen
from audiocraft.data.audio import audio_write
import torch

model = MusicGen.get_pretrained(MODEL_NAME, device=DEVICE)
model.set_generation_params(duration=30)


class GenReq(BaseModel):
    prompt: str
    melody: str  # data URI
    duration: int = 30
    temperature: float = 1.0


def decode_datauri(uri: str) -> str:
    """data:audio/wav;base64,.... → 临时 wav 路径"""
    b64 = uri.split(",", 1)[1]
    raw = base64.b64decode(b64)
    path = io.BytesIO(raw)
    tmp = "_melody_in.wav"
    with open(tmp, "wb") as f:
        f.write(path.getbuffer())
    return tmp


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME}


@app.post("/generate")
def generate(req: GenReq):
    wav_path = decode_datauri(req.melody)
    melody, sr = _load(wav_path)
    dur = max(10, min(30, int(req.duration)))
    model.set_generation_params(duration=dur)
    try:
        out = model.generate_with_chroma(
            descriptions=[req.prompt],
            melody_wavs=[melody.to(DEVICE)],
            melody_sample_rate=[sr],
            progress=False,
            temperature=req.temperature,
        )
    except TypeError:
        out = model.generate_with_chroma(
            descriptions=[req.prompt],
            melody_wavs=[melody.to(DEVICE)],
            melody_sample_rate=[sr],
            progress=False,
        )
    # 转 WAV 字节
    buf = io.BytesIO()
    audio = out[0].cpu()
    with wave.open(buf, "wb") as w:
        w.setnchannels(audio.shape[0])
        w.setsampwidth(2)
        w.setframerate(model.sample_rate)
        import numpy as np
        pcm = (audio.numpy().T * 32767).clip(-32768, 32767).astype(np.int16)
        w.writeframes(pcm.tobytes())
    return Response(content=buf.getvalue(), media_type="audio/wav")


def _load(path):
    import soundfile as sf
    import torchaudio
    wav, sr = sf.read(path, dtype="float32")
    wav = torch.from_numpy(wav).T  # (channels, time)
    if wav.dim() == 1:
        wav = wav.unsqueeze(0)
    wav = torchaudio.functional.resample(wav, sr, model.sample_rate)
    return wav, model.sample_rate


if __name__ == "__main__":
    import uvicorn
    print(f"[motif-lab studio] listening on http://127.0.0.1:{PORT}")
    uvicorn.run(app, host="127.0.0.1", port=PORT)
