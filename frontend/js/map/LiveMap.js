/**
 * LiveMap.js — MapLibre GL harita yönetimi, İHA marker'ları, yol durumu.
 *
 * Overpass API'dan yol verisi çeker, İHA yakınındaki yolları renklendirir,
 * kullanıcı tıklamasıyla yol durumu değiştirme popup'ı gösterir.
 */

import { distMeters, seededRandom, showMapToast } from '../shared/utils.js';

/* ============================================================================
   İHA Verileri
   ============================================================================ */
const DRONES = [
    { id: 'İHA-01', lat: 36.215, lng: 36.145, battery: 72, altitude: 120, confidence: 94, status: 'active' },
    { id: 'İHA-02', lat: 36.195, lng: 36.175, battery: 88, altitude: 95,  confidence: 92, status: 'active' },
    { id: 'İHA-03', lat: 36.205, lng: 36.125, battery: 41, altitude: 150, confidence: 87, status: 'active' },
];

export class LiveMapManager {
    constructor() {
        this.map = null;
        this.roadStatusOverrides = new Map();
        this.redistributeSeed = Date.now();
        this.cachedOverpassFeatures = null;
        this.cachedColoredFeatures = null;
        this.roadStatusReady = false;
        this._onRouteClick = null; // RouteEngine tarafından atanır
    }

    get drones() { return DRONES; }
    get mapInstance() { return this.map; }

    /* ============================================================================
       Harita Başlatma
       ============================================================================ */
    init() {
        if (this.map) {
            // Sayfa tekrar görünür olunca canvas boyutunu yenile
            this.map.resize();
            return;
        }

        this.map = new maplibregl.Map({
            container: 'liveMapDiv',
            style: 'https://tiles.openfreemap.org/styles/dark',
            center: [36.150, 36.207],
            zoom: 14,
            attributionControl: true,
        });

        this.map.addControl(new maplibregl.NavigationControl(), 'top-right');

        this.map.on('load', () => {
            // Hidden div'den visible'a geçiş sonrası canvas boyutunu doğru hesaplat
            this.map.resize();
            this._initRoadLayers();
            this._addStatusPanel();
            this._updateRoadColors();
            this._addDroneMarkers();
            this._populateDroneCards();
        });

        // Ek güvenlik: DOM render tamamlandıktan sonra bir kez daha resize
        setTimeout(() => { if (this.map) this.map.resize(); }, 200);

        this.map.on('moveend', () => { if (this.cachedOverpassFeatures) this._applyRoadColors(this.cachedOverpassFeatures); });
        this.map.on('zoomend', () => { if (this.cachedOverpassFeatures) this._applyRoadColors(this.cachedOverpassFeatures); });
    }

    /* ============================================================================
       İHA Yakınlık Kontrolü (1 km)
       ============================================================================ */
    _isNearAnyDrone(lat, lng) {
        return DRONES.some(d => distMeters(lat, lng, d.lat, d.lng) <= 1000);
    }

    /* ============================================================================
       Yol Durumu Belirleme
       ============================================================================ */
    _getRouteStatus(osmId, midCoord) {
        const key = String(osmId);
        if (this.roadStatusOverrides.has(key)) return this.roadStatusOverrides.get(key);
        if (!midCoord) return null;

        const [lng, lat] = midCoord;
        if (!this._isNearAnyDrone(lat, lng)) return null;

        const r = seededRandom(this.redistributeSeed, key);
        if (r < 0.65) return 'open';
        if (r < 0.95) return 'blocked';
        return 'unknown';
    }

