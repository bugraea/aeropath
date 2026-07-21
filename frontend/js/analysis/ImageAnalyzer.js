/**
 * ImageAnalyzer.js — Dosya yükleme, analiz başlatma, ilerleme takibi.
 *
 * Backend seçici (lokal/cloud) ve dosya yükleme/analiz/indirme akışını yönetir.
 */

import { CacheManager } from '../shared/CacheManager.js';

export class ImageAnalyzer {
    constructor(imageViewer) {
        this.viewer = imageViewer;
        this.cache = new CacheManager();
        this.currentFile = null;
        this.backendBaseUrl = 'http://localhost:8000';
        this.availableMethods = new Set();

        this._bindEvents();
        this._checkLocalHealth();
        setInterval(() => this._checkLocalHealth(), 5000);
    }

    /* ============================================================================
       Backend Seçici
       ============================================================================ */
    _bindEvents() {
        const backendOpts = document.querySelectorAll('.backend-opt');
        backendOpts.forEach(btn => btn.addEventListener('click', () => this._setBackend(btn)));

        // Dosya yükleme
        const uploadArea = document.getElementById('uploadArea');
        const tifInput = document.getElementById('tifInput');

        uploadArea.addEventListener('click', () => tifInput.click());
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = '#3b82f6';
            uploadArea.style.background = 'rgba(59,130,246,0.08)';
        });
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.style.borderColor = 'rgba(59,130,246,0.4)';
            uploadArea.style.background = 'rgba(59,130,246,0.03)';
        });
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = 'rgba(59,130,246,0.4)';
            uploadArea.style.background = 'rgba(59,130,246,0.03)';
            if (e.dataTransfer.files.length > 0) this._handleFileSelect(e.dataTransfer.files[0]);
        });
        tifInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) this._handleFileSelect(e.target.files[0]);
        });

        // Metod Degisimi
        document.getElementById('methodSelect').addEventListener('change', async () => {
            if (this.currentFile) {
                await this._checkMethodsAndLoad();
            }
        });

        // Analiz ve İndirme
        document.getElementById('btnAnalyze').addEventListener('click', () => this._startAnalysis());
        document.getElementById('btnDownload').addEventListener('click', () => this._downloadResult());
    }

    async _checkMethodsAndLoad() {
        if (!this.currentFile) return;
        const currentMethod = document.getElementById('methodSelect').value;
        const btnCompare = document.getElementById('btnCompare');
        const apiStatusMsg = document.getElementById('apiStatusMsg');
        const btnAnalyze = document.getElementById('btnAnalyze');
        
        // Tüm yöntemleri kontrol et
        this.availableMethods.clear();
        const methods = ["Unet", "DeepLabV3+", "Segformer"];
        
        for (const m of methods) {
            const cacheKey = this.currentFile.name + '_' + this.currentFile.size + '_' + m;
            const cached = await this.cache.load(cacheKey);
            if (cached) this.availableMethods.add(m);
        }
        
        // Karşılaştır butonunu güncelle
        if (btnCompare) {
            if (this.availableMethods.size >= 2) {
                btnCompare.disabled = false;
                btnCompare.title = "Karşılaştırma ekranını aç";
            } else {
                btnCompare.disabled = true;
                btnCompare.title = "Karşılaştırma için en az 2 yöntemi analiz etmelisiniz.";
            }
        }

        // Aktif seçili yöntemi ekrana bas
        const cacheKey = this.currentFile.name + '_' + this.currentFile.size + '_' + currentMethod;
        const cached = await this.cache.load(cacheKey);
        
        if (cached) {
            this.viewer.originalImageB64 = cached.originalImage;
            this.viewer.overlayImageB64 = cached.overlayImage;
            this.viewer.showImage();
            document.getElementById('aiStats').classList.remove('hidden');
            document.getElementById('visionNavSection').classList.remove('hidden');
            document.getElementById('statBg').textContent = cached.stats.Background + '%';
            document.getElementById('statRoad').textContent = cached.stats.Road + '%';
            document.getElementById('statDamage').textContent = cached.stats.Road_Damage + '%';
            document.getElementById('statVehicle').textContent = cached.stats.Vehicle + '%';
            
            if(btnAnalyze) btnAnalyze.disabled = false;
            if(apiStatusMsg) {
                apiStatusMsg.className = 'status-msg success';
                apiStatusMsg.innerHTML = `✅ ${currentMethod} modeli önbellekten yüklendi.`;
            }
            this.viewer.setActiveTab('overlay');
        } else {
            document.getElementById('aiStats').classList.add('hidden');
            document.getElementById('visionNavSection').classList.add('hidden');
            if(btnAnalyze) btnAnalyze.disabled = false; // Analiz yapılabilir
            if(apiStatusMsg) {
                apiStatusMsg.className = 'status-msg';
                apiStatusMsg.innerHTML = `ℹ️ ${currentMethod} modeli için sonuç yok. Analizi başlatabilirsiniz.`;
            }
            this.viewer.setActiveTab('original');
        }
    }

    _setBackend(btn) {
        document.querySelectorAll('.backend-opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const url = btn.dataset.url;
        if (url) {
            this.backendBaseUrl = url;
            document.getElementById('activeBackendUrl').textContent = url;
        }
    }

    async _checkLocalHealth() {
        const dot = document.getElementById('statusLocal');
        try {
            const r = await fetch('http://localhost:8000/api/health', { signal: AbortSignal.timeout(2000) });
            dot.style.color = r.ok ? '#10b981' : '#ef4444';
        } catch { dot.style.color = '#ef4444'; }
    }

    /* ============================================================================
       Dosya Seçimi ve Önizleme
       ============================================================================ */
    async _handleFileSelect(file) {
        this.currentFile = file;
        this.availableMethods.clear();
        document.getElementById('fileName').textContent = file.name;
        document.getElementById('fileSize').textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
        document.getElementById('fileInfo').classList.remove('hidden');

        const btnAnalyze = document.getElementById('btnAnalyze');
        const apiStatusMsg = document.getElementById('apiStatusMsg');
        const aiStats = document.getElementById('aiStats');
        const progressContainer = document.getElementById('progressContainer');
        const imgPlaceholder = document.getElementById('imgPlaceholder');

        btnAnalyze.disabled = true;
        this.viewer.originalImageB64 = null;
        this.viewer.overlayImageB64 = null;
        this.viewer.resetView();

        imgPlaceholder.innerHTML = '<div style="text-align:center">Yükleniyor...</div>';
        imgPlaceholder.classList.remove('hidden');
        document.getElementById('viewerImage').classList.add('hidden');
        document.getElementById('viewerOverlay').classList.add('hidden');
        aiStats.classList.add('hidden');
        progressContainer.style.display = 'none';
        apiStatusMsg.textContent = '';
        this.viewer.setActiveTab('original');

        await this._checkMethodsAndLoad();

        // Sunucudan önizleme al
        apiStatusMsg.innerHTML = 'Önizleme hazırlanıyor...';
        apiStatusMsg.className = 'status-msg';

        const fd = new FormData();
        fd.append('file', file);
        try {
            const res = await fetch(this.backendBaseUrl + '/api/upload-preview', { method: 'POST', body: fd });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            if (data.status === 'success') {
                this.viewer.originalImageB64 = data.preview_image;
                this.viewer.showImage();
                btnAnalyze.disabled = false;
                apiStatusMsg.innerHTML = 'Görüntü hazır. Analize başlayabilirsiniz.';
                apiStatusMsg.className = 'status-msg success';
            }
        } catch (err) {
            console.error('Preview hatası:', err);
            imgPlaceholder.innerHTML = '<div style="text-align:center">Önizleme yüklenemedi. Yine de analiz edebilirsiniz.</div>';
            btnAnalyze.disabled = false;
            apiStatusMsg.innerHTML = '⚠️ Önizleme başarısız. Sunucu çalışıyor mu?';
            apiStatusMsg.className = 'status-msg error';
        }
    }

    /* ============================================================================
       Analiz Başlatma
       ============================================================================ */
    async _startAnalysis() {
        if (!this.currentFile) return;

        const btnAnalyze = document.getElementById('btnAnalyze');
        const btnAnalyzeText = document.getElementById('btnAnalyzeText');
        const progressContainer = document.getElementById('progressContainer');
        const progressText = document.getElementById('progressText');
        const progressBarFill = document.getElementById('progressBarFill');
        const progressDetail = document.getElementById('progressDetail');
        const apiStatusMsg = document.getElementById('apiStatusMsg');
        const aiStats = document.getElementById('aiStats');

        btnAnalyze.disabled = true;
        btnAnalyzeText.textContent = 'Analiz Ediliyor...';
        progressContainer.style.display = 'block';
        progressText.textContent = 'Sunucuya bağlanıyor...';
        progressBarFill.style.width = '0%';
        progressDetail.textContent = '0 / 0 Parça İşlendi';
        apiStatusMsg.textContent = '';
        aiStats.classList.add('hidden');

        const method = document.getElementById('methodSelect').value;

        const fd = new FormData();
        fd.append('file', this.currentFile);
        fd.append('alpha', 1.0);
        fd.append('method', method);

        try {
            const res = await fetch(this.backendBaseUrl + '/api/predict', { method: 'POST', body: fd });
            if (!res.ok) throw new Error('API Hatası: ' + res.status);
            const initData = await res.json();
            const taskId = initData.task_id || this.currentFile.name;

            // İlerleme takibi
            let isComplete = false;
            while (!isComplete) {
                await new Promise(r => setTimeout(r, 1000));
                const progRes = await fetch(this.backendBaseUrl + '/api/progress/' + encodeURIComponent(taskId));
                if (progRes.ok) {
                    const pData = await progRes.json();
                    if (pData.error) throw new Error(pData.status);
                    const cur = pData.current || 0;
                    const tot = pData.total || 1;
                    const pct = Math.min(100, Math.round((cur / tot) * 100));
                    progressText.textContent = (pData.status || '') + ' (%' + pct + ')';
                    progressBarFill.style.width = pct + '%';
                    progressDetail.textContent = cur + ' / ' + tot + ' Parça İşlendi';
                    if (pData.status === "Tamamlandı" || (pct === 100 && pData.status && pData.status.includes("Tamamlandı"))) {
                        isComplete = true;
                    }
                }
            }

            // Sonuçları çek
            const resultRes = await fetch(this.backendBaseUrl + '/api/result/' + encodeURIComponent(taskId));
            if (!resultRes.ok) throw new Error('Sonuç alınamadı: ' + resultRes.status);
            const data = await resultRes.json();

            this.viewer.originalImageB64 = data.original_image;
            this.viewer.overlayImageB64 = data.overlay_image;

            document.getElementById('statBg').textContent = data.stats.Background + '%';
            document.getElementById('statRoad').textContent = data.stats.Road + '%';
            document.getElementById('statDamage').textContent = data.stats.Road_Damage + '%';
            document.getElementById('statVehicle').textContent = data.stats.Vehicle + '%';
            aiStats.classList.remove('hidden');
            document.getElementById('visionNavSection').classList.remove('hidden');

            this.cache.save(this.currentFile.name + '_' + this.currentFile.size + '_' + method, {
                stats: data.stats,
                originalImage: data.original_image,
                overlayImage: data.overlay_image,
            });
            
            // Eger uzak sunucu (Modal) kullaniliyorsa, yerele de kaydet!
            if (!this.backendBaseUrl.includes('localhost') && !this.backendBaseUrl.includes('127.0.0.1')) {
                try {
                    await fetch('http://127.0.0.1:8000/api/save_cache_from_cloud', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            filename: this.currentFile.name,
                            method: method,
                            stats: data.stats,
                            original_b64: data.original_image,
                            overlay_b64: data.overlay_image
                        })
                    });
                    console.log('Bulut sonucu başarıyla yerele yedeklendi!');
                } catch (e) { console.warn("Yerel önbellek yedekleme hatası", e); }
            }
            
            await this._checkMethodsAndLoad(); // Yeniden kontrol et ve karsilastir butonunu guncelle

            progressBarFill.style.width = '100%';
            progressText.textContent = 'Tamamlandı (%100)';
            apiStatusMsg.textContent = 'Analiz başarıyla tamamlandı.';
            apiStatusMsg.className = 'status-msg success';
            this.viewer.setActiveTab('overlay');
            setTimeout(() => { progressContainer.style.display = 'none'; }, 1200);

        } catch (err) {
            console.error(err);
            apiStatusMsg.textContent = 'Bağlantı hatası: ' + err.message;
            apiStatusMsg.className = 'status-msg error';
            progressContainer.style.display = 'none';
        } finally {
            btnAnalyze.disabled = false;
            btnAnalyzeText.textContent = 'Analizi Başlat (PyTorch)';
        }
    }

    /* ============================================================================
       Sonuç İndirme
       ============================================================================ */
    _downloadResult() {
        if (!this.currentFile) return;
        window.open(this.backendBaseUrl + '/api/download/' + encodeURIComponent(this.currentFile.name), '_blank');
    }
}
