/**
 * RouteEngine.js — Harita üzerinde yol-tabanlı rota hesaplama.
 *
 * GeoJSON yol segmentlerinden graf oluşturur, A* ve Dijkstra ile
 * en kısa yolu bulur, haritada çizer.
 */

import { distMeters, pointToSegmentDist, showMapToast } from '../shared/utils.js';

export class MapRouteEngine {
    constructor(liveMapManager) {
        this.lm = liveMapManager;

        this.routePlanningMode = false;
        this.routePointA = null;
        this.routePointB = null;
        this.selectedAlgo = 'astar';
        this.routeType = 'default';
        this.routeMarkers = [];

        // RouteEngine tıklamayı LiveMap'ten yakalıyor
        liveMapManager._onRouteClick = (lngLat) => this._handleClick(lngLat);
    }

    /* ============================================================================
       Kullanıcı İşlemleri
       ============================================================================ */
    selectAlgo(algo) {
        this.selectedAlgo = algo;
        const a = document.getElementById('prsAlgoAstar');
        const d = document.getElementById('prsAlgoDijkstra');
        if (a) a.classList.toggle('active', algo === 'astar');
        if (d) d.classList.toggle('active', algo === 'dijkstra');
    }

    startPlanning() {
        if (this.routePlanningMode) return;
        this.clearRoute();
        this.routePlanningMode = 'A';
        this._setInfoBar('📍', 'Başlangıç noktasını haritada seçin', true);
        if (this.lm.mapInstance) this.lm.mapInstance.getCanvas().style.cursor = 'crosshair';
    }

    cancelPlanning() {
        this.routePlanningMode = false;
        this._setInfoBar('', '', false);
        if (this.lm.mapInstance) this.lm.mapInstance.getCanvas().style.cursor = '';
        this._clearMarkers();
        this._showPanel();
    }

    clearRoute() {
        this._clearMarkers();
        document.getElementById('routeSummary').classList.add('hidden');
        const map = this.lm.mapInstance;
        if (map) {
            ['route-glow', 'route-line'].forEach(id => {
                if (map.getLayer(id)) map.removeLayer(id);
            });
            if (map.getSource('route-path')) map.removeSource('route-path');
        }
        this.cancelPlanning();
    }

    switchRouteType(type) {
        this.routeType = type;
        const d = document.getElementById('rtypeDefault');
        const o = document.getElementById('rtypeOptimized');
        if (d) d.classList.toggle('active', type === 'default');
        if (o) o.classList.toggle('active', type === 'optimized');
        if (this.routePointA && this.routePointB) this._computeAndRender();
    }

    switchAlgoAndReroute(algo) {
        this.selectAlgo(algo);
        if (this.routePointA && this.routePointB) this._computeAndRender();
    }

    backFromSummary() {
        this.clearRoute();
    }

    /* ============================================================================
       Harita Tıklama Yakalama
       ============================================================================ */
    _handleClick(lngLat) {
        if (!this.routePlanningMode) return false;

        const lat = lngLat.lat, lng = lngLat.lng;

        // Tıklanan noktaya en yakın yol segmentinin durumunu kontrol et
        const nearest = this._nearestSegmentStatus(lat, lng);
        if (nearest.status === 'blocked') {
            this._showBlockedWarning();
            return true;
        }

        if (this.routePlanningMode === 'A') {
            this.routePointA = { lat, lng };
            this._addPin(lng, lat, 'start');
            this.routePlanningMode = 'B';
            this._setInfoBar('🎯', 'Varış noktasını haritada seçin', true);
            return true;
        }

        if (this.routePlanningMode === 'B') {
            this.routePointB = { lat, lng };
            this._addPin(lng, lat, 'end');
            this.routePlanningMode = false;
            this._setInfoBar('⚙️', 'Rota hesaplanıyor...', true);
            if (this.lm.mapInstance) this.lm.mapInstance.getCanvas().style.cursor = '';
            setTimeout(() => this._computeAndRender(), 80);
            return true;
        }
        return false;
    }

    /* ============================================================================
       Graf İnşası — orijinal dashboard.js buildGraphForType ile birebir aynı mantık
       coordKey: lat,lng sırası (orijinaldeki gibi c[1].toFixed(6)+','+c[0].toFixed(6))
       ============================================================================ */
    _coordKey(c) {
        // c = [lng, lat] (GeoJSON formatı)
        return c[1].toFixed(6) + ',' + c[0].toFixed(6);
    }

