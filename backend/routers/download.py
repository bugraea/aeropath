# -*- coding: utf-8 -*-
"""Sonuç indirme endpoint'i."""

from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from backend.config import PROJECT_ROOT

router = APIRouter()


@router.get("/download/{filename}")
async def download_result(filename: str):
    """İşlenmiş sonucu orijinal TIF formatında indirir."""
    stem = Path(filename).stem
    cikti_yolu = PROJECT_ROOT / "ml_core" / "ciktilar" / stem / "tahmin.tif"

    if not cikti_yolu.exists():
        raise HTTPException(status_code=404, detail="Sonuç dosyası bulunamadı.")

    return FileResponse(
        path=cikti_yolu,
        media_type="image/tiff",
        filename=f"{stem}_analiz_sonucu.tif",
    )
