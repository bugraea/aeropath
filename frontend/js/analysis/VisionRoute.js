/**
 * VisionRoute.js — Görsel analiz üzerinde piksel tabanlı rota hesaplama.
 *
 * Overlay maskesinden bir grid graf oluşturur, A* ve Dijkstra ile
 * başlangıç-varış arası en iyi yolu bulur, canvas'a çizer.
 */

import { MinHeap, showMapToast } from '../shared/utils.js';

const GRID_STEP = 4; // Performans: 4 pikselde bir düğüm

export class VisionRouteEngine {
    constructor(imageViewer) {
        this.viewer = imageViewer;
        this.planningMode = false;
        this.pointA = null;
        this.pointB = null;
        this.selectedAlgo = 'astar';
        this.graph = null;
        this._noRouteTimer = null;

        this._bindEvents();
    }

    /* ============================================================================
       Rota Planlama Kontrolü
       ============================================================================ */
    start() {
        if (!this.viewer.originalImageB64 || !this.viewer.overlayImageB64) {
            showMapToast('Önce bir görüntüyü analiz etmelisiniz.', 'error');
            return;
        }
        const imgEl = document.getElementById('viewerImage');
        const vCanvas = document.getElementById('visionRouteCanvas');

        const initCanvas = (w, h) => {
            vCanvas.width = w;
            vCanvas.height = h;
            // inline width/height setleme — CSS max-width/max-height/object-fit yeterli
            vCanvas.classList.remove('hidden');
            vCanvas.getContext('2d').clearRect(0, 0, w, h);
        };

        // naturalWidth bazen 0 olabiliyor — fallback olarak overlay'den boyut al
        if (imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
            initCanvas(imgEl.naturalWidth, imgEl.naturalHeight);
        } else {
            const probeImg = new Image();
            probeImg.onload = () => initCanvas(probeImg.naturalWidth, probeImg.naturalHeight);
            probeImg.src = this.viewer.overlayImageB64;
        }

        this.planningMode = 'A';
        this.pointA = null;
        this.pointB = null;

        document.getElementById('visionInfoBar').classList.remove('hidden');
        document.getElementById('visionNavSection').classList.add('hidden');
        document.getElementById('visionPanelRouteSummary').classList.add('hidden');
        document.getElementById('vRibIcon').textContent = '📍';
        document.getElementById('vRibText').textContent = 'Başlangıç noktasını resimde seçin';
        document.getElementById('vRibText').style.color = '';
    }

    cancel() {
        this.planningMode = false;
        this.pointA = null;
        this.pointB = null;
        document.getElementById('visionInfoBar').classList.add('hidden');
        document.getElementById('visionNavSection').classList.remove('hidden');
        this.clear();
    }

    clear() {
        this.planningMode = false;
        this.pointA = null;
        this.pointB = null;
        document.getElementById('visionPanelRouteSummary').classList.add('hidden');
        document.getElementById('visionNavSection').classList.remove('hidden');
        const canvas = document.getElementById('visionRouteCanvas');
        if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    }

    switchAlgo(algo) {
        this.selectedAlgo = algo;
        document.getElementById('vAlgoAstar').classList.toggle('active', algo === 'astar');
        document.getElementById('vAlgoDijkstra').classList.toggle('active', algo === 'dijkstra');
        this._recompute();
    }

