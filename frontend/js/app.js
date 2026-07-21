/**
 * app.js — AeroPath Dashboard ana giriş noktası.
 *
 * Tüm modülleri import eder, sayfa yönlendirmesi, saat,
 * kapsama grafiği, log listesi, ayarlar ve klavye kısayollarını yönetir.
 */

import { LiveMapManager } from './map/LiveMap.js';
import { MapRouteEngine } from './map/RouteEngine.js';
import { ImageViewer } from './analysis/ImageViewer.js';
import { ImageAnalyzer } from './analysis/ImageAnalyzer.js';
import { VisionRouteEngine } from './analysis/VisionRoute.js';

/* ============================================================================
   Modül Örnekleri
   ============================================================================ */
const liveMap = new LiveMapManager();
const routeEngine = new MapRouteEngine(liveMap);
const imageViewer = new ImageViewer();
const imageAnalyzer = new ImageAnalyzer(imageViewer);
const visionRoute = new VisionRouteEngine(imageViewer);

/* ============================================================================
   Sayfa Yönlendirme (SPA Router)
   ============================================================================ */
const pages = {
    dashboard: document.getElementById('pageDashboard'),
    livemap:   document.getElementById('pageLivemap'),
    settings:  document.getElementById('pageSettings'),
    tif:       document.getElementById('pageTif'),
};
const navItems = document.querySelectorAll('.nav-item[data-page]');
let currentPage = 'dashboard';

function navigateTo(page) {
    if (!pages[page]) return;
    Object.values(pages).forEach(p => p.classList.add('hidden'));
    navItems.forEach(n => n.classList.remove('active'));
    pages[page].classList.remove('hidden');
    document.querySelector(`[data-page="${page}"]`).classList.add('active');
    currentPage = page;
    if (page === 'livemap') {
        liveMap.init();
        // double-rAF: DOM'un yeni layout'u hesaplamasını bekle, sonra resize yap
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (liveMap.mapInstance) liveMap.mapInstance.resize();
            });
        });
    }
    if (page === 'dashboard') drawChart();
}

navItems.forEach(n => n.addEventListener('click', e => { e.preventDefault(); navigateTo(n.dataset.page); }));

/* ============================================================================
   Saat
   ============================================================================ */
