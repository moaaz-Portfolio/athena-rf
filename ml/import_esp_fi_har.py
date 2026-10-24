"""Convert the public ESP-Fi HAR .mat samples into ATHENA JSONL sessions.

Source repository: https://github.com/AutoSmartGroup/ESP-Fi-HAR
Dataset license: CC BY 4.0 (cite Wen et al., Ad Hoc Networks, 2026).
This is a transfer-learning/baseline source, not a promise of ESP32-S3 accuracy.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
from scipy.io import loadmat

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "backend" / "data" / "recordings"
FEATURES = 64
ACTIVITY_BY_ID = {
    1: "running",
    2: "fall",
    3: "walking",
    4: "turning",
    5: "jumping",
    6: "squatting",
    7: "arm_wave",
}


def locate_sample_matrix(path: Path) -> np.ndarray:
    """Return a finite time × subcarrier amplitude matrix from a MATLAB file."""
    mat = loadmat(path, squeeze_me=True, struct_as_record=False)
    candidates: list[tuple[int, np.ndarray]] = []
    for name, value in mat.items():
        if name.startswith("__"):
            continue
        arr = np.asarray(value)
        if not np.issubdtype(arr.dtype, np.number):
            continue
        arr = np.squeeze(arr)
        if arr.ndim == 3:
            # The published README describes CSI amplitude samples as 1 × 950 × 52.
            arr = np.squeeze(arr)
        if arr.ndim != 2:
            continue
        if min(arr.shape) < 32 or max(arr.shape) < 64:
            continue
        # Most useful CSI matrices have a comparatively short subcarrier dimension.
        if arr.shape[0] <= 128 and arr.shape[1] > arr.shape[0]:
            arr = arr.T
        if arr.shape[1] > 128:
            continue
        arr = np.asarray(arr, dtype=np.float32)
        if not np.isfinite(arr).all():
            continue
        candidates.append((arr.size, arr))
    if not candidates:
        raise ValueError("No numeric time-by-subcarrier CSI amplitude matrix was found")
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def resample_subcarriers(matrix: np.ndarray, feature_count: int = FEATURES) -> np.ndarray:
    """Interpolate each time row across the available subcarriers to a fixed width."""
    matrix = np.asarray(matrix, dtype=np.float32)
    if matrix.ndim != 2 or matrix.shape[0] < 64 or matrix.shape[1] < 32:
        raise ValueError(f"Unexpected CSI sample shape {matrix.shape}; expected >=64 frames and >=32 subcarriers")
    src = np.linspace(0.0, 1.0, matrix.shape[1], dtype=np.float32)
    dst = np.linspace(0.0, 1.0, feature_count, dtype=np.float32)
    out = np.empty((matrix.shape[0], feature_count), dtype=np.float32)
    for i, row in enumerate(matrix):
        out[i] = np.interp(dst, src, row)
    # Keep non-finite or pathological samples out of training.
    if not np.isfinite(out).all():
        raise ValueError("Resampling created non-finite values")
    return out


def label_for_path(path: Path) -> tuple[int, str]:
    """Dataset filename convention: scenario-subject-activity-trial.mat."""
    match = re.match(r"^(\d+)-(\d+)-(\d+)-(\d+)\.mat$", path.name, flags=re.IGNORECASE)
    if not match:
        raise ValueError("filename does not match scenario-subject-activity-trial.mat")
    scenario, subject, activity, trial = map(int, match.groups())
    if activity not in ACTIVITY_BY_ID:
        raise ValueError(f"unknown activity id {activity}")
    return activity, f"scene{scenario}_person{subject}_trial{trial}"


def convert(input_dir: Path, output_dir: Path) -> tuple[int, int]:
    files = sorted(input_dir.rglob("*.mat"))
    if not files:
        raise SystemExit(f"No .mat files found under: {input_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)
    converted = skipped = 0
    for path in files:
        try:
            activity_id, session_suffix = label_for_path(path)
            matrix = locate_sample_matrix(path)
            features = resample_subcarriers(matrix)
            label = ACTIVITY_BY_ID[activity_id]
            session_id = f"esp_fi_har_{path.stem}_{session_suffix}"
            output_path = output_dir / f"{session_id}.jsonl"
            with output_path.open("w", encoding="utf-8") as stream:
                for idx, feature_row in enumerate(features):
                    row = {
                        "schema_version": 1,
                        "source_dataset": "ESP-Fi HAR (ESP32-C3; public dataset)",
                        "session_id": session_id,
                        "timestamp_ms": idx * 50,
                        "device_timestamp_us": idx * 50_000,
                        "sequence": idx,
                        "rssi_dbm": 0,
                        "channel": 0,
                        "csi_len": 0,
                        "flags": 0,
                        "features": feature_row.astype(float).tolist(),
                        "raw_csi_b64": "",
                        "label": label,
                    }
                    stream.write(json.dumps(row, separators=(",", ":")) + "\n")
            converted += 1
        except Exception as exc:
            skipped += 1
            print(f"SKIP {path.name}: {exc}", file=sys.stderr)
    print(f"Converted sessions: {converted}; skipped files: {skipped}")
    print(f"Output directory: {output_dir}")
    print("Important: this dataset uses ESP32-C3 and may not transfer accurately to your ESP32-S3/router/room.")
    return converted, skipped


def main() -> None:
    parser = argparse.ArgumentParser(description="Import public ESP-Fi HAR .mat files into ATHENA training sessions")
    parser.add_argument("--input", required=True, type=Path, help="Folder containing extracted ESP-Fi HAR .mat files")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Output folder (default: ATHENA recordings)")
    args = parser.parse_args()
    if not args.input.is_dir():
        raise SystemExit(f"Input folder does not exist: {args.input}")
    converted, _skipped = convert(args.input, args.output)
    if converted == 0:
        raise SystemExit("No samples converted; check the dataset layout and file names.")


if __name__ == "__main__":
    main()
