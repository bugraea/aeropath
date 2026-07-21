# -*- coding: utf-8 -*-
"""Görüntü önizleme endpoint'i."""

import os
import base64
import cv2
from fastapi import APIRouter, UploadFile, File, HTTPException

router = APIRouter()


@router.post("/upload-preview")
async def upload_preview(file: UploadFile = File(...)):
    """Yüklenen TIF/resim dosyasını JPEG önizlemeye dönüştürür."""
    temp_path = f"temp_preview_{file.filename}"
    try:
        content = await file.read()
        with open(temp_path, "wb") as f:
            f.write(content)

        try:
            from ml_core.predict_tif import tif_oku
            rgb, _ = tif_oku(temp_path)
        except Exception:
            img = cv2.imread(temp_path)
            if img is None:
                raise ValueError("Geçersiz görüntü dosyası.")
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        rgb_bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        _, buffer = cv2.imencode(".jpg", rgb_bgr, [cv2.IMWRITE_JPEG_QUALITY, 100])
        b64 = base64.b64encode(buffer).decode("utf-8")

        return {"status": "success", "preview_image": f"data:image/jpeg;base64,{b64}"}

    except Exception as e:
        print(f"Preview hatası: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