    _buildGraph(features, routeType) {
        const nodes = {}, adj = {};
        const COST = routeType === 'optimized'
            ? { open: 1.0, unknown: 2.5, blocked: 8.0 }
            : { open: 1.0, unknown: 1.0, blocked: 1.0 };

        features.forEach(f => {
            const coords = f.geometry.coordinates;
            const status = (f.properties && f.properties.status) || 'open';

            // Engel kaçınan modda kırmızı yollar graftan tamamen çıkarılır
            if (routeType === 'optimized' && status === 'blocked') return;

            const costMul = COST[status] || 1.0;

            for (let i = 0; i < coords.length; i++) {
                const k = this._coordKey(coords[i]);
                if (!nodes[k]) nodes[k] = { lat: coords[i][1], lng: coords[i][0] };
                if (!adj[k]) adj[k] = [];
            }
            for (let j = 0; j < coords.length - 1; j++) {
                const kA = this._coordKey(coords[j]);
                const kB = this._coordKey(coords[j + 1]);
                const d = distMeters(coords[j][1], coords[j][0], coords[j + 1][1], coords[j + 1][0]);
                const w = d * costMul;
                adj[kA].push({ to: kB, dist: d, weight: w, status });
                adj[kB].push({ to: kA, dist: d, weight: w, status });
            }
        });
        return { nodes, adj };
    }

    _nearestNode(graph, lat, lng) {
        let best = null, bestD = Infinity;
        Object.keys(graph.nodes).forEach(k => {
            const n = graph.nodes[k];
            const d = distMeters(lat, lng, n.lat, n.lng);
            if (d < bestD) { bestD = d; best = k; }
        });
        return best;
    }

    /* ============================================================================
       A* Algoritması
       ============================================================================ */
    _aStar(graph, startKey, goalKey) {
        const goalNode = graph.nodes[goalKey];
        const t0 = performance.now();
        const cosLat = Math.cos(goalNode.lat * Math.PI / 180);

        function h(key) {
            const n = graph.nodes[key];
            const dx = (n.lng - goalNode.lng) * cosLat * 111320;
            const dy = (n.lat - goalNode.lat) * 111320;
            return Math.sqrt(dx * dx + dy * dy);
        }

        const open = [{ key: startKey, f: h(startKey), g: 0 }];
        const gScore = { [startKey]: 0 };
        const prev = {};
        const closed = new Set();

        while (open.length) {
            open.sort((a, b) => a.f - b.f);
            const cur = open.shift();
            if (cur.key === goalKey) {
                const path = this._reconstructPath(prev, goalKey);
                return { path, nodesVisited: closed.size, cost: Math.round(gScore[goalKey] || 0), timeMs: (performance.now() - t0).toFixed(2) };
            }
            if (closed.has(cur.key)) continue;
            closed.add(cur.key);
            (graph.adj[cur.key] || []).forEach(edge => {
                if (closed.has(edge.to)) return;
                const tentG = (gScore[cur.key] || 0) + edge.weight;
                if (tentG < (gScore[edge.to] !== undefined ? gScore[edge.to] : Infinity)) {
                    gScore[edge.to] = tentG;
                    prev[edge.to] = cur.key;
                    open.push({ key: edge.to, f: tentG + h(edge.to), g: tentG });
                }
            });
        }
        return { path: null, nodesVisited: closed.size, cost: 0, timeMs: (performance.now() - t0).toFixed(2) };
    }

    /* ============================================================================
       Dijkstra Algoritması
       ============================================================================ */
    _dijkstra(graph, startKey, goalKey) {
        const t0 = performance.now();
        const dist = { [startKey]: 0 };
        const prev = {};
        const open = [{ key: startKey, d: 0 }];
        const closed = new Set();

        while (open.length) {
            open.sort((a, b) => a.d - b.d);
            const cur = open.shift();
            if (cur.key === goalKey) {
                const path = this._reconstructPath(prev, goalKey);
                return { path, nodesVisited: closed.size, cost: Math.round(dist[goalKey] || 0), timeMs: (performance.now() - t0).toFixed(2) };
            }
            if (closed.has(cur.key)) continue;
            closed.add(cur.key);
            (graph.adj[cur.key] || []).forEach(edge => {
                if (closed.has(edge.to)) return;
                const nd = (dist[cur.key] || 0) + edge.weight;
                if (nd < (dist[edge.to] !== undefined ? dist[edge.to] : Infinity)) {
                    dist[edge.to] = nd;
                    prev[edge.to] = cur.key;
                    open.push({ key: edge.to, d: nd });
                }
            });
        }
        return { path: null, nodesVisited: closed.size, cost: 0, timeMs: (performance.now() - t0).toFixed(2) };
    }

    _reconstructPath(prev, goal) {
        const path = [];
        let cur = goal;
        while (cur !== undefined) { path.unshift(cur); cur = prev[cur]; }
        return path.length > 1 ? path : null;
    }