    /* ============================================================================
       GeoJSON Yol Katmanları
       ============================================================================ */
    _initRoadLayers() {
        const empty = { type: 'FeatureCollection', features: [] };
        this.map.addSource('road-status', { type: 'geojson', data: empty });

        this.map.addLayer({ id: 'roads-open-glow', type: 'line', source: 'road-status',
            filter: ['==', ['get', 'status'], 'open'],
            paint: { 'line-color': '#10B981', 'line-width': 14, 'line-opacity': 0.12 },
            layout: { 'line-cap': 'round', 'line-join': 'round' } });
        this.map.addLayer({ id: 'roads-open', type: 'line', source: 'road-status',
            filter: ['==', ['get', 'status'], 'open'],
            paint: { 'line-color': '#10B981', 'line-width': 4, 'line-opacity': 0.9 },
            layout: { 'line-cap': 'round', 'line-join': 'round' } });
        this.map.addLayer({ id: 'roads-blocked', type: 'line', source: 'road-status',
            filter: ['==', ['get', 'status'], 'blocked'],
            paint: { 'line-color': '#EF4444', 'line-width': 4, 'line-opacity': 0.85, 'line-dasharray': [3, 2] },
            layout: { 'line-cap': 'round', 'line-join': 'round' } });
        this.map.addLayer({ id: 'roads-unknown', type: 'line', source: 'road-status',
            filter: ['==', ['get', 'status'], 'unknown'],
            paint: { 'line-color': '#F59E0B', 'line-width': 3, 'line-opacity': 0.7, 'line-dasharray': [2, 4] },
            layout: { 'line-cap': 'round', 'line-join': 'round' } });

        this.map.on('click', (e) => this._handleMapClick(e));
        this.map.on('mousemove', (e) => {
            const features = this.map.queryRenderedFeatures(e.point, {
                layers: ['roads-open', 'roads-blocked', 'roads-unknown'],
            });
            this.map.getCanvas().style.cursor = features.length ? 'pointer' : '';
        });
        this.roadStatusReady = true;
    }