    /* ============================================================================
       Piksel Grafiği Oluşturma
       ============================================================================ */
    _buildGraph() {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onerror = () => reject(new Error('Overlay görüntüsü yüklenemedi. Lütfen tekrar analiz yapın.'));
            img.onload = () => {
                const w = img.width, h = img.height;
                if (w === 0 || h === 0) { reject(new Error('Görüntü boyutu geçersiz (0×0).')); return; }
                const c = document.createElement('canvas');
                c.width = w; c.height = h;
                const ctx2d = c.getContext('2d');
                ctx2d.drawImage(img, 0, 0);
                let imgData;
                try {
                    imgData = ctx2d.getImageData(0, 0, w, h).data;
                } catch (secErr) {
                    reject(new Error('Canvas güvenlik hatası: Görüntü çapraz kaynaklı olabilir.'));
                    return;
                }

                const nodes = {}, adj = {};
                const COST = { road: 1.0, damage: Infinity, vehicle: Infinity };

                function pixelCost(x, y) {
                    if (x < 0 || y < 0 || x >= w || y >= h) return Infinity;
                    const i = (y * w + x) * 4;
                    const r = imgData[i], g = imgData[i + 1], b = imgData[i + 2], a = imgData[i + 3];
                    if (a < 50) return Infinity;
                    if (r > 180 && g < 80 && b < 80) return COST.damage;
                    if (r < 60 && g > 180 && b < 60) return COST.vehicle;
                    return COST.road;
                }

                function pathIsClear(x1, y1, x2, y2) {
                    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
                    for (let s = 1; s < steps; s++) {
                        if (pixelCost(Math.round(x1 + (x2 - x1) * s / steps), Math.round(y1 + (y2 - y1) * s / steps)) === Infinity) return false;
                    }
                    return true;
                }

                const step = GRID_STEP;
                const DIRS = [
                    { dx: step, dy: 0, d: step }, { dx: -step, dy: 0, d: step },
                    { dx: 0, dy: step, d: step }, { dx: 0, dy: -step, d: step },
                    { dx: step, dy: step, d: step * 1.414 }, { dx: -step, dy: step, d: step * 1.414 },
                    { dx: step, dy: -step, d: step * 1.414 }, { dx: -step, dy: -step, d: step * 1.414 },
                ];

                for (let y = 0; y < h; y += step) {
                    for (let x = 0; x < w; x += step) {
                        const cost = pixelCost(x, y);
                        if (cost === Infinity) continue;
                        const k = x + ',' + y;
                        if (!nodes[k]) nodes[k] = { x, y };
                        if (!adj[k]) adj[k] = [];

                        for (const dir of DIRS) {
                            const nx = x + dir.dx, ny = y + dir.dy;
                            const nc = pixelCost(nx, ny);
                            if (nc === Infinity) continue;
                            if (!pathIsClear(x, y, nx, ny)) continue;
                            const nk = nx + ',' + ny;
                            if (!nodes[nk]) nodes[nk] = { x: nx, y: ny };
                            if (!adj[nk]) adj[nk] = [];
                            const w2 = dir.d * (cost + nc) / 2.0;
                            adj[k].push({ to: nk, weight: w2 });
                            adj[nk].push({ to: k, weight: w2 });
                        }
                    }
                }
                this.graph = { nodes, adj, w, h };
                resolve(this.graph);
            };
            img.src = this.viewer.overlayImageB64;
        });
    }

    _nearestNode(gx, gy) {
        if (!this.graph) return null;
        let bestKey = null, bestDist = Infinity;
        const keys = Object.keys(this.graph.nodes);
        for (let i = 0; i < keys.length; i++) {
            const n = this.graph.nodes[keys[i]];
            const d = (n.x - gx) ** 2 + (n.y - gy) ** 2;
            if (d < bestDist) { bestDist = d; bestKey = keys[i]; }
        }
        return bestKey;
    }

    /* ============================================================================
       A* ve Dijkstra
       ============================================================================ */
    _aStar(startKey, goalKey) {
        const goal = this.graph.nodes[goalKey];
        const t0 = performance.now();
        const h = (k) => {
            const n = this.graph.nodes[k];
            return Math.sqrt((n.x - goal.x) ** 2 + (n.y - goal.y) ** 2);
        };
        const open = new MinHeap((a, b) => a.f - b.f);
        open.push({ key: startKey, f: h(startKey), g: 0 });
        const gScore = { [startKey]: 0 }, prev = {}, closed = new Set();

        while (open.size > 0) {
            const cur = open.pop();
            if (closed.has(cur.key)) continue;
            if (cur.key === goalKey) {
                const path = []; let c = goalKey;
                while (c) { path.unshift(this.graph.nodes[c]); c = prev[c]; }
                return { path, nodesVisited: closed.size, timeMs: (performance.now() - t0).toFixed(2), cost: Math.round(gScore[goalKey]) };
            }
            closed.add(cur.key);
            for (const edge of (this.graph.adj[cur.key] || [])) {
                if (closed.has(edge.to)) continue;
                const tentG = gScore[cur.key] + edge.weight;
                if (gScore[edge.to] === undefined || tentG < gScore[edge.to]) {
                    gScore[edge.to] = tentG; prev[edge.to] = cur.key;
                    open.push({ key: edge.to, f: tentG + h(edge.to), g: tentG });
                }
            }
        }
        return { path: null, nodesVisited: closed.size, timeMs: (performance.now() - t0).toFixed(2), cost: 0 };
    }

    _dijkstra(startKey, goalKey) {
        const t0 = performance.now();
        const open = new MinHeap((a, b) => a.g - b.g);
        open.push({ key: startKey, g: 0 });
        const gScore = { [startKey]: 0 }, prev = {}, closed = new Set();

        while (open.size > 0) {
            const cur = open.pop();
            if (closed.has(cur.key)) continue;
            if (cur.key === goalKey) {
                const path = []; let c = goalKey;
                while (c) { path.unshift(this.graph.nodes[c]); c = prev[c]; }
                return { path, nodesVisited: closed.size, timeMs: (performance.now() - t0).toFixed(2), cost: Math.round(gScore[goalKey]) };
            }
            closed.add(cur.key);
            for (const edge of (this.graph.adj[cur.key] || [])) {
                if (closed.has(edge.to)) continue;
                const tentG = gScore[cur.key] + edge.weight;
                if (gScore[edge.to] === undefined || tentG < gScore[edge.to]) {
                    gScore[edge.to] = tentG; prev[edge.to] = cur.key;
                    open.push({ key: edge.to, g: tentG });
                }
            }
        }
        return { path: null, nodesVisited: closed.size, timeMs: (performance.now() - t0).toFixed(2), cost: 0 };
    }

    /* ============================================================================
       Rota Hesaplama ve Çizim
       ============================================================================ */
    async _recompute() {
        document.getElementById('visionInfoBar').classList.remove('hidden');
        document.getElementById('vRibIcon').textContent = '⚙️';
        document.getElementById('vRibText').textContent = 'Piksel grafiği oluşturuluyor ve rota hesaplanıyor...';

        try {
            await this._buildGraph();
            await new Promise(r => setTimeout(r, 20));

            const startKey = this._nearestNode(this.pointA.x, this.pointA.y);
            const goalKey = this._nearestNode(this.pointB.x, this.pointB.y);

            if (!startKey || !goalKey) {
                this._showNoRoute('Seçilen nokta geçerli bir yol alanında değil. Mavi piksellere tıklayın.');
                this.cancel();
                return;
            }

            const resAstar = this._aStar(startKey, goalKey);
            const resDijkstra = this._dijkstra(startKey, goalKey);
            const chosen = this.selectedAlgo === 'astar' ? resAstar : resDijkstra;

            document.getElementById('visionInfoBar').classList.add('hidden');
            document.getElementById('visionPanelRouteSummary').classList.remove('hidden');

            if (!chosen.path || chosen.path.length < 5 || chosen.cost === 0) {
                this._showNoRoute('İki nokta arasında geçilebilir yol bulunamadı.');
                this.clear();
                return;
            }

            this._drawRoute(chosen);
            this._updateStats(resAstar, resDijkstra);
        } catch (err) {
            console.error('Rota hesaplama hatası:', err);
            // Hata durumunda bilgi çubuğunu gizle, navigasyon bölümünü geri getir
            document.getElementById('visionInfoBar').classList.add('hidden');
            document.getElementById('visionNavSection').classList.remove('hidden');
            showMapToast('⚠️ ' + err.message, 'error');
        }
    }

    _drawRoute(chosen) {
        const canvas = document.getElementById('visionRouteCanvas');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const scaleFactor = Math.max(1, canvas.width / 1200);
        const pinRadius = 4 * scaleFactor;

        // Rota çizgisi
        ctx.beginPath();
        ctx.moveTo(chosen.path[0].x, chosen.path[0].y);
        for (let i = 1; i < chosen.path.length; i++) ctx.lineTo(chosen.path[i].x, chosen.path[i].y);
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.95)';
        ctx.lineWidth = Math.max(2, 2 * scaleFactor);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.shadowColor = 'rgba(250, 204, 21, 0.6)';
        ctx.shadowBlur = Math.min(6, 3 * scaleFactor);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // İç çizgi
        ctx.strokeStyle = 'rgba(255, 240, 100, 0.8)';
        ctx.lineWidth = Math.max(1, 0.6 * scaleFactor);
        ctx.stroke();

        // Başlangıç / Bitiş pinleri
        [[this.pointA, '#10B981'], [this.pointB, '#EF4444']].forEach(([pt, color]) => {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, pinRadius, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = 'white';
            ctx.lineWidth = Math.max(1, 2 * scaleFactor);
            ctx.stroke();
        });
    }

    _updateStats(resAstar, resDijkstra) {
        const totalPx = (this.selectedAlgo === 'astar' ? resAstar : resDijkstra).cost;
        document.getElementById('vRsDistance').textContent = ((totalPx * 0.15) / 1000).toFixed(1) + ' km';
        document.getElementById('vRsBlocked').textContent = 'Yok (Engellerden Kaçındı)';

        document.getElementById('vCmpNodesAstar').textContent = resAstar.nodesVisited.toLocaleString();
        document.getElementById('vCmpNodesDijkstra').textContent = resDijkstra.nodesVisited.toLocaleString();
        document.getElementById('vCmpTimeAstar').textContent = resAstar.timeMs + 'ms';
        document.getElementById('vCmpTimeDijkstra').textContent = resDijkstra.timeMs + 'ms';
        document.getElementById('vCmpCostAstar').textContent = resAstar.cost.toLocaleString();
        document.getElementById('vCmpCostDijkstra').textContent = resDijkstra.cost.toLocaleString();
        document.getElementById('visionRsAlgoBadge').textContent = (this.selectedAlgo === 'astar' ? 'A*' : 'Dijkstra') + ' Rota Hazır';

        const nodePct = resDijkstra.nodesVisited > 0 ? Math.round((1 - resAstar.nodesVisited / resDijkstra.nodesVisited) * 100) : 0;
        const sameRoute = resAstar.cost === resDijkstra.cost ? 'Aynı optimal rota.' : 'Farklı rota maliyeti.';
        const timeExp = parseFloat(resAstar.timeMs) > parseFloat(resDijkstra.timeMs)
            ? 'Dijkstra daha hızlıydı çünkü A*\'ın öngörü matematiği ağır bastı.'
            : 'A* hedefe yönelik öngörüsü sayesinde gereksiz binlerce pikseli taramaktan kaçındı.';
        document.getElementById('vCmpSummary').textContent = 'A* ' + (nodePct > 0 ? nodePct + '% daha az düğüm taradı. ' : '') + sameRoute + ' ' + timeExp;
    }

    /* ============================================================================
       Resim Tıklama (A/B noktası seçimi)
       ============================================================================ */
    _bindEvents() {
        document.getElementById('viewerImage').addEventListener('mousedown', (e) => {
            if (!this.planningMode) return;
            const target = e.target;
            // naturalWidth bazen 0 olabilir — canvas boyutunu fallback olarak kullan
            const vCanvas = document.getElementById('visionRouteCanvas');
            let natW = target.naturalWidth, natH = target.naturalHeight;
            if (natW === 0 || natH === 0) {
                if (vCanvas && vCanvas.width > 0) { natW = vCanvas.width; natH = vCanvas.height; }
                else return;
            }
            const elW = target.offsetWidth, elH = target.offsetHeight;
            const ratio = natW / natH, renderedRatio = elW / elH;

            let renderW = elW, renderH = elH;
            if (ratio > renderedRatio) renderH = elW / ratio;
            else renderW = elH * ratio;

            const padX = (elW - renderW) / 2, padY = (elH - renderH) / 2;
            if (e.offsetX < padX || e.offsetX > elW - padX) return;
            if (e.offsetY < padY || e.offsetY > elH - padY) return;

            const imgX = ((e.offsetX - padX) / renderW) * natW;
            const imgY = ((e.offsetY - padY) / renderH) * natH;
            if (imgX < 0 || imgY < 0 || imgX > natW || imgY > natH) return;

            const scaleFactor = Math.max(1, natW / 1200);
            const pinRadius = 4 * scaleFactor;
            const ctx = vCanvas.getContext('2d');

            if (this.planningMode === 'A') {
                this.pointA = { x: imgX, y: imgY };
                this.planningMode = 'B';
                document.getElementById('vRibText').textContent = 'Varış noktasını resimde seçin';
                document.getElementById('vRibIcon').textContent = '🎯';
                ctx.beginPath(); ctx.arc(imgX, imgY, pinRadius, 0, 2 * Math.PI);
                ctx.fillStyle = '#10B981'; ctx.fill();
                ctx.strokeStyle = 'white'; ctx.lineWidth = Math.max(1, 2 * scaleFactor); ctx.stroke();
            } else if (this.planningMode === 'B') {
                this.pointB = { x: imgX, y: imgY };
                this.planningMode = false;
                ctx.beginPath(); ctx.arc(imgX, imgY, pinRadius, 0, 2 * Math.PI);
                ctx.fillStyle = '#EF4444'; ctx.fill();
                ctx.strokeStyle = 'white'; ctx.lineWidth = Math.max(1, 2 * scaleFactor); ctx.stroke();
                this._recompute();
            }
        });
    }

    /* ============================================================================
       Rota Bulunamadı Uyarısı
       ============================================================================ */
    _showNoRoute(msg) {
        const overlay = document.getElementById('visionNoRouteOverlay');
        const msgEl = document.getElementById('visionNoRouteMsg');
        if (msgEl) msgEl.textContent = msg || 'İki nokta arasında geçilebilir yol bulunamadı.';
        if (overlay) { overlay.classList.remove('hidden'); overlay.style.display = 'flex'; }
        clearTimeout(this._noRouteTimer);
        this._noRouteTimer = setTimeout(() => this._hideNoRoute(), 4000);
    }

    _hideNoRoute() {
        clearTimeout(this._noRouteTimer);
        const overlay = document.getElementById('visionNoRouteOverlay');
        if (overlay) { overlay.style.display = 'none'; overlay.classList.add('hidden'); }
    }
}
