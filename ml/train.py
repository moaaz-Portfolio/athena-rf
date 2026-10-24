from __future__ import annotations

import argparse
import json
import random
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, classification_report
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from ml.model import CNNBiLSTM  # noqa: E402

DATA_DIR = ROOT / "backend" / "data" / "recordings"
MODEL_DIR = ROOT / "models"
WINDOW = 64
FEATURES = 64
STRIDE = 16


def read_session(path: Path):
    rows = []
    label = None
    session_id = path.stem
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            feat = item.get("features")
            current_label = item.get("label")
            if current_label:
                label = str(current_label)
            if isinstance(feat, list) and len(feat) == FEATURES:
                arr = np.asarray(feat, dtype=np.float32)
                if np.isfinite(arr).all():
                    rows.append(arr)
            session_id = str(item.get("session_id") or session_id)
    if not label or len(rows) < WINDOW:
        return None
    return {"path": path.name, "session_id": session_id, "label": label, "features": np.stack(rows)}


def windows_from_session(session):
    series = session["features"]
    windows = []
    for start in range(0, len(series) - WINDOW + 1, STRIDE):
        windows.append(series[start:start + WINDOW])
    return windows


def split_sessions(sessions, seed):
    by_label = defaultdict(list)
    for s in sessions:
        by_label[s["label"]].append(s)
    rng = random.Random(seed)
    train_s, val_s, test_s = [], [], []
    insufficient = {label: len(items) for label, items in by_label.items() if len(items) < 3}
    if insufficient:
        details = ", ".join(f"{k}={v}" for k, v in sorted(insufficient.items()))
        raise SystemExit(
            "Need at least 3 separate recording sessions per label (train/validation/test). "
            f"Too few: {details}. Record each activity in separate sessions; never split adjacent frames randomly."
        )
    for label, items in sorted(by_label.items()):
        rng.shuffle(items)
        n = len(items)
        n_test = max(1, round(n * 0.2))
        n_val = max(1, round(n * 0.2))
        while n_test + n_val >= n:
            if n_test >= n_val and n_test > 1:
                n_test -= 1
            elif n_val > 1:
                n_val -= 1
            else:
                break
        train_n = n - n_val - n_test
        train_s.extend(items[:train_n])
        val_s.extend(items[train_n:train_n + n_val])
        test_s.extend(items[train_n + n_val:])
    return train_s, val_s, test_s


def build_xy(session_list, label_to_idx):
    xs, ys = [], []
    for session in session_list:
        ws = windows_from_session(session)
        xs.extend(ws)
        ys.extend([label_to_idx[session["label"]]] * len(ws))
    if not xs:
        return np.empty((0, WINDOW, FEATURES), dtype=np.float32), np.empty((0,), dtype=np.int64)
    return np.stack(xs).astype(np.float32), np.asarray(ys, dtype=np.int64)


def evaluate(model, loader, device, labels):
    model.eval()
    truths, preds = [], []
    with torch.no_grad():
        for xb, yb in loader:
            logits = model(xb.to(device))
            preds.extend(logits.argmax(dim=1).cpu().tolist())
            truths.extend(yb.tolist())
    return {
        "accuracy": float(accuracy_score(truths, preds)),
        "macro_f1": float(f1_score(truths, preds, average="macro", zero_division=0)),
        "confusion_matrix": confusion_matrix(truths, preds, labels=list(range(len(labels)))).tolist(),
        "report": classification_report(truths, preds, labels=list(range(len(labels))), target_names=labels,
                                         output_dict=True, zero_division=0),
        "samples": len(truths),
    }


