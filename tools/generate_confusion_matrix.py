# -*- coding: utf-8 -*-
"""
generate_confusion_matrix.py
Test seti üzerinde confusion matrix üretir.
Kullanım: python tools/generate_confusion_matrix.py
"""

import sys
import time
import numpy as np
import cv2
import torch
import torch.nn.functional as F
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
import seaborn as sns
from pathlib import Path

# Proje kökünü sys.path'e ekle
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from ml_core import config
from ml_core.model import build_model
from ml_core.predict_tif import normalize_et

# ============================================================================
# AYARLAR
# ============================================================================
EGITIM_SETI = Path(r"C:\Tubitak\May2026\Annotation\Project\EGITIM_SETI")
IMG_DIR     = EGITIM_SETI / "images"
MASK_DIR    = EGITIM_SETI / "masks"

CLASS_NAMES = ["Background", "Road", "Road_Damage", "Vehicle"]
N_CLASS     = 4
IGNORE_IDX  = 4
OUT_PNG     = PROJECT_ROOT / "confusion_matrix_test.png"


# ============================================================================
# BÖLME (SPLIT) — config.py ile aynı mantık
# ============================================================================
def make_test_split():
    """Blok-grid tabanlı test split'ini yeniden üretir."""
    rng = np.random.default_rng(config.SPLIT_SEED)

    img_patches: dict[str, list[tuple[int, int, str]]] = {}
    for m in sorted(MASK_DIR.glob("*.png")):
        stem   = m.stem
        parts  = stem.split("_x")
        img_id = parts[0]
        if len(parts) > 1:
            coord_parts = parts[1].split("_y")
            x = int(coord_parts[0])
            y = int(coord_parts[1]) if len(coord_parts) > 1 else 0
        else:
            x, y = 0, 0
        img_patches.setdefault(img_id, []).append((x, y, m.name))

    test_patches = []
    n_grid = config.SPLIT_BLOCK_GRID

    for img_id, patches in img_patches.items():
        xs = sorted(set(p[0] for p in patches))
        ys = sorted(set(p[1] for p in patches))
        n_x = max(1, len(xs))
        n_y = max(1, len(ys))

        blok_x = {x: min(int(i / n_x * n_grid), n_grid - 1) for i, x in enumerate(xs)}
        blok_y = {y: min(int(i / n_y * n_grid), n_grid - 1) for i, y in enumerate(ys)}

        bloklar = sorted(set((blok_x[p[0]], blok_y[p[1]]) for p in patches))
        bloklar_arr = np.array(bloklar)
        rng.shuffle(bloklar_arr)

        n_blok = len(bloklar_arr)
        n_test = max(1, round(n_blok * config.SPLIT_RATIOS["test"]))
        test_bloklar = set(map(tuple, bloklar_arr[-n_test:]))

        for x, y, fname in patches:
            if (blok_x[x], blok_y[y]) in test_bloklar:
                test_patches.append(fname)

    return test_patches


