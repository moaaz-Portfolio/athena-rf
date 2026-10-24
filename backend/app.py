from __future__ import annotations

import asyncio
import base64
import json
import math
import os
import socket
import struct
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "web"
RECORDINGS_DIR = ROOT / "backend" / "data" / "recordings"
MODEL_DIR = ROOT / "models"
MODEL_PATH = MODEL_DIR / "activity_model.pt"
UDP_HOST = os.getenv("ATHENA_UDP_HOST", "0.0.0.0")
UDP_PORT = int(os.getenv("ATHENA_UDP_PORT", "5005"))
HEADER = struct.Struct("<4sBBbBIIH")  # magic, version, channel, RSSI, flags, seq, device timestamp, CSI length
MAGIC = b"ATCS"
FEATURE_COUNT = 64
WINDOW_LEN = 64

RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
app = FastAPI(title="ATHENA RF API", version="0.2.0")

state: dict[str, Any] = {
    "backend_online": True,
    "device_seen": False,
    "frames_total": 0,
    "sequence": None,
    "rssi_dbm": None,
    "channel": None,
    "csi_len": None,
    "features": [],
    "amplitude_variance": None,
    "packet_rate_hz": 0.0,
    "last_frame_age_s": None,
    "activity": "غير متاح",
    "activity_code": None,
    "model_confidence": None,
    "model_loaded": False,
    "model_labels": [],
    "recording": False,
    "recording_label": None,
    "recording_frames": 0,
    "last_error": None,
}
last_packet_times: deque[float] = deque(maxlen=512)
feature_window: deque[list[float]] = deque(maxlen=WINDOW_LEN)
recording_file = None
recording_meta: dict[str, Any] | None = None
recording_started_at: float | None = None
model_runtime = None
last_infer_at = 0.0
udp_transport = None

SUPPORTED_ACTIVITY_LABELS = {"arm_wave", "fall", "jumping", "running", "squatting", "turning", "walking"}

LABELS_AR = {
    "still": "سكون",
    "walking": "مشي",
    "running": "جري",
    "sitting": "جلوس",
    "standing": "وقوف",
    "fall": "سقوط",
    "turning": "استدارة",
    "jumping": "قفز",
    "squatting": "قرفصاء",
    "arm_wave": "تحريك الذراع",
    "other": "حركة أخرى",
}


def resample_magnitudes(csi: bytes, flags: int, count: int = FEATURE_COUNT) -> list[float]:
    """Convert CSI's signed [imaginary, real] byte pairs into a fixed-length magnitude vector.

    ESP-IDF notes that the first 4 bytes can be invalid when first_word_invalid is set.
    CSI may contain multiple LTF segments; this starter keeps a consistent vector length but
    does not yet segment/phase-calibrate the individual LTF fields.
    """
    raw = csi[4:] if (flags & 1) else csi
    usable = len(raw) - (len(raw) % 2)
    mags: list[float] = []
    for i in range(0, usable, 2):
        imag = raw[i] if raw[i] < 128 else raw[i] - 256
        real = raw[i + 1] if raw[i + 1] < 128 else raw[i + 1] - 256
        mags.append(math.sqrt(float(imag * imag + real * real)))
    if not mags:
        return [0.0] * count
    if len(mags) == 1:
        return mags * count
    result: list[float] = []
    for j in range(count):
        pos = j * (len(mags) - 1) / (count - 1)
        lo = int(pos)
        hi = min(lo + 1, len(mags) - 1)
        frac = pos - lo
        result.append(mags[lo] * (1.0 - frac) + mags[hi] * frac)
    return result


def try_load_model() -> dict[str, Any]:
    global model_runtime
    if not MODEL_PATH.exists():
        model_runtime = None
        state["model_loaded"] = False
        state["model_labels"] = []
        state["activity"] = "غير متاح — درّب النموذج أولًا"
        state["activity_code"] = None
        state["model_confidence"] = None
        return {"loaded": False, "reason": "model_not_found", "path": str(MODEL_PATH)}
    try:
        from ml.model import CNNBiLSTM
        import torch
        try:
            checkpoint = torch.load(MODEL_PATH, map_location="cpu", weights_only=True)
        except TypeError:  # for older PyTorch builds
            checkpoint = torch.load(MODEL_PATH, map_location="cpu")
        labels = list(checkpoint["labels"])
        model = CNNBiLSTM(num_classes=len(labels), feature_count=int(checkpoint["feature_count"]))
        model.load_state_dict(checkpoint["state_dict"])
        model.eval()
        model_runtime = {
            "torch": torch,
            "model": model,
            "labels": labels,
            "mean": checkpoint["mean"],
            "std": checkpoint["std"],
            "threshold": float(checkpoint.get("confidence_threshold", 0.65)),
            "version": checkpoint.get("version", "unknown"),
        }
        state["model_loaded"] = True
        state["model_labels"] = labels
        state["activity"] = "في انتظار عينات كافية"
        state["activity_code"] = None
        state["model_confidence"] = None
        return {"loaded": True, "labels": labels, "version": model_runtime["version"]}
    except Exception as exc:  # the dashboard remains usable without ML dependencies
        model_runtime = None
        state["model_loaded"] = False
        state["last_error"] = f"Model load failed: {exc}"
        return {"loaded": False, "reason": "load_error", "detail": str(exc)}


