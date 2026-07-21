# -*- coding: utf-8 -*-
"""Maske oluşturma yardımcı fonksiyonu."""

import numpy as np
import cv2
from backend.config import CLASS_RENGI_RGB


def create_mask_png(rgb: np.ndarray, class_map: np.ndarray) -> np.ndarray:
    """Sınıf haritasından saydam RGBA maske oluşturur.
    Background pikselleri saydam, etiketli pikseller opak döner.
    """
    renkler = np.array(CLASS_RENGI_RGB, dtype=np.uint8)
    color_mask = renkler[class_map]

    rgba = np.zeros((rgb.shape[0], rgb.shape[1], 4), dtype=np.uint8)
    labeled = class_map > 0
    rgba[labeled, :3] = color_mask[labeled]
    rgba[labeled, 3] = 255

    return cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA)