    _handleMapClick(e) {
        // Rota planlama modunda öncelik RouteEngine'de
        if (this._onRouteClick && this._onRouteClick(e.lngLat)) return;

        const features = this.map.queryRenderedFeatures(e.point, {
            layers: ['roads-open', 'roads-blocked', 'roads-unknown'],
        });
        if (!features.length) return;

        const f = features[0];
        const { status: cur, osmId, name } = f.properties;
        const statusLabels = { open: '✅ Kullanılabilir', blocked: '🚫 Engelli', unknown: '❓ Belirsiz' };
        const opts = [
            { s: 'open',    icon: '✅', label: 'Açık',     bg: '#065F46', col: '#10B981' },
            { s: 'blocked', icon: '🚫', label: 'Engelli',  bg: '#7F1D1D', col: '#EF4444' },
            { s: 'unknown', icon: '❓', label: 'Belirsiz', bg: '#78350F', col: '#F59E0B' },
        ];

        const btns = opts.filter(o => o.s !== cur).map(o =>
            `<button data-status="${o.s}" style="display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border:1px solid ${o.col};border-radius:6px;cursor:pointer;background:${o.bg};color:${o.col};font-size:12px;font-family:Inter,sans-serif;font-weight:600;">${o.icon} ${o.label}</button>`
        ).join(' ');

        const html = `<div id="roadPopupInner" style="font-family:Inter,sans-serif;min-width:200px;">
            <strong style="color:#F1F5F9;font-size:13px;">${name}</strong>
            <div style="margin:4px 0 10px;color:#94A3B8;font-size:12px;">Mevcut durum: <span style="font-weight:600">${statusLabels[cur] || 'Bilinmiyor'}</span></div>
            <div id="roadPopupBtns" style="display:flex;gap:6px;flex-wrap:wrap;">${btns}</div>
            <div style="margin-top:8px;color:#475569;font-size:10px;">OSM ID: ${osmId}</div></div>`;

        const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
            .setLngLat(e.lngLat).setHTML(html).addTo(this.map);

        setTimeout(() => {
            const container = document.getElementById('roadPopupBtns');
            if (!container) return;
            container.querySelectorAll('button[data-status]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const newStatus = btn.getAttribute('data-status');
                    this.roadStatusOverrides.set(String(osmId), newStatus);
                    popup.remove();
                    this._updateRoadColors();
                    const icons = { open: '✅', blocked: '🚫', unknown: '❓' };
                    const lbls  = { open: 'Açık', blocked: 'Engelli', unknown: 'Belirsiz' };
                    showMapToast(`${icons[newStatus] || ''} Yol durumu değişti: ${lbls[newStatus] || newStatus}`, 'ok');
                });
            });
        }, 80);
    }

    /* ============================================================================
       Overpass Veri Çekme ve Renklendirme
       ============================================================================ */
    _fetchRoadsFromOverpass() {
        showMapToast('🛰 Yol verileri yükleniyor...', 'info');
        const aroundClauses = DRONES.map(d =>
            `way["highway"](around:1000,${d.lat},${d.lng});`
        ).join('');
        const query = `[out:json][timeout:30];(${aroundClauses});out geom;`;
        const url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query);

        fetch(url).then(r => r.json()).then(data => {
            const features = [];
            data.elements.forEach(el => {
                if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) return;
                const coords = el.geometry.map(nd => [nd.lon, nd.lat]);
                const osmId = String(el.id);
                const wayName = (el.tags && (el.tags.name || el.tags.ref)) || 'Yol';
                const midCoord = coords[Math.floor(coords.length / 2)];
                if (!this._isNearAnyDrone(midCoord[1], midCoord[0])) return;

                this._splitWay(coords, osmId, wayName, 80).forEach(seg => {
                    features.push({
                        type: 'Feature',
                        geometry: { type: 'LineString', coordinates: seg.coords },
                        properties: { name: seg.name, osmId: seg.segId },
                    });
                });
            });
            this.cachedOverpassFeatures = features;
            this._applyRoadColors(features);
            showMapToast(`✅ ${features.length} yol segmenti yüklendi.`, 'ok');
        }).catch(err => {
            showMapToast('⚠ Yol verisi alınamadı: ' + err.message, 'error');
        });
    }

    /** Yol segmentlerini ~maxMeters uzunluğunda parçalara böler. */
    _splitWay(coords, osmId, wayName, maxMeters = 80) {
        const segments = [];
        let current = [coords[0]], cumDist = 0, segIdx = 0;

        for (let i = 1; i < coords.length; i++) {
            const [p1, p2] = [coords[i - 1], coords[i]];
            cumDist += distMeters(p1[1], p1[0], p2[1], p2[0]);
            current.push(p2);

            if (cumDist >= maxMeters || i === coords.length - 1) {
                if (current.length >= 2) {
                    segments.push({
                        segId: osmId + '_' + segIdx,
                        coords: current.slice(),
                        midCoord: current[Math.floor(current.length / 2)],
                        name: wayName,
                    });
                    segIdx++;
                }
                current = [p2];
                cumDist = 0;
            }
        }
        return segments;
    }

    /**
     * Yolları duruma göre renklendirir.
     * Hedef oran: ~%70 açık, ~%27 engelli, ~%3 belirsiz.
     * Hasarlar gerçekçi olması için yolun sadece kısa bir kesitinde oluşturulur.
     */
    _applyRoadColors(features) {
        if (!this.map || !this.roadStatusReady) return;

        const waySegments = {};
        features.forEach(f => {
            const wayId = f.properties.osmId.split('_')[0];
            if (!waySegments[wayId]) waySegments[wayId] = [];
            waySegments[wayId].push(f);
        });

        const colored = [];
        Object.keys(waySegments).forEach(wayId => {
            const segs = waySegments[wayId];
            const wayRand = seededRandom(this.redistributeSeed, wayId);

            if (wayRand < 0.32) {
                segs.forEach(f => {
                    const status = this.roadStatusOverrides.has(f.properties.osmId)
                        ? this.roadStatusOverrides.get(f.properties.osmId) : 'open';
                    colored.push({ type: 'Feature', geometry: f.geometry,
                        properties: { ...f.properties, status } });
                });
                return;
            }

            const damageStatus = seededRandom(this.redistributeSeed + 3, wayId) < 0.90 ? 'blocked' : 'unknown';
            const n = segs.length;
            const dmgLen = Math.max(1, Math.round(n * (0.20 + seededRandom(this.redistributeSeed + 1, wayId) * 0.30)));
            const dmgStart = Math.floor(seededRandom(this.redistributeSeed + 2, wayId) * (n - dmgLen + 1));
            const dmgEnd = dmgStart + dmgLen;

            segs.forEach((f, idx) => {
                const baseStatus = (idx >= dmgStart && idx < dmgEnd) ? damageStatus : 'open';
                const status = this.roadStatusOverrides.has(f.properties.osmId)
                    ? this.roadStatusOverrides.get(f.properties.osmId) : baseStatus;
                colored.push({ type: 'Feature', geometry: f.geometry,
                    properties: { ...f.properties, status } });
            });
        });

        this.map.getSource('road-status').setData({ type: 'FeatureCollection', features: colored });
        this.cachedColoredFeatures = colored;
        this._updateStatusPanel(colored);
    }

    _updateRoadColors() {
        if (!this.map || !this.roadStatusReady) return;
        if (this.cachedOverpassFeatures) {
            this._applyRoadColors(this.cachedOverpassFeatures);
        } else {
            this._fetchRoadsFromOverpass();
        }
    }

    /* ============================================================================
       Yol Durumu Paneli
       ============================================================================ */
    _addStatusPanel() {
        const panel = document.createElement('div');
        panel.id = 'roadStatusPanel';
        panel.style.cssText = 'position:absolute;bottom:28px;left:12px;z-index:500;background:rgba(15,23,42,0.88);border:1px solid rgba(59,130,246,.2);border-radius:10px;padding:8px 14px;backdrop-filter:blur(8px);pointer-events:none';
        document.getElementById('liveMapDiv').appendChild(panel);
    }

    _updateStatusPanel(features) {
        const panel = document.getElementById('roadStatusPanel');
        if (!panel) return;
        const open    = features.filter(f => f.properties.status === 'open').length;
        const blocked = features.filter(f => f.properties.status === 'blocked').length;
        const unknown = features.filter(f => f.properties.status === 'unknown').length;
        panel.innerHTML = `<div style="display:flex;gap:14px;align-items:center;">
            <span style="color:#10B981;font-weight:700;font-size:13px;">✅ ${open} açık</span>
            <span style="color:#EF4444;font-weight:700;font-size:13px;">🚫 ${blocked} engelli</span>
            <span style="color:#F59E0B;font-weight:700;font-size:13px;">❓ ${unknown} belirsiz</span></div>`;
    }

    /* ============================================================================
       İHA Marker ve Panel
       ============================================================================ */
    _createDroneIconEl() {
        const el = document.createElement('div');
        el.style.cssText = 'position:relative;width:36px;height:36px;';
        el.innerHTML = '<div style="position:absolute;inset:0;border-radius:50%;border:2px solid rgba(59,130,246,.3);animation:radarPulse 2s ease-out infinite;"></div>'
            + '<div style="position:absolute;inset:0;border-radius:50%;border:1.5px solid rgba(59,130,246,.2);animation:radarPulse 2s ease-out infinite .7s;"></div>'
            + '<div style="position:absolute;inset:0;border-radius:50%;border:1px solid rgba(59,130,246,.15);animation:radarPulse 2s ease-out infinite 1.4s;"></div>'
            + '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:12px;height:12px;background:radial-gradient(circle,#60A5FA 0%,#3B82F6 60%,rgba(59,130,246,.3) 100%);border-radius:50%;box-shadow:0 0 12px rgba(59,130,246,.6),0 0 24px rgba(59,130,246,.3);"></div>'
            + '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:4px;height:4px;background:#fff;border-radius:50%;"></div>';
        return el;
    }

    _addDroneMarkers() {
        DRONES.forEach(d => {
            const el = this._createDroneIconEl();
            const label = document.createElement('div');
            label.className = 'drone-map-label';
            label.textContent = d.id;
            label.style.cssText = 'position:absolute;top:-18px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:10px;font-family:"JetBrains Mono",monospace;color:#60A5FA;pointer-events:none;';
            el.appendChild(label);

            const batColor = d.battery > 60 ? '#10B981' : d.battery > 30 ? '#F59E0B' : '#EF4444';
            const popup = new maplibregl.Popup({ offset: 20, closeButton: false })
                .setHTML(`<strong style="color:#3B82F6;font-family:'JetBrains Mono',monospace;">${d.id}</strong><br>`
                    + `<span style="color:#94A3B8;">Pil:</span> <strong style="color:${batColor}">${d.battery}%</strong><br>`
                    + `<span style="color:#94A3B8;">İrtifa:</span> <strong>${d.altitude}m</strong><br>`
                    + `<span style="color:#94A3B8;">Güvenilirlik:</span> <strong style="color:#10B981">${d.confidence}%</strong>`);

            new maplibregl.Marker({ element: el, anchor: 'center' })
                .setLngLat([d.lng, d.lat]).setPopup(popup).addTo(this.map);
        });
    }

    _populateDroneCards() {
        const container = document.getElementById('droneCards');
        if (!container) return;
        container.innerHTML = '';

        DRONES.forEach(d => {
            const batColor = d.battery > 60 ? 'var(--green)' : d.battery > 30 ? 'var(--amber)' : 'var(--red)';
            const card = document.createElement('div');
            card.className = 'drone-card';

            const head = document.createElement('div');
            head.className = 'drone-card-head';
            head.style.cursor = 'pointer';
            head.innerHTML = `<span class="drone-id">${d.id}</span>`
                + '<div style="display:flex;align-items:center;gap:6px;">'
                + `<span class="drone-status-dot ${d.status}"></span>`
                + '<svg class="drone-card-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--text-dim);transition:transform .2s;"><polyline points="6 9 12 15 18 9"/></svg></div>';

            const body = document.createElement('div');
            body.className = 'drone-card-body drone-stats';
            body.style.marginTop = '8px';
            body.innerHTML = `<div class="drone-stat"><span class="drone-stat-label">Pil</span><span class="drone-stat-val" style="color:${batColor}">${d.battery}%</span></div>`
                + `<div class="drone-bar"><div class="drone-bar-fill" style="width:${d.battery}%;background:${batColor}"></div></div>`
                + `<div class="drone-stat"><span class="drone-stat-label">İrtifa</span><span class="drone-stat-val">${d.altitude}m</span></div>`
                + `<div class="drone-stat"><span class="drone-stat-label">Güvenilirlik</span><span class="drone-stat-val" style="color:var(--green)">${d.confidence}%</span></div>`;

            head.addEventListener('click', () => {
                const isOpen = body.style.display !== 'none';
                body.style.display = isOpen ? 'none' : '';
                head.querySelector('.drone-card-chevron').style.transform = isOpen ? 'rotate(-90deg)' : '';
                if (!isOpen && this.map) this.map.flyTo({ center: [d.lng, d.lat], zoom: 16, duration: 1000 });
            });

            card.appendChild(head);
            card.appendChild(body);
            container.appendChild(card);
        });
    }

    /** Yol durumlarını yeni seed ile yeniden dağıtır. */
    redistribute() {
        this.redistributeSeed = Date.now();
        this.roadStatusOverrides.clear();
        if (this.cachedOverpassFeatures) {
            this._applyRoadColors(this.cachedOverpassFeatures);
            showMapToast('🔄 Yol durumları yeniden dağıtıldı.', 'ok');
        } else {
            this._fetchRoadsFromOverpass();
        }
    }
}
