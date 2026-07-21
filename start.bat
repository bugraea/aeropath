@echo off
title AeroPath - Afet Navigasyon ve Koordinasyon Sistemi
cd /d "%~dp0"

echo ============================================
echo   AEROPATH v3.7.1 - Baslatiliyor...
echo ============================================
echo.

REM Python kontrolu
python --version >nul 2>&1
if errorlevel 1 (
    echo [HATA] Python bulunamadi!
    echo Python 3.10 veya uzeri yukleyin: https://www.python.org/downloads/
    echo PATH ortam degiskenine eklemeyi unutmayin.
    pause
    exit /b 1
)

REM Bagimliliklari kontrol et ve yukle
echo Gerekli paketler kontrol ediliyor...
pip install -r requirements.txt --quiet 2>nul
if errorlevel 1 (
    echo [UYARI] Bazi paketler yuklenemedi. Devam ediliyor...
)

echo.
echo Backend sunucusu baslatiliyor...
echo Tarayici 3 saniye icinde acilacak.
echo.
echo ============================================
echo   AeroPath: http://127.0.0.1:8000
echo   Kapatmak icin bu pencereyi kapatin
echo   veya Ctrl+C yapin.
echo ============================================
echo.

REM Tarayiciyi arka planda gecikmeli ac
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://127.0.0.1:8000"

REM Backend'i on planda calistir (pencere acik kalir)
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
