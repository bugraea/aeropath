# -*- coding: utf-8 -*-
"""
backend/app.py
FastAPI uygulama giriş noktası.
Lifespan ile model yükleme, CORS, router'lar ve statik dosya sunumu.
"""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend import state
from backend.routers import health, predict, preview, download


# ============================================================================
# Lifespan — Uygulama başlarken model yüklenir
# ============================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    """PyTorch modelini başlangıçta yükler, kapanışta temizlik yapar."""
    print("PyTorch modelleri yükleniyor...")
    try:
        import torch
        from ml_core.predict_tif import model_yukle

        state.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        for m_name in ["Unet", "DeepLabV3+", "Segformer"]:
            state.models[m_name] = model_yukle(state.device, model_name=m_name)
        print(f"Tum modeller başarıyla yüklendi: {state.device}")
    except Exception as e:
        print(f"Modeller yüklenemedi: {e}")
    yield


# ============================================================================
# Uygulama Oluşturma
# ============================================================================
app = FastAPI(title="AeroPath ML API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# Router Kaydı
# ============================================================================
app.include_router(health.router, prefix="/api")
app.include_router(predict.router, prefix="/api")
app.include_router(preview.router, prefix="/api")
app.include_router(download.router, prefix="/api")

# ============================================================================
# Statik Dosya Sunumu — Frontend
# ============================================================================
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