def maybe_predict(features: list[float]) -> None:
    global last_infer_at
    now = time.monotonic()
    if not model_runtime or len(feature_window) < WINDOW_LEN or (now - last_infer_at) < 0.25:
        return
    last_infer_at = now
    torch = model_runtime["torch"]
    mean = model_runtime["mean"]
    std = model_runtime["std"]
    x = [
        [(float(v) - float(mean[j])) / max(float(std[j]), 1e-5) for j, v in enumerate(row)]
        for row in feature_window
    ]
    try:
        with torch.no_grad():
            logits = model_runtime["model"](torch.tensor([x], dtype=torch.float32))
            probs = torch.softmax(logits, dim=-1)[0]
            score, idx = torch.max(probs, dim=-1)
            score_value = float(score.item())
            code = model_runtime["labels"][int(idx.item())]
        state["model_confidence"] = score_value
        if score_value >= model_runtime["threshold"]:
            state["activity_code"] = code
            state["activity"] = LABELS_AR.get(code, code)
        else:
            state["activity_code"] = None
            state["activity"] = "غير معروف — ثقة منخفضة"
    except Exception as exc:
        state["last_error"] = f"Inference failed: {exc}"


def handle_packet(data: bytes) -> None:
    global recording_file
    if len(data) < HEADER.size:
        return
    try:
        magic, version, channel, rssi, flags, seq, device_ts, csi_len = HEADER.unpack_from(data)
    except struct.error:
        return
    if magic != MAGIC or version != 1 or csi_len > 612 or len(data) != HEADER.size + csi_len:
        return
    csi = data[HEADER.size:]
    features = resample_magnitudes(csi, flags)
    now = time.monotonic()
    wall_ms = int(time.time() * 1000)
    last_packet_times.append(now)
    while len(last_packet_times) > 2 and (now - last_packet_times[0]) > 2.0:
        last_packet_times.popleft()
    feature_window.append(features)
    state["device_seen"] = True
    state["frames_total"] += 1
    state["sequence"] = seq
    state["rssi_dbm"] = int(rssi)
    state["channel"] = int(channel)
    state["csi_len"] = int(csi_len)
    state["features"] = features
    state["amplitude_variance"] = round(sum((v - sum(features) / len(features)) ** 2 for v in features) / len(features), 3)
    state["last_frame_age_s"] = 0.0
    if len(last_packet_times) >= 2:
        span = last_packet_times[-1] - last_packet_times[0]
        state["packet_rate_hz"] = round((len(last_packet_times) - 1) / span, 2) if span > 0 else 0.0
    maybe_predict(features)
    if recording_file is not None and recording_meta is not None:
        row = {
            "schema_version": 1,
            "session_id": recording_meta["session_id"],
            "timestamp_ms": wall_ms,
            "device_timestamp_us": int(device_ts),
            "sequence": int(seq),
            "rssi_dbm": int(rssi),
            "channel": int(channel),
            "csi_len": int(csi_len),
            "flags": int(flags),
            "features": features,
            "raw_csi_b64": base64.b64encode(csi).decode("ascii"),
            "label": recording_meta["label"],
        }
        recording_file.write(json.dumps(row, separators=(",", ":")) + "\n")
        recording_meta["frames"] += 1
        state["recording_frames"] = recording_meta["frames"]
        # Frequent flushing limits data loss if the app is closed unexpectedly.
        if recording_meta["frames"] % 50 == 0:
            recording_file.flush()


class CSIProtocol(asyncio.DatagramProtocol):
    def datagram_received(self, data: bytes, addr) -> None:
        handle_packet(data)

    def error_received(self, exc: Exception) -> None:
        state["last_error"] = f"UDP: {exc}"


class RecordingRequest(BaseModel):
    label: str = Field(min_length=2, max_length=32)
    subject_code: str = Field(default="P01", min_length=1, max_length=24)
    notes: str = Field(default="", max_length=500)


