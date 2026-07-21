# -*- coding: utf-8 -*-
"""Disk önbellek okuma/yazma servisi."""

import json
import base64
from pathlib import Path
from backend.config import PROJECT_ROOT


def load_from_cache(filename: str, method: str) -> dict | None:
    """Daha önce analiz edilmiş sonucu diskten yükler. Bulunamazsa None döner."""
    stem = Path(filename).stem
    cache_dir = PROJECT_ROOT / "ml_core" / "ciktilar" / "gorsel_analiz_sonuclari" / stem / method
    stats_file = cache_dir / "stats.json"
    original_file = cache_dir / "original.jpg"
    overlay_file = cache_dir / "overlay.png"

    if not (stats_file.exists() and original_file.exists() and overlay_file.exists()):
        return None

    try:
        with open(stats_file, "r", encoding="utf-8") as f:
            saved = json.load(f)
        with open(original_file, "rb") as f:
            b64_orig = base64.b64encode(f.read()).decode("utf-8")
        with open(overlay_file, "rb") as f:
            b64_overlay = base64.b64encode(f.read()).decode("utf-8")

        print(f"[CACHE HIT] '{filename}' için önceki sonuç diskten yüklendi.")
        return {
            "status": "success",
            "cached": True,
            "stats": saved["stats"],
            "original_image": f"data:image/jpeg;base64,{b64_orig}",
            "overlay_image": f"data:image/png;base64,{b64_overlay}",
            "meta": saved["meta"],
        }
    except Exception as e:
        print(f"[CACHE] Okuma hatası, yeniden analiz yapılacak: {e}")
        return None


def save_to_cache(filename: str, method: str, stats: dict, meta: dict,
                  buffer_orig: bytes, buffer_overlay: bytes):
    """Analiz sonucunu diske kaydeder."""
    stem = Path(filename).stem
    cache_dir = PROJECT_ROOT / "ml_core" / "ciktilar" / "gorsel_analiz_sonuclari" / stem / method
    cache_dir.mkdir(parents=True, exist_ok=True)

    try:
        with open(cache_dir / "stats.json", "w", encoding="utf-8") as f:
            json.dump({"stats": stats, "meta": meta}, f, ensure_ascii=False, indent=2)
        with open(cache_dir / "original.jpg", "wb") as f:
            f.write(buffer_orig)
        with open(cache_dir / "overlay.png", "wb") as f:
            f.write(buffer_overlay)
        print(f"[CACHE] '{filename}' sonuçları diske kaydedildi: {cache_dir}")
    except Exception as e:
        print(f"[CACHE] Diske yazma hatası: {e}")