    /* ============================================================================
       Rota Hesaplama ve Çizim
       ============================================================================ */
    _computeAndRender() {
        const features = this.lm.cachedColoredFeatures || this.lm.cachedOverpassFeatures;
        if (!features || !this.routePointA || !this.routePointB) {
            showMapToast('⚠️ Önce yol verileri yüklenmelidir.', 'error');
            this._setInfoBar('', '', false);
            return;
        }

        const graph = this._buildGraph(features, this.routeType || 'default');
        const startKey = this._nearestNode(graph, this.routePointA.lat, this.routePointA.lng);
        const goalKey = this._nearestNode(graph, this.routePointB.lat, this.routePointB.lng);

        if (!startKey || !goalKey) {
            showMapToast('⚠️ Başlangıç/varış noktası için yol bulunamadı.', 'error');
            this._setInfoBar('', '', false);
            return;
        }

        const resAstar = this._aStar(graph, startKey, goalKey);
        const resDijkstra = this._dijkstra(graph, startKey, goalKey);
        const chosen = this.selectedAlgo === 'astar' ? resAstar : resDijkstra;

        this._setInfoBar('', '', false);
        this._showPanel();

        if (!chosen.path) {
            showMapToast('⚠️ Bu iki nokta arasında rota bulunamadı.', 'error');
            return;
        }

        this._renderRoute(graph, chosen.path, features);
        this._updateComparisonTable(resAstar, resDijkstra);
        showMapToast('✅ Rota oluşturuldu — ' + (this.selectedAlgo === 'astar' ? 'A*' : 'Dijkstra'), 'ok');
    }

    _renderRoute(graph, path, features) {
        const map = this.lm.mapInstance;

        // Koordinatlara çevir (path key dizisidir)
        const coords = path.map(k => {
            const n = graph.nodes[k];
            return [n.lng, n.lat];
        });

        // Gerçek mesafe hesabı
        let totalDist = 0;
        for (let i = 0; i < coords.length - 1; i++) {
            totalDist += distMeters(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
        }

        // Engelli segment sayısı
        const routeSet = new Set(path);
        let blockedSegs = 0;
        features.forEach(f => {
            if (f.properties && f.properties.status === 'blocked') {
                const fc = f.geometry.coordinates;
                for (let j = 0; j < fc.length; j++) {
                    const k = fc[j][1].toFixed(6) + ',' + fc[j][0].toFixed(6);
                    if (routeSet.has(k)) { blockedSegs++; break; }
                }
            }
        });

        // Kaynak ve katman yönetimi
        const geojson = {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }]
        };

        if (map.getSource('route-path')) {
            map.getSource('route-path').setData(geojson);
        } else {
            map.addSource('route-path', { type: 'geojson', data: geojson });
        }

        if (!map.getLayer('route-glow')) {
            map.addLayer({
                id: 'route-glow', type: 'line', source: 'route-path',
                paint: { 'line-color': '#38bdf8', 'line-width': 16, 'line-opacity': 0.2, 'line-blur': 4 },
                layout: { 'line-cap': 'round', 'line-join': 'round' }
            });
        }
        if (!map.getLayer('route-line')) {
            map.addLayer({
                id: 'route-line', type: 'line', source: 'route-path',
                paint: { 'line-color': '#0ea5e9', 'line-width': 5, 'line-opacity': 0.95, 'line-dasharray': [0, 4, 3] },
                layout: { 'line-cap': 'round', 'line-join': 'round' }
            });
        }

        // Özet kart güncelle
        const distStr = totalDist < 1000 ? Math.round(totalDist) + ' m' : (totalDist / 1000).toFixed(1) + ' km';
        const mins = Math.round((totalDist / 1000) / 5 * 60);
        const timeStr = mins < 60 ? mins + ' dk' : Math.floor(mins / 60) + 's ' + (mins % 60) + 'dk';

        document.getElementById('prsAlgo').textContent = this.selectedAlgo === 'astar' ? 'A*' : 'Dijkstra';
        document.getElementById('prsDistance').textContent = distStr;
        document.getElementById('prsTime').textContent = timeStr;
        document.getElementById('prsBlocked').textContent = blockedSegs > 0 ? blockedSegs + ' segm.' : 'Yok';
        document.getElementById('panelRouteSummary').classList.remove('hidden');
        document.getElementById('droneCards').style.display = 'none';

        // Route summary kartını da güncelle
        document.getElementById('rsAlgoBadge').textContent = this.selectedAlgo === 'astar' ? 'A*' : 'Dijkstra';
        document.getElementById('rsDistance').textContent = distStr;
        document.getElementById('rsTime').textContent = timeStr;
        document.getElementById('rsBlocked').textContent = blockedSegs > 0 ? blockedSegs + ' segm.' : 'Yok';
        document.getElementById('routeSummary').classList.remove('hidden');