def main():
    parser = argparse.ArgumentParser(description="Train ATHENA RF CNN-BiLSTM from real labeled ESP32-S3 CSI recordings")
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--patience", type=int, default=6)
    args = parser.parse_args()
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(max(1, min(4, torch.get_num_threads())))

    if not args.data_dir.exists():
        raise SystemExit(f"No recordings folder: {args.data_dir}. Capture labeled sessions first.")
    sessions = []
    for path in sorted(args.data_dir.glob("*.jsonl")):
        parsed = read_session(path)
        if parsed is not None:
            sessions.append(parsed)
    if not sessions:
        raise SystemExit("No usable recordings. Each JSONL needs >=64 valid frames with a label.")
    labels = sorted({s["label"] for s in sessions})
    if len(labels) < 2:
        raise SystemExit("Need at least two activity labels to train a classifier.")

    train_s, val_s, test_s = split_sessions(sessions, args.seed)
    label_to_idx = {label: i for i, label in enumerate(labels)}
    x_train, y_train = build_xy(train_s, label_to_idx)
    x_val, y_val = build_xy(val_s, label_to_idx)
    x_test, y_test = build_xy(test_s, label_to_idx)
    if min(len(x_train), len(x_val), len(x_test)) == 0:
        raise SystemExit("At least one split has no full windows. Record longer sessions (at least 64 frames each).")

    mean = x_train.reshape(-1, FEATURES).mean(axis=0)
    std = x_train.reshape(-1, FEATURES).std(axis=0)
    std[std < 1e-5] = 1.0
    x_train = (x_train - mean[None, None, :]) / std[None, None, :]
    x_val = (x_val - mean[None, None, :]) / std[None, None, :]
    x_test = (x_test - mean[None, None, :]) / std[None, None, :]

    def loader(x, y, shuffle=False):
        return DataLoader(TensorDataset(torch.from_numpy(x), torch.from_numpy(y)),
                          batch_size=args.batch_size, shuffle=shuffle, num_workers=0)

    train_loader, val_loader, test_loader = loader(x_train, y_train, True), loader(x_val, y_val), loader(x_test, y_test)
    model = CNNBiLSTM(num_classes=len(labels), feature_count=FEATURES)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    class_counts = np.bincount(y_train, minlength=len(labels)).astype(np.float32)
    class_weights = class_counts.sum() / np.maximum(class_counts, 1.0)
    class_weights = class_weights / class_weights.mean()
    criterion = nn.CrossEntropyLoss(weight=torch.tensor(class_weights, dtype=torch.float32, device=device))
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.001, weight_decay=0.0005)
    best_f1, best_state, stale = -1.0, None, 0
    history = []

    for epoch in range(1, args.epochs + 1):
        model.train()
        losses = []
        for xb, yb in train_loader:
            xb, yb = xb.to(device), yb.to(device)
            optimizer.zero_grad(set_to_none=True)
            logits = model(xb)
            loss = criterion(logits, yb)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=2.0)
            optimizer.step()
            losses.append(float(loss.item()))
        val_metrics = evaluate(model, val_loader, device, labels)
        val_f1 = val_metrics["macro_f1"]
        history.append({"epoch": epoch, "train_loss": float(np.mean(losses)), "val_accuracy": val_metrics["accuracy"], "val_macro_f1": val_f1})
        print(f"epoch {epoch:02d}/{args.epochs} loss={np.mean(losses):.4f} val_acc={val_metrics['accuracy']:.3f} val_macro_f1={val_f1:.3f}")
        if val_f1 > best_f1:
            best_f1 = val_f1
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            stale = 0
        else:
            stale += 1
            if stale >= args.patience:
                print("Early stopping: validation macro-F1 did not improve.")
                break

    if best_state is None:
        raise SystemExit("Training failed to produce a model.")
    model.load_state_dict(best_state)
    model.to(device)
    test_metrics = evaluate(model, test_loader, device, labels)
    val_metrics = evaluate(model, val_loader, device, labels)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    checkpoint = {
        "version": "athena-cnn-bilstm-0.2",
        "state_dict": best_state,
        "labels": labels,
        "feature_count": FEATURES,
        "window_length": WINDOW,
        "mean": mean.astype(float).tolist(),
        "std": std.astype(float).tolist(),
        "confidence_threshold": 0.65,
        "training_sessions": [s["path"] for s in train_s],
        "validation_sessions": [s["path"] for s in val_s],
        "test_sessions": [s["path"] for s in test_s],
    }
    torch.save(checkpoint, MODEL_DIR / "activity_model.pt")
    metrics = {
        "model_version": checkpoint["version"],
        "labels": labels,
        "window_length_frames": WINDOW,
        "feature_count": FEATURES,
        "split_by_recording_session": True,
        "session_counts": {"train": len(train_s), "validation": len(val_s), "test": len(test_s)},
        "window_counts": {"train": len(x_train), "validation": len(x_val), "test": len(x_test)},
        "validation": val_metrics,
        "test": test_metrics,
        "history": history,
        "warning": "Scores are only valid for the collected setup. Test on unseen rooms and people before relying on predictions.",
    }
    (MODEL_DIR / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    (MODEL_DIR / "confusion_matrix.csv").write_text(
        "true/pred," + ",".join(labels) + "\n" + "\n".join(label + "," + ",".join(map(str, row)) for label, row in zip(labels, test_metrics["confusion_matrix"])) + "\n",
        encoding="utf-8",
    )
    print("\nTraining complete. Saved models/activity_model.pt, models/metrics.json and models/confusion_matrix.csv")
    print(f"Held-out session test: accuracy={test_metrics['accuracy']:.3f} macro-F1={test_metrics['macro_f1']:.3f}")
    print("The model is trained/inferred on the PC; 16 MB flash is firmware storage, not working RAM.")


if __name__ == "__main__":
    main()
