/**
 * ImageViewer.js — Görüntü görüntüleyici: zoom, pan, sekme yönetimi.
 */

export class ImageViewer {
    constructor() {
        this.zoomLevel = 1;
        this.panX = 0;
        this.panY = 0;
        this.isDragging = false;
        this.startX = 0;
        this.startY = 0;

        this.ZOOM_STEP = 0.25;
        this.ZOOM_MIN = 0.5;
        this.ZOOM_MAX = 6;

        this.activeTab = 'original';
        this.originalImageB64 = null;
        this.overlayImageB64 = null;

        this._bindEvents();
    }

    /* ============================================================================
       Görüntü Gösterim
       ============================================================================ */
    showImage() {
        const viewerImage = document.getElementById('viewerImage');
        const viewerOverlay = document.getElementById('viewerOverlay');
        const imgPlaceholder = document.getElementById('imgPlaceholder');
        if (!this.originalImageB64) return;

        viewerImage.src = this.originalImageB64;
        viewerImage.classList.remove('hidden');
        imgPlaceholder.classList.add('hidden');

        if (this.overlayImageB64 && this.activeTab === 'overlay') {
            viewerOverlay.src = this.overlayImageB64;
            viewerOverlay.classList.remove('hidden');
        } else {
            viewerOverlay.classList.add('hidden');
        }
    }

    setActiveTab(tab) {
        this.activeTab = tab;
        const tabOriginal = document.getElementById('tabOriginal');
        const tabOverlay = document.getElementById('tabOverlay');
        if (tab === 'original') {
            tabOriginal.classList.add('active');
            tabOverlay.classList.remove('active');
        } else {
            tabOverlay.classList.add('active');
            tabOriginal.classList.remove('active');
        }
        this.showImage();
    }

    resetView() {
        this.zoomLevel = 1;
        this.panX = 0;
        this.panY = 0;
        this._applyTransform();
    }

    /* ============================================================================
       Transform
       ============================================================================ */
    _applyTransform() {
        const viewerImage = document.getElementById('viewerImage');
        const viewerOverlay = document.getElementById('viewerOverlay');
        const transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;
        viewerImage.style.transform = transform;
        viewerOverlay.style.transform = transform;
        const vCanvas = document.getElementById('visionRouteCanvas');
        if (vCanvas) vCanvas.style.transform = transform;
    }

    /* ============================================================================
       Olay Bağlama
       ============================================================================ */
    _bindEvents() {
        const tabOriginal = document.getElementById('tabOriginal');
        const tabOverlay = document.getElementById('tabOverlay');
        tabOriginal.addEventListener('click', () => this.setActiveTab('original'));
        tabOverlay.addEventListener('click', () => this.setActiveTab('overlay'));

        document.getElementById('zoomIn').addEventListener('click', () => {
            this.zoomLevel = Math.min(this.ZOOM_MAX, +(this.zoomLevel + this.ZOOM_STEP).toFixed(2));
            this._applyTransform();
        });
        document.getElementById('zoomOut').addEventListener('click', () => {
            this.zoomLevel = Math.max(this.ZOOM_MIN, +(this.zoomLevel - this.ZOOM_STEP).toFixed(2));
            this._applyTransform();
        });
        document.getElementById('zoomReset').addEventListener('click', () => this.resetView());

        const viewerContent = document.getElementById('viewerContent');
        viewerContent.addEventListener('wheel', (e) => {
            const viewerImage = document.getElementById('viewerImage');
            if (viewerImage.classList.contains('hidden')) return;
            e.preventDefault();
            const delta = e.deltaY < 0 ? this.ZOOM_STEP : -this.ZOOM_STEP;
            this.zoomLevel = Math.min(this.ZOOM_MAX, Math.max(this.ZOOM_MIN, +(this.zoomLevel + delta).toFixed(2)));
            this._applyTransform();
        }, { passive: false });

        viewerContent.addEventListener('mousedown', (e) => {
            const viewerImage = document.getElementById('viewerImage');
            if (viewerImage.classList.contains('hidden') || this.zoomLevel <= 1) return;
            e.preventDefault();
            this.isDragging = true;
            this.startX = e.clientX - this.panX;
            this.startY = e.clientY - this.panY;
            viewerContent.style.cursor = 'grabbing';
        });

        viewerContent.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            e.preventDefault();
            this.panX = e.clientX - this.startX;
            this.panY = e.clientY - this.startY;
            this._applyTransform();
        });

        const stopDrag = () => { this.isDragging = false; viewerContent.style.cursor = 'grab'; };
        viewerContent.addEventListener('mouseup', stopDrag);
        viewerContent.addEventListener('mouseleave', stopDrag);

        const alphaRange = document.getElementById('alphaRange');
        const alphaVal = document.getElementById('alphaVal');
        alphaRange.addEventListener('input', (e) => {
            const val = (e.target.value / 100).toFixed(2);
            alphaVal.textContent = val;
            document.getElementById('viewerOverlay').style.opacity = val;
        });
    }
}