        // Haritayı rotaya sığdır
        const bounds = coords.reduce((b, c) => [
            [Math.min(b[0][0], c[0]), Math.min(b[0][1], c[1])],
            [Math.max(b[1][0], c[0]), Math.max(b[1][1], c[1])]
        ], [[coords[0][0], coords[0][1]], [coords[0][0], coords[0][1]]]);
        map.fitBounds(bounds, { padding: 80, duration: 800 });
    }

    _updateComparisonTable(resAstar, resDijkstra) {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('cmpNodesAstar', resAstar.nodesVisited);
        set('cmpNodesDijkstra', resDijkstra.nodesVisited);
        set('cmpTimeAstar', resAstar.timeMs + 'ms');
        set('cmpTimeDijkstra', resDijkstra.timeMs + 'ms');
        set('cmpCostAstar', resAstar.cost);
        set('cmpCostDijkstra', resDijkstra.cost);

        const nodePct = resDijkstra.nodesVisited > 0
            ? Math.round((1 - resAstar.nodesVisited / resDijkstra.nodesVisited) * 100) : 0;
        const sameRoute = resAstar.cost === resDijkstra.cost ? 'Aynı optimal rota.' : 'Farklı rota maliyeti.';
        const timeExp = parseFloat(resAstar.timeMs) > parseFloat(resDijkstra.timeMs)
            ? "Dijkstra daha hızlıydı çünkü A*'ın her düğümdeki matematiksel (Heuristic) yükü, Dijkstra'nın basit toplama işleminden ağır bastı."
            : "A* daha hızlıydı çünkü hedefe yönelik Heuristic tahmini sayesinde gereksiz düğümleri gezmekten kaçındı.";
        set('cmpSummary', 'A* ' + (nodePct > 0 ? nodePct + '% daha az düğüm ziyaret etti. ' : '') + sameRoute + ' ' + timeExp);
    }

    /* ============================================================================
       UI Yardımcıları
       ============================================================================ */
    _setInfoBar(icon, text, visible) {
        const bar = document.getElementById('routeInfoBar');
        if (!bar) return;
        document.getElementById('ribIcon').textContent = icon;
        document.getElementById('ribText').textContent = text;
        bar.classList.toggle('hidden', !visible);
    }

    _showPanel() {
        // Orijinal showPanel() davranışı — panelRouteSummary zaten renderRoute'da gösteriliyor
    }

    _clearMarkers() {
        this.routeMarkers.forEach(m => m.remove());
        this.routeMarkers = [];
        this.routePointA = null;
        this.routePointB = null;
    }

    _addPin(lng, lat, type) {
        const el = document.createElement('div');
        el.className = 'route-pin';
        const color = type === 'start' ? '#10B981' : '#EF4444';
        const label = type === 'start' ? 'A' : 'B';
        el.innerHTML = `<div style="position:relative;display:flex;flex-direction:column;align-items:center;">
            <div style="width:24px;height:24px;border-radius:50%;background:${color};border:2.5px solid white;
                box-shadow:0 0 10px ${color}80;display:flex;align-items:center;justify-content:center;
                color:white;font-size:11px;font-weight:700;font-family:Inter,sans-serif;">${label}</div>
            <div style="width:2px;height:8px;background:${color};opacity:0.7;"></div>
        </div>`;
        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([lng, lat])
            .addTo(this.lm.mapInstance);
        this.routeMarkers.push(marker);
    }

    _nearestSegmentStatus(lat, lng) {
        const features = this.lm.cachedColoredFeatures || this.lm.cachedOverpassFeatures;
        if (!features || !features.length) return { status: 'open', dist: Infinity };

        let bestDist = Infinity, bestStatus = 'open';
        features.forEach(f => {
            const coords = f.geometry.coordinates;
            const status = (f.properties && f.properties.status) || 'open';
            for (let i = 0; i < coords.length - 1; i++) {
                const d = pointToSegmentDist(
                    lat, lng,
                    coords[i][1], coords[i][0],
                    coords[i + 1][1], coords[i + 1][0]
                );
                if (d < bestDist) { bestDist = d; bestStatus = status; }
            }
        });
        return { status: bestStatus, dist: bestDist };
    }

    _showBlockedWarning() {
        const bar = document.getElementById('routeInfoBar');
        const icon = document.getElementById('ribIcon');
        const text = document.getElementById('ribText');
        if (!bar || !icon || !text) return;

        const prevBorder = bar.style.borderColor;
        const prevIcon = icon.textContent;
        const prevText = text.textContent;

        bar.style.borderColor = 'rgba(239,68,68,.8)';
        bar.style.boxShadow = '0 0 0 2px rgba(239,68,68,.3)';
        icon.textContent = '🚫';
        text.textContent = 'Bu bölge engelli! Açık (yeşil) bir yol seçin.';
        text.style.color = '#f87171';

        setTimeout(() => {
            bar.style.borderColor = prevBorder;
            bar.style.boxShadow = '';
            icon.textContent = prevIcon;
            text.textContent = prevText;
            text.style.color = '';
        }, 2000);
    }
}