const updateTimeEl = document.getElementById('updateTime');
function updateClock() {
    if (updateTimeEl) updateTimeEl.textContent = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
updateClock();
setInterval(updateClock, 1000);

/* ============================================================================
   Kapsama Grafiği (Coverage Chart)
   ============================================================================ */
function drawChart() {
    const canvas = document.getElementById('coverageChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const labels = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'];
    const data = [12, 34, 52, 68, 81, 87];
    const maxVal = 100;
    const padL = 38, padB = 24, padT = 10, padR = 12;
    const chartW = W - padL - padR, chartH = H - padT - padB;

    // Grid çizgileri
    ctx.strokeStyle = 'rgba(59,130,246,0.08)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
        const y = padT + chartH * (1 - i / 4);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
        ctx.fillStyle = '#475569'; ctx.font = '10px Inter'; ctx.textAlign = 'right';
        ctx.fillText((maxVal * i / 4) + '%', padL - 6, y + 3);
    }

    // Alan gradyanı
    const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH);
    grad.addColorStop(0, 'rgba(59,130,246,0.25)');
    grad.addColorStop(1, 'rgba(59,130,246,0.01)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(padL, padT + chartH);
    data.forEach((v, i) => {
        const x = padL + (chartW / (data.length - 1)) * i;
        const y = padT + chartH * (1 - v / maxVal);
        ctx.lineTo(x, y);
    });
    ctx.lineTo(padL + chartW, padT + chartH);
    ctx.closePath(); ctx.fill();

    // Çizgi
    ctx.strokeStyle = '#3B82F6'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    data.forEach((v, i) => {
        const x = padL + (chartW / (data.length - 1)) * i;
        const y = padT + chartH * (1 - v / maxVal);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Noktalar + etiketler
    data.forEach((v, i) => {
        const x = padL + (chartW / (data.length - 1)) * i;
        const y = padT + chartH * (1 - v / maxVal);
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#3B82F6'; ctx.fill();
        ctx.strokeStyle = '#0F172A'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#64748B'; ctx.font = '9px Inter'; ctx.textAlign = 'center';
        ctx.fillText(labels[i], x, padT + chartH + 14);
    });
}
drawChart();

/* ============================================================================
   Log Listesi
   ============================================================================ */
(function populateLog() {
    const logList = document.getElementById('logList');
    if (!logList) return;
    const logs = [
        { time: '18:42', text: 'İHA-01 bağlantısı yenilendi', type: 'success' },
        { time: '18:37', text: 'Yol analizi tamamlandı — 3 hasar tespit', type: 'warning' },
        { time: '18:30', text: 'İHA-03 düşük batarya uyarısı', type: 'error' },
        { time: '18:22', text: 'Görev güncellendi: Kadirli sektörü', type: 'info' },
        { time: '18:15', text: 'OSM yol verisi güncellendi', type: 'success' },
    ];
    logs.forEach(l => {
        const dots = { success: '#10B981', warning: '#F59E0B', error: '#EF4444', info: '#3B82F6' };
        const li = document.createElement('li');
        li.className = 'log-item';
        li.innerHTML = `<span class="log-dot" style="background:${dots[l.type]}"></span>
            <span class="log-time">${l.time}</span><span class="log-text">${l.text}</span>`;
        logList.appendChild(li);
    });
})();

/* ============================================================================
   Ayarlar
   ============================================================================ */
const confRange = document.getElementById('confRange');
const confVal = document.getElementById('confVal');
if (confRange) confRange.addEventListener('input', () => { confVal.textContent = confRange.value + '%'; });

const btnSave = document.getElementById('btnSaveSettings');
if (btnSave) btnSave.addEventListener('click', function () {
    this.textContent = 'Kaydedildi ✓';
    this.style.background = 'linear-gradient(135deg,#10B981,#059669)';
    const self = this;
    setTimeout(() => { self.textContent = 'Değişiklikleri Kaydet'; self.style.background = ''; }, 2000);
});

/* ============================================================================
   Klavye Kısayolları
   ============================================================================ */
document.addEventListener('keydown', (e) => {
    if (e.key === '/') { e.preventDefault(); document.getElementById('searchInput').focus(); }
});

/* ============================================================================
   Redistribute Butonu
   ============================================================================ */
const btnRedist = document.getElementById('btnRedistribute');
if (btnRedist) btnRedist.addEventListener('click', () => liveMap.redistribute());

/* ============================================================================
   Global Bağlamalar (HTML onclick erişimi için)
   ============================================================================ */
window.app = {
    liveMap, routeEngine, imageViewer, imageAnalyzer, visionRoute
};
window.navigateTo = navigateTo;

// Harita Navigasyon
window.selectAlgo = (algo) => routeEngine.selectAlgo(algo);
window.startRoutePlanning = () => routeEngine.startPlanning();
window.cancelRoutePlanning = () => routeEngine.cancelPlanning();
window.clearRoute = () => routeEngine.clearRoute();
window.backFromRouteSummary = () => routeEngine.backFromSummary();
window.switchRouteType = (type) => routeEngine.switchRouteType(type);
window.switchAlgoAndReroute = (algo) => routeEngine.switchAlgoAndReroute(algo);

// Görsel Analiz Navigasyon
window.startVisionRoutePlanning = () => visionRoute.start();
window.cancelVisionRoutePlanning = () => visionRoute.cancel();
window.clearVisionRoute = () => visionRoute.clear();
window.switchVisionAlgoAndReroute = (algo) => visionRoute.switchAlgo(algo);
window.hideVisionNoRoute = () => visionRoute._hideNoRoute();

// Yol durumu değiştirici (popup'tan çağrılır)
window._setRoadStatus = (osmId, newStatus) => {
    liveMap.roadStatusOverrides.set(String(osmId), newStatus);
    liveMap._updateRoadColors();
};

/* ============================================================================
   Başlangıç
   ============================================================================ */
navigateTo('dashboard');