# ============================================================================
# ANA PROGRAM
# ============================================================================
def main():
    print("=" * 60)
    print("  AeroPath – Confusion Matrix Üreticisi")
    print("=" * 60)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"\n  Device: {device}")

    print("  Model yükleniyor...")
    model = build_model().to(device)
    ckpt_path = PROJECT_ROOT / "ml_core" / "weights" / "best.pth"
    ckpt = torch.load(ckpt_path, map_location=device, weights_only=False)
    model.load_state_dict(ckpt["model"])
    model.eval()
    print(f"  Checkpoint: epoch {ckpt.get('epoch', -1) + 1}")

    print("\n  Test split hesaplanıyor...")
    test_patches = make_test_split()
    test_patches = [p for p in test_patches if (IMG_DIR / p).exists() and (MASK_DIR / p).exists()]
    print(f"  Test patch sayısı: {len(test_patches)}")

    if not test_patches:
        print("\n  HATA: Hiç test patchı bulunamadı.")
        return

    print("\n  Inference başlıyor...")
    cm = np.zeros((N_CLASS, N_CLASS), dtype=np.int64)
    t0 = time.time()

    for idx, fname in enumerate(test_patches):
        if (idx + 1) % 20 == 0 or idx == 0:
            elapsed = time.time() - t0
            eta = elapsed / (idx + 1) * (len(test_patches) - idx - 1)
            print(f"  [{idx+1:>4}/{len(test_patches)}]  geçen: {elapsed:.0f}s  kalan: {eta:.0f}s")

        img = cv2.imread(str(IMG_DIR / fname))
        if img is None: continue
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        gt = cv2.imread(str(MASK_DIR / fname), cv2.IMREAD_GRAYSCALE)
        if gt is None: continue

        norm = normalize_et(img_rgb)
        tensor = torch.from_numpy(norm).unsqueeze(0).to(device)
        with torch.no_grad():
            logits = model(tensor)
            pred = logits.argmax(dim=1).squeeze(0).cpu().numpy().astype(np.uint8)

        valid_mask = gt < N_CLASS
        gt_valid = gt[valid_mask].flatten()
        pred_valid = pred[valid_mask].flatten()

        for true_c in range(N_CLASS):
            row_mask = gt_valid == true_c
            if not row_mask.any(): continue
            pred_in_row = pred_valid[row_mask]
            for pred_c in range(N_CLASS):
                cm[true_c, pred_c] += int((pred_in_row == pred_c).sum())

    print(f"\n  Inference tamamlandı: {time.time() - t0:.1f}s ({len(test_patches)} patch)")

    # ============================================================================
    # Metrikler
    # ============================================================================
    print("\n" + "=" * 60)
    print("  PER-CLASS METRİKLER")
    print("=" * 60)

    iou_list = []
    for c in range(N_CLASS):
        tp = cm[c, c]
        fn = cm[c, :].sum() - tp
        fp = cm[:, c].sum() - tp
        precision = tp / (tp + fp) if (tp + fp) > 0 else 0
        recall    = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1        = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
        iou       = tp / (tp + fp + fn) if (tp + fp + fn) > 0 else 0
        iou_list.append(iou)
        print(f"\n  [{c}] {CLASS_NAMES[c]}")
        print(f"      Precision : {precision*100:.2f}%")
        print(f"      Recall    : {recall*100:.2f}%")
        print(f"      F1-Score  : {f1*100:.2f}%")
        print(f"      IoU       : {iou*100:.2f}%")

    pixel_acc = np.diag(cm).sum() / cm.sum() if cm.sum() > 0 else 0
    miou = np.mean(iou_list)
    miou2 = np.mean([iou_list[c] for c in range(1, N_CLASS)])

    print(f"\n  Pixel Accuracy : {pixel_acc*100:.2f}%")
    print(f"  mIoU (4 sınıf) : {miou*100:.2f}%")
    print(f"  mIoU2 (BG hariç): {miou2*100:.2f}%")

    # ============================================================================
    # Görselleştirme
    # ============================================================================
    cm_norm = cm.astype(float)
    row_sums = cm_norm.sum(axis=1, keepdims=True)
    row_sums[row_sums == 0] = 1
    cm_norm = cm_norm / row_sums * 100

    fig, axes = plt.subplots(1, 2, figsize=(18, 7))
    fig.suptitle(
        f"AeroPath – UNet++/EfficientNet-B4 | Test Seti Confusion Matrix\n"
        f"Test Patch: {len(test_patches)} | mIoU: {miou*100:.1f}% | "
        f"mIoU² (BG hariç): {miou2*100:.1f}% | Pixel Acc: {pixel_acc*100:.1f}%",
        fontsize=13, y=1.02)

    sns.heatmap(cm_norm, annot=True, fmt=".1f", cmap="Blues",
        xticklabels=CLASS_NAMES, yticklabels=CLASS_NAMES,
        linewidths=0.5, linecolor="gray",
        annot_kws={"size": 13, "weight": "bold"}, vmin=0, vmax=100, ax=axes[0])
    axes[0].set_title("Normalize Confusion Matrix (%)", fontsize=11)
    axes[0].set_ylabel("Gerçek Sınıf", fontsize=11)
    axes[0].set_xlabel("Tahmin Edilen Sınıf", fontsize=11)

    def fmt_k(v):
        if v >= 1_000_000: return f"{v/1e6:.1f}M"
        elif v >= 1_000: return f"{v/1e3:.0f}K"
        return str(v)

    labels_abs = np.vectorize(fmt_k)(cm)
    sns.heatmap(cm, annot=labels_abs, fmt="", cmap="YlOrRd",
        xticklabels=CLASS_NAMES, yticklabels=CLASS_NAMES,
        linewidths=0.5, linecolor="gray",
        annot_kws={"size": 12}, ax=axes[1])
    axes[1].set_title("Piksel Sayısı", fontsize=11)
    axes[1].set_ylabel("Gerçek Sınıf", fontsize=11)
    axes[1].set_xlabel("Tahmin Edilen Sınıf", fontsize=11)

    plt.tight_layout()
    plt.savefig(str(OUT_PNG), dpi=150, bbox_inches="tight")
    print(f"\n  Kaydedildi: {OUT_PNG}")
    plt.show()

    print("\n  Tamamlandı.")


if __name__ == "__main__":
    main()
