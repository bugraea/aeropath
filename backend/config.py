# -*- coding: utf-8 -*-
"""
backend/config.py
Sabitler ve yapılandırma parametreleri.
"""

from pathlib import Path

# ============================================================================
# Dizin Yapısı
# ============================================================================
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# ============================================================================
# Sınıf Tanımları
# ============================================================================
CLASS_NAMES = ["Background", "Road", "Road_Damage", "Vehicle"]
CLASS_RENGI_RGB = [
    (0, 0, 0),        # Background
    (0, 128, 255),     # Road       → mavi
    (255, 0, 0),       # Road_Damage → kırmızı
    (0, 255, 0),       # Vehicle    → yeşil
]
