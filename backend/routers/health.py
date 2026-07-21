# -*- coding: utf-8 -*-
"""Sağlık kontrolü endpoint'i."""

from fastapi import APIRouter
from backend import state

router = APIRouter()


@router.get("/health")
async def health():
    """Sunucu durumu ve model bilgisini döndürür."""
    return {
        "status": "ok",
        "model_loaded": len(state.models) > 0,
        "device": str(state.device),
    }
