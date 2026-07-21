# -*- coding: utf-8 -*-
"""
backend/state.py
Uygulama genelinde paylaşılan durum değişkenleri.
Modüller arası bağımlılık enjeksiyonu yerine merkezi state tutar.
"""

# PyTorch model ve cihaz referansları (lifespan'da atanır)
device = None
models = {}

# Çıkarım ilerleme takibi: filename → {"current": int, "total": int, "status": str}
progress_store: dict = {}

# Çıkarım sonuçları: filename → dict
result_store: dict = {}
