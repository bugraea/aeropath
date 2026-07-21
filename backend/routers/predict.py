# -*- coding: utf-8 -*-
"""Tahmin, ilerleme takibi ve sonuç endpoint'leri."""

import os
import traceback
import base64
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks
from pydantic import BaseModel

from backend import state
from backend.services.cache import load_from_cache
from backend.services.inference import run_inference

router = APIRouter()


@router.get("/progress/{filename}")
async def get_progress(filename: str):
    """Belirtilen dosya için çıkarım ilerleme durumunu döndürür."""
    if filename in state.progress_store:
        return state.progress_store[filename]
    return {"current": 0, "total": 1, "status": "Bekliyor"}


@router.get("/result/{filename}")
async def get_result(filename: str):
    """Tamamlanmış çıkarım sonucunu döndürür."""
    if filename not in state.result_store:
        raise HTTPException(status_code=404, detail="Sonuç bulunamadı.")
    return state.result_store[filename]

class CloudCacheSaveRequest(BaseModel):
    filename: str
    method: str
    stats: dict
    original_b64: str
    overlay_b64: str

@router.post("/save_cache_from_cloud")
async def save_cache_from_cloud(req: CloudCacheSaveRequest):
    """Bulutta yapilan analizin sonucunu yerel bilgisayarin diskine kaydeder."""
    from backend.services.cache import save_to_cache
    
    orig_bytes = base64.b64decode(req.original_b64.split(",")[-1] if "," in req.original_b64 else req.original_b64)
    overlay_bytes = base64.b64decode(req.overlay_b64.split(",")[-1] if "," in req.overlay_b64 else req.overlay_b64)
    meta = {"width": 0, "height": 0, "crs": "Unknown", "method": req.method}
    
    save_to_cache(req.filename, req.method, req.stats, meta, orig_bytes, overlay_bytes)
    return {"status": "ok"}


@router.post("/predict")
async def predict_image(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    alpha: float = Form(0.5),
    method: str = Form("Unet"),
):
    """Görüntü çıkarımını başlatır. Önbellek varsa anında döner."""
    if not state.models:
        raise HTTPException(status_code=500, detail="Modeller yüklenmedi.")

    filename = file.filename

    # ================================================================
    # Önbellek Kontrolü
    # ================================================================
    # Benzersiz islem id: dosya_adi + method
    task_id = f"{filename}_{method}"
    cached_result = load_from_cache(filename, method)
    if cached_result is not None:
        state.progress_store[task_id] = {
            "current": 1, "total": 1, "status": "Tamamlandı (önbellekten)",
        }
        state.result_store[task_id] = cached_result
        return {"status": "processing", "task_id": task_id}

    # ================================================================
    # Arka Plan Çıkarımı
    # ================================================================
    temp_path = f"temp_{filename}"
    state.progress_store[task_id] = {
        "current": 0, "total": 1, "status": "Dosya yükleniyor...",
    }

    try:
        content = await file.read()
        with open(temp_path, "wb") as f:
            f.write(content)

        def background_inference():
            try:
                res = run_inference(temp_path, filename, alpha, method)
                state.result_store[task_id] = res
            except Exception:
                traceback.print_exc()
                state.progress_store[task_id] = {
                    "current": 1, "total": 1,
                    "status": f"Hata: {traceback.format_exc()}", "error": True,
                }
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)

        background_tasks.add_task(background_inference)
        return {"status": "processing", "task_id": task_id}

    except Exception as e:
        traceback.print_exc()
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise HTTPException(status_code=500, detail=str(e))
