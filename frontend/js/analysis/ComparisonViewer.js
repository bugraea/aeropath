// ComparisonViewer.js
// Yöntemleri yan yana karşılaştırmak için Senkronize Pan/Zoom Modalı

let compareScale = 1;
let compareTx = 0;
let compareTy = 0;
let isDragging = false;
let startX = 0;
let startY = 0;

async function openComparisonModal() {
    const analyzer = window.app.imageAnalyzer;
    if (!analyzer || !analyzer.currentFile) return;

    const available = Array.from(analyzer.availableMethods);
    if (available.length < 2) {
        alert("Karşılaştırma için en az 2 yöntemi analiz etmiş olmalısınız!");
        return;
    }

    const modal = document.getElementById('comparisonModal');
    const container = document.getElementById('comparisonContainer');
    
    // Temizle
    container.innerHTML = '';
    
    // Transform degiskenlerini sifirla
    compareScale = 1;
    compareTx = 0;
    compareTy = 0;
    
    modal.style.display = 'flex';

    // Seçili yöntemlerin resimlerini önbellekten al
    const cacheManager = analyzer.cache;
    
    for (let i = 0; i < available.length; i++) {
        const method = available[i];
        const cacheKey = analyzer.currentFile.name + '_' + analyzer.currentFile.size + '_' + method;
        const cached = await cacheManager.load(cacheKey);
        
        if (!cached) continue;

        // Kolon olustur
        const col = document.createElement('div');
        col.style.flex = '1';
        col.style.position = 'relative';
        col.style.overflow = 'hidden';
        col.style.background = '#1e293b';

        // Başlık
        const title = document.createElement('div');
        title.textContent = method;
        title.style.position = 'absolute';
        title.style.top = '10px';
        title.style.left = '10px';
        title.style.background = 'rgba(15,23,42,0.8)';
        title.style.color = '#fff';
        title.style.padding = '6px 12px';
        title.style.borderRadius = '6px';
        title.style.zIndex = '10';
        title.style.fontWeight = 'bold';
        title.style.boxShadow = '0 4px 6px rgba(0,0,0,0.3)';
        
        // Görsel Wrapper
        const imgWrap = document.createElement('div');
        imgWrap.className = 'compare-wrap';
        imgWrap.style.width = '100%';
        imgWrap.style.height = '100%';
        imgWrap.style.display = 'flex';
        imgWrap.style.alignItems = 'center';
        imgWrap.style.justifyContent = 'center';
        imgWrap.style.transformOrigin = '0 0'; // pan/zoom icin
        imgWrap.style.position = 'relative'; // Iki gorseli ust uste bindirmek icin

        // Arka Plan (Orjinal Gorsel)
        const imgBg = document.createElement('img');
        imgBg.src = cached.originalImage;
        imgBg.style.position = 'absolute';
        imgBg.style.maxWidth = '100%';
        imgBg.style.maxHeight = '100%';
        imgBg.style.objectFit = 'contain';
        imgBg.style.pointerEvents = 'none';

        // Maske (Overlay Gorsel)
        const imgMask = document.createElement('img');
        imgMask.src = cached.overlayImage;
        imgMask.style.position = 'absolute';
        imgMask.style.maxWidth = '100%';
        imgMask.style.maxHeight = '100%';
        imgMask.style.objectFit = 'contain';
        imgMask.style.pointerEvents = 'none';
        // Görünürlük için opaklık ayarı eklenebilir veya slider yapılabilir, şimdilik tam gösterelim (veya %50 transparan)
        imgMask.style.opacity = '0.6'; 
        
        imgWrap.appendChild(imgBg);
        imgWrap.appendChild(imgMask);
        col.appendChild(title);
        col.appendChild(imgWrap);
        container.appendChild(col);
    }

    applyCompareTransform();
}

function closeComparisonModal() {
    document.getElementById('comparisonModal').style.display = 'none';
}

function applyCompareTransform() {
    const wraps = document.querySelectorAll('.compare-wrap');
    wraps.forEach(w => {
        w.style.transform = `translate(${compareTx}px, ${compareTy}px) scale(${compareScale})`;
    });
}

// Senkronize Event Listener'lar
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('comparisonContainer');
    
    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        
        const zoomSensitivity = 0.001;
        const delta = -e.deltaY * zoomSensitivity;
        
        let newScale = compareScale * Math.exp(delta);
        newScale = Math.max(0.1, Math.min(newScale, 20)); // Limit scale
        
        // Fare pozisyonuna gore zoom
        const rect = container.getBoundingClientRect();
        
        // Fare pozisyonunun container içindeki yüzdesi (hangi panele denk geliyorsa gelsin, paneller ayni oldugu icin yansitilabilir)
        // Oran orantı kurarak her resim icin ayni merkezde zoom yaptirmak biraz matematik ister.
        // Basitlik adina dogrudan mouse'un oldugu noktayi baz alabiliriz.
        
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Container, N parçaya bölünmüş durumda. Farenin hangi parçada olduğunu bulalım
        const colCount = container.children.length;
        if(colCount === 0) return;
        
        const colWidth = rect.width / colCount;
        const colIndex = Math.floor(x / colWidth);
        const localX = x - (colIndex * colWidth);
        
        // Zoom kaymasini hesapla
        compareTx = localX - (localX - compareTx) * (newScale / compareScale);
        compareTy = y - (y - compareTy) * (newScale / compareScale);
        compareScale = newScale;

        applyCompareTransform();
    }, { passive: false });

    container.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX - compareTx;
        startY = e.clientY - compareTy;
        container.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        compareTx = e.clientX - startX;
        compareTy = e.clientY - startY;
        applyCompareTransform();
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
        container.style.cursor = 'default';
    });
});