@app.on_event("startup")
async def startup() -> None:
    global udp_transport
    loop = asyncio.get_running_loop()
    udp_transport, _protocol = await loop.create_datagram_endpoint(CSIProtocol, local_addr=(UDP_HOST, UDP_PORT))
    try_load_model()


@app.on_event("shutdown")
async def shutdown() -> None:
    global recording_file, udp_transport
    if udp_transport is not None:
        udp_transport.close()
        udp_transport = None
    if recording_file:
        recording_file.flush()
        recording_file.close()
        recording_file = None


@app.get("/api/status")
async def get_status():
    current = dict(state)
    if last_packet_times:
        current["last_frame_age_s"] = round(time.monotonic() - last_packet_times[-1], 2)
        current["device_seen"] = current["last_frame_age_s"] < 3.0
    else:
        current["device_seen"] = False
        current["last_frame_age_s"] = None
    current["udp_listen"] = f"{UDP_HOST}:{UDP_PORT}"
    return current


@app.get("/api/model")
async def get_model():
    metrics_path = MODEL_DIR / "metrics.json"
    metrics = json.loads(metrics_path.read_text("utf-8")) if metrics_path.exists() else None
    return {"loaded": state["model_loaded"], "labels": state["model_labels"], "metrics": metrics}


@app.post("/api/model/reload")
async def reload_model():
    return try_load_model()


@app.post("/api/recording/start")
async def start_recording(request: RecordingRequest):
    global recording_file, recording_meta, recording_started_at
    if recording_file is not None:
        raise HTTPException(status_code=409, detail="There is already an active recording")
    allowed_labels = SUPPORTED_ACTIVITY_LABELS
    if request.label not in allowed_labels:
        raise HTTPException(status_code=422, detail=f"label must be one of: {', '.join(sorted(allowed_labels))}")
    now = datetime.now(timezone.utc)
    session_id = f"{now.strftime('%Y%m%dT%H%M%SZ')}_{request.label}_{uuid4().hex[:6]}"
    data_path = RECORDINGS_DIR / f"{session_id}.jsonl"
    recording_file = data_path.open("a", encoding="utf-8", buffering=1)
    recording_meta = {
        "session_id": session_id,
        "label": request.label,
        "subject_code": request.subject_code,
        "notes": request.notes,
        "started_at": now.isoformat(),
        "file": data_path.name,
        "frames": 0,
    }
    recording_started_at = time.monotonic()
    state["recording"] = True
    state["recording_label"] = request.label
    state["recording_frames"] = 0
    return {"ok": True, **recording_meta}


@app.post("/api/recording/stop")
async def stop_recording():
    global recording_file, recording_meta, recording_started_at
    if recording_file is None or recording_meta is None:
        raise HTTPException(status_code=409, detail="No active recording")
    ended_at = datetime.now(timezone.utc)
    recording_file.flush()
    recording_file.close()
    recording_file = None
    completed = dict(recording_meta)
    completed["ended_at"] = ended_at.isoformat()
    completed["duration_s"] = round(time.monotonic() - (recording_started_at or time.monotonic()), 2)
    meta_path = RECORDINGS_DIR / f"{completed['session_id']}.meta.json"
    meta_path.write_text(json.dumps(completed, ensure_ascii=False, indent=2), encoding="utf-8")
    recording_meta = None
    recording_started_at = None
    state["recording"] = False
    state["recording_label"] = None
    state["recording_frames"] = 0
    return {"ok": True, **completed}


@app.get("/api/recordings")
async def list_recordings():
    items = []
    for meta_path in sorted(RECORDINGS_DIR.glob("*.meta.json"), reverse=True):
        try:
            items.append(json.loads(meta_path.read_text("utf-8")))
        except Exception:
            continue
    return {"count": len(items), "recordings": items[:100]}


@app.websocket("/ws/live")
async def websocket_live(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            payload = dict(state)
            if last_packet_times:
                age = time.monotonic() - last_packet_times[-1]
                payload["last_frame_age_s"] = round(age, 2)
                payload["device_seen"] = age < 3.0
            else:
                payload["device_seen"] = False
                payload["last_frame_age_s"] = None
            payload["server_time_ms"] = int(time.time() * 1000)
            await websocket.send_json(payload)
            await asyncio.sleep(0.2)
    except (WebSocketDisconnect, RuntimeError):
        pass


@app.get("/health")
async def health():
    return JSONResponse({"ok": True, "service": "athena-rf", "version": "0.2.0", "udp_port": UDP_PORT})

# Mount the existing Arabic frontend after API routes so they keep precedence.
app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
