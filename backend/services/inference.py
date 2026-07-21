# -*- coding: utf-8 -*-
"""
Ağır PyTorch çıkarım mantığı.
Background task olarak çalışır, event loop'u bloklamaz.
"""

import base64
import numpy as np
import cv2
import torch
import torch.nn.functional as F
from pathlib import Path

from backend import state
from backend.config import PROJECT_ROOT, CLASS_NAMES
from backend.utils.mask import create_mask_png
from backend.services.cache import save_to_cache
from ml_core.predict_tif import (
    tif_oku, tahmin_kaydet, patch_konumlari,
    hamming_2d, normalize_et, PATCH_BOYUT, OVERLAP, N_CLASS,
)


def run_inference(temp_path: str, filename: str, alpha: float, method: str = "Unet") -> dict:
    """Tam çıkarım pipeline'ı: okuma → patch → model → birleştirme → kaydet."""
    print(f"İşleniyor: {filename} ({method})")
    task_id = f"{filename}_{method}"

    # ================================================================
    # 1. Görüntü Okuma
    # ================================================================
    ext = Path(temp_path).suffix.lower()
    if ext in (".tif", ".tiff"):
        rgb, meta = tif_oku(temp_path)
    else:
        img = cv2.imread(temp_path)
        if img is None:
            raise ValueError("Geçersiz görüntü dosyası.")
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        meta = {"width": rgb.shape[1], "height": rgb.shape[0],
                "bounds": None, "crs": None}

    H, W = rgb.shape[:2]
    atlama = PATCH_BOYUT - OVERLAP
    konumlar = patch_konumlari(W, H, PATCH_BOYUT, atlama)
    n_patch = len(konumlar)

    hamm = hamming_2d(PATCH_BOYUT)
    hamm_3d = hamm[..., None]

    softmax_birikim = np.zeros((H, W, N_CLASS), dtype=np.float32)
    agirlik_birikim = np.zeros((H, W), dtype=np.float32)

    state.progress_store[task_id] = {
        "current": 0, "total": n_patch,
        "status": f"Yapay Zeka ({method}) analizi başladı...",
    }

    # ================================================================
    # 2. Batch Çıkarım
    # ================================================================
    batch_size = 4
    with torch.no_grad():
        for i in range(0, n_patch, batch_size):
            state.progress_store[task_id]["current"] = i
            state.progress_store[task_id]["status"] = (
                f"Parçalar işleniyor... ({i}/{n_patch})"
            )

            batch_konum = konumlar[i : i + batch_size]
            patch_list = []
            for x, y in batch_konum:
                patch = rgb[y : y + PATCH_BOYUT, x : x + PATCH_BOYUT]
                if patch.shape[0] != PATCH_BOYUT or patch.shape[1] != PATCH_BOYUT:
                    yeni = np.zeros((PATCH_BOYUT, PATCH_BOYUT, 3), dtype=np.uint8)
                    yeni[: patch.shape[0], : patch.shape[1]] = patch
                    patch = yeni
                patch_list.append(normalize_et(patch))

            batch_tensor = torch.from_numpy(np.stack(patch_list)).to(state.device)
            # Secilen modele gore islem yap
            model_to_use = state.models.get(method)
            if model_to_use is None:
                raise ValueError(f"Model {method} bulunamadi.")
            
            logits = model_to_use(batch_tensor)
            softmax = F.softmax(logits, dim=1).cpu().numpy()

            for j, (x, y) in enumerate(batch_konum):
                sm = softmax[j].transpose(1, 2, 0)
                y_son = min(y + PATCH_BOYUT, H)
                x_son = min(x + PATCH_BOYUT, W)
                dy, dx = y_son - y, x_son - x
                softmax_birikim[y:y_son, x:x_son] += sm[:dy, :dx] * hamm_3d[:dy, :dx]
                agirlik_birikim[y:y_son, x:x_son] += hamm[:dy, :dx]

    state.progress_store[task_id] = {
        "current": n_patch, "total": n_patch,
        "status": "Sonuçlar harmanlanıyor...",
    }

    # ================================================================
    # 3. Sonuç Üretimi
    # ================================================================
    agirlik_birikim = np.maximum(agirlik_birikim, 1e-6)
    softmax_norm = softmax_birikim / agirlik_birikim[..., None]

    stem = Path(filename).stem
    cikti_klasoru = PROJECT_ROOT / "ml_core" / "ciktilar" / "gorsel_analiz_sonuclari" / stem / method
    cikti_klasoru.mkdir(parents=True, exist_ok=True)

    if "profile" in meta:
        class_map = tahmin_kaydet(softmax_norm, meta, cikti_klasoru)
    else:
        class_map = np.argmax(softmax_norm, axis=-1).astype(np.uint8)
        cv2.imwrite(str(cikti_klasoru / "tahmin.tif"), class_map)

    # ================================================================
    # 4. İstatistikler ve Kodlama
    # ================================================================
    toplam = class_map.size
    stats = {}
    for i, isim in enumerate(CLASS_NAMES):
        n = int((class_map == i).sum())
        stats[isim] = round(100.0 * n / toplam, 2)

    overlay_bgra = create_mask_png(rgb, class_map)
    _, buffer_overlay = cv2.imencode(".png", overlay_bgra)
    b64_overlay = base64.b64encode(buffer_overlay).decode("utf-8")

    rgb_bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    _, buffer_orig = cv2.imencode(".jpg", rgb_bgr, [cv2.IMWRITE_JPEG_QUALITY, 100])
    b64_orig = base64.b64encode(buffer_orig).decode("utf-8")

    cache_meta = {
        "width": meta["width"],
        "height": meta["height"],
        "crs": str(meta["crs"]) if meta["crs"] else "Unknown",
        "method": method,
    }
    save_to_cache(filename, method, stats, cache_meta,
                  buffer_orig.tobytes(), buffer_overlay.tobytes())

    state.progress_store[task_id] = {
        "current": n_patch, "total": n_patch, "status": "Tamamlandı",
    }

    return {
        "status": "success",
        "stats": stats,
        "original_image": f"data:image/jpeg;base64,{b64_orig}",
        "overlay_image": f"data:image/png;base64,{b64_overlay}",
        "meta": cache_meta,
    }
