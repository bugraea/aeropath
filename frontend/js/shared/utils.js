/**
 * utils.js — Paylaşılan yardımcı fonksiyonlar ve veri yapıları.
 */

/* ============================================================================
   Haversine Mesafe (metre)
   ============================================================================ */
export function distMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180)
            * Math.cos(lat2 * Math.PI / 180)
            * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ============================================================================
   Deterministik Hash (aynı seed+id → aynı sonuç, harita kaydırmada tutarlı)
   ============================================================================ */
export function seededRandom(seed, osmId) {
    let h = (seed ^ 0xdeadbeef) + parseInt(String(osmId).replace(/\D/g, '0').slice(-8), 10);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 0xffffffff;
}

/* ============================================================================
   Nokta → Segment Mesafesi
   ============================================================================ */
export function pointToSegmentDist(plat, plng, alat, alng, blat, blng) {
    const dx = blng - alng, dy = blat - alat;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1,
        ((plng - alng) * dx + (plat - alat) * dy) / lenSq));
    const nearLat = alat + t * dy, nearLng = alng + t * dx;
    return distMeters(plat, plng, nearLat, nearLng);
}

/* ============================================================================
   MinHeap — Öncelik Kuyruğu (A* ve Dijkstra performansı için)
   ============================================================================ */
export class MinHeap {
    constructor(cmpFn) { this.h = []; this.cmp = cmpFn; }
    get size() { return this.h.length; }

    push(item) {
        this.h.push(item);
        let i = this.h.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.cmp(this.h[i], this.h[p]) < 0) {
                [this.h[i], this.h[p]] = [this.h[p], this.h[i]];
                i = p;
            } else break;
        }
    }

    pop() {
        const top = this.h[0];
        const last = this.h.pop();
        if (this.h.length > 0) { this.h[0] = last; this._sink(0); }
        return top;
    }

    _sink(i) {
        const n = this.h.length;
        while (true) {
            let s = i, l = 2 * i + 1, r = 2 * i + 2;
            if (l < n && this.cmp(this.h[l], this.h[s]) < 0) s = l;
            if (r < n && this.cmp(this.h[r], this.h[s]) < 0) s = r;
            if (s === i) break;
            [this.h[i], this.h[s]] = [this.h[s], this.h[i]];
            i = s;
        }
    }
}

/* ============================================================================
   Harita Toast Bildirimi
   ============================================================================ */
export function showMapToast(msg, type = 'info') {
    let toast = document.getElementById('mapToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'mapToast';
        toast.style.cssText = 'position:absolute;bottom:20px;left:50%;transform:translateX(-50%);z-index:9999;padding:8px 18px;border-radius:8px;font-size:13px;font-family:Inter,sans-serif;font-weight:500;pointer-events:none;transition:opacity .4s;white-space:nowrap;';
        const mapDiv = document.getElementById('liveMapDiv');
        if (mapDiv) mapDiv.appendChild(toast);
    }
    const themes = {
        info:  ['#1e3a5f', '#3B82F6'],
        error: ['#5f1e1e', '#EF4444'],
        ok:    ['#1e4a35', '#10B981'],
    };
    const [bg, border] = themes[type] || themes.info;
    Object.assign(toast.style, {
        background: bg, border: '1px solid ' + border,
        color: '#F8FAFC', opacity: '1',
    });
    toast.textContent = msg;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 4000);
}
