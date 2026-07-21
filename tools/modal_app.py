# -*- coding: utf-8 -*-
"""
modal_app.py — Modal.com cloud GPU deployment.
Kullanım: modal deploy tools/modal_app.py
"""

import modal

image = modal.Image.debian_slim(python_version="3.10").pip_install(
    "fastapi", "uvicorn", "torch", "torchvision",
    "opencv-python-headless", "numpy", "rasterio",
    "python-multipart", "segmentation-models-pytorch"
).add_local_dir(".", remote_path="/root/app/aeropath-master", ignore=[
    "TIF/**", "data/**", "isleyen_veri/**", "ml_core/ciktilar/**", 
    "ml_core/training/**", "venv/**", ".git/**", "__pycache__/**", "*.rar"
])

app = modal.App("aeropath-api")


@app.function(image=image, gpu="T4", timeout=600)
@modal.concurrent(max_inputs=100)
@modal.asgi_app()
def fastapi_app():
    import sys, os
    sys.path.insert(0, "/root/app/aeropath-master")
    os.chdir("/root/app/aeropath-master")
    from backend.app import app as fastapi_backend
    return fastapi_backend
