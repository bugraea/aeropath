# AeroPath — Afet Navigasyon ve Karar Destek Sistemi

**Yıkıcı Afet Senaryolarında Derin Öğrenme Tabanlı Semantik Segmentasyon ve Dinamik Rota Karar Destek Sistemi**

**Teknolojiler:** FastAPI | PyTorch | SegFormer | UNet++ | MapLibre GL | TÜBİTAK Projesi

---

## Proje Hakkında

Sistem, İnsansız Hava Araçlarından (İHA) alınan yüksek çözünürlüklü ortomozaik (GeoTIFF) görüntülerini **SegFormer** , **"DeepLabV3+** ve **UNet++** gibi derin öğrenme mimarileriyle piksel düzeyinde analiz eder; elde edilen anlamsal maskeleri tarayıcı üzerinde çalışan topolojik bir **Vision Graph** motoruna dönüştürerek **A\*** ve **Dijkstra** algoritmaları üzerinden engellerden kaçınan (*obstacle-avoiding*) dinamik rotalar çizer.

---

## Sistem ve Arayüz Görselleri

### 1. Web Dashboard ve Yapay Zekâ Tahmin Paneli
İHA GeoTIFF görüntüsünün yüklenmesi, derin öğrenme modeliyle 4 anlamsal sınıfa ayrıştırılması, maske opaklık (alfa) kontrolü ve piksel sınıf dağılımı analizi.

<img width="1533" height="795" alt="dashboard_tahmin" src="https://github.com/user-attachments/assets/61d97cc3-a7cb-4d0b-9898-3213d260fdcb" />



---

### 2. Varsayılan Rota Planlama (En Kısa Yol)
Harita üzerinde A ve B noktaları arasında engelleri dikkate almayan geleneksel en kısa rota hesabı.

<img width="1050" height="688" alt="varsayilan_rota" src="https://github.com/user-attachments/assets/f94dc3d2-e2c0-4890-afbb-0d9dd1080989" />

---

### 3. Engel Kaçınan Dinamik Rota Planlama (En Güvenli Yol)
Enkaz engellerini hesaba katan, riski minimize edilmiş en güvenli dinamik rota planlaması.

<img width="1152" height="675" alt="engel_kacinan_rota" src="https://github.com/user-attachments/assets/c94c3ed1-8020-4bc1-8a09-8ddb797e1758" />

---

## Metodoloji ve Sistem Mimarisi

### 1. Veri Toplama ve Ön İşleme
- **Veri Kaynağı**: OpenAerialMap (OAM) platformundan derlenen **2016 Ekvador Depremi (Pedernales)** ve **2023 Kahramanmaraş Depremleri**'ne ait 10 adet yüksek çözünürlüklü GeoTIFF ortomozaik.
- **Yamalama (Patching)**: GPU bellek kısıtlamalarını (OOM) aşmak amacıyla devasa ortomozaikler `1024×1024` piksellik yamalara bölünmüştür. Toplam **1532 yama** elde edilmiştir.
- **Mekânsal-Bloklu Bölme (Spatially-Blocked Split)**: Komşu yamalar arasındaki veri sızıntısını (*data leakage*) önlemek için rastgele bölme yerine 4x4'lük fiziksel bloklar halinde **%70 Eğitim (1072 yama)**, **%15 Doğrulama (230 yama)** ve **%15 Test (230 yama)** setlerine ayrılmıştır.

### 2. Anlamsal Etiketleme ve Sınıf Dengesizliği (EDA)
Veri setinde toplam 1.6 milyar piksel 4 anlamsal sınıfa ayrılmıştır:
- **Background (Sınıf 0)**: %83.81 (Binalar, vegetasyon, su ve toprak)
- **Road (Sınıf 1)**: %14.67 (Geçişe açık yol yüzeyi)
- **Damage (Sınıf 2)**: %1.10 (Yola dökülen bina molozu, çatlaklar, çökmeler)
- **Vehicle (Sınıf 3)**: %0.40 (Yol üzerindeki/çevresindeki taşıtlar)

<img width="691" height="268" alt="etiket_ornekleri" src="https://github.com/user-attachments/assets/e557bf8f-d471-4c15-ae3b-c79b9e78d741" />

## Hazır Veri Seti için Lisans ve Teşekkür kısmına bakınız ##


---

## Modellerin Eğitimi ve Performans Kıyaslaması

Literatürün öne çıkan 3 derin öğrenme segmentasyon mimarisi 1532 yama üzerinde karşılaştırmalı olarak eğitilmiştir:

- **SegFormer (MiT-B2)**
- **UNet++ (EfficientNet-B4)**
- **DeepLabV3+ (EfficientNet-B4)**

### Test Seti Performans Karşılaştırma Tablosu

| Model Mimarisi | mIoU (Tüm Sınıflar) | mIoU2 (Arka Plan Hariç) | Hasar (Damage) IoU | Yol (Road) IoU | Araç (Vehicle) IoU | F1-Score (Hasar) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **SegFormer (MiT-B2)** | **0.6789** | **0.5894** | **0.4396** | 0.7661 | 0.5624 | **0.6107** |
| **UNet++ (EfficientNet-B4)** | 0.6774 | 0.5861 | 0.4145 | **0.7794** | **0.5645** | 0.5860 |
| **DeepLabV3+ (EfficientNet-B4)** | 0.6609 | 0.5649 | 0.3952 | 0.7691 | 0.5305 | 0.5665 |

*Not: mIoU2, veri setinin %83.81'ini oluşturan ve ortalamayı yapay olarak yükselten Arka Plan sınıfı çıkarılarak hesaplanan net operasyonel başarı metriğidir.*

---

## Rota Algoritmaları ve Vision Graph Motoru

Semantik segmentasyon çıktısı static bir harita olmaktan çıkarılıp eyleme dönüştürülebilir (*actionable*) kararlara dönüştürülür:

1. **Maliyet Haritası (Cost Map)**: Tahmin maskeleri 4px grid ağı ile taranarak ampirik geçiş maliyetleri atanır:
   - **Sağlam Yol**: 1.0
   - **Araç**: 5.0
   - **Hasar**: 8.0
   - **Arka Plan**: Sonsuz (Geçilemez)
   - *(Çapraz hareketlerde √2 ≈ 1.414 çarpanı uygulanır)*.
2. **Dinamik Rotalama**: Tarayıcı tarafında eşzamanlı koşturulan **A\*** (Öklid sezgiseli) ve **Dijkstra** algoritmaları ile saha ekiplerine riskleri minimize eden alternatif rotalar sunulur.


---

## Model Eğitimi 

- ### Ortam ve Bağımlılıkların Hazırlanması:
  ```bash
  pip install -r requirements.txt
  ```

- ### Model ve Hiperparametre Yapılandırması:
  ml_core/config.py dosyasından eğitilmek istenen model mimarisi (MODEL_ARCH = "segformer" veya "unetplusplus"), yığın boyutu (BATCH_SIZE = 8) ve maksimum devir sayısı (EPOCHS = 100)         ayarlanır.

- ### Eğitimin Başlatılması :
  
  ```bash
  python ml_core/training/train.py
  ```

- ### Test Seti Değerlendirmesi:
  ```bash
  python ml_core/training/evaluate.py
  ```

---

## Eğitilmiş hazır modeller için Lisans ve Teşekkür kısmına bakınız. ##

---

## Hızlı Başlangıç ve Kurulum


### Gereksinimler
- **Python 3.10+** (PATH'e eklenmiş olmalı)
- **CUDA Destekli GPU** (Opsiyonel; CPU modunda da çalışır)

### Kurulum ve Çalıştırma

**Yöntem 1 — Tek Tıkla (Windows):**
```cmd
start.bat
```

**Yöntem 2 — Manuel:**
```bash
# Bağımlılıkları yükleyin
pip install -r requirements.txt

# FastAPI sunucusunu başlatın
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```
Tarayıcınızda `http://127.0.0.1:8000` adresini açarak kontrol paneline ulaşabilirsiniz.

---

## Proje Yapısı

```
aeropath-master/
├── start.bat              
├── requirements.txt       
├── Görseller/             
│   ├── dashboard_tahmin.jpg
│   ├── varsayilan_rota.jpg
│   ├── engel_kacinan_rota.jpg
│   └── etiket_ornekleri.png
│
├── backend/               
│   ├── app.py             
│   ├── config.py         
│   ├── state.py           
│   ├── routers/           
│   ├── services/          
│   └── utils/             
│
├── ml_core/               
│   ├── config.py          
│   ├── model.py           
│   ├── predict_tif.py     
│   └── weights/           
│
├── frontend/              
│   ├── index.html         
│   ├── dashboard.html     
│   ├── index.css / dashboard.css
│   └── js/               
│       ├── app.js         
│       ├── map/           
│       ├── analysis/      
│       └── shared/        
│
└── tools/                 
    ├── generate_confusion_matrix.py
    └── modal_app.py       
```

---

## Teknoloji Yığını

| Katman | Teknoloji / Kütüphane | Kullanım Amacı |
|---|---|---|
| **Backend API** | FastAPI, Uvicorn | Asenkron REST API ve Uç Bilişim Sunucusu |
| **Derin Öğrenme** | PyTorch, Segmentation Models PyTorch | Model eğitimi, çıkarım ve AMP desteği |
| **Görüntü / GIS** | Rasterio, OpenCV, NumPy | GeoTIFF okuma, CRS dönüşümü ve matris işlemleri |
| **Frontend UI** | Vanilla JS (ES6), HTML5 Canvas API | Modüler web dashboard ve anlık görselleştirme |
| **Harita & Vektör**| MapLibre GL JS, OpenFreeMap, Overpass API | Vektörel uydu haritası ve OSM yol verisi sorgulama |
| **Rota Algoritmaları**| Vision Graph (A* & Dijkstra) | Piksel/Topoloji tabanlı engel kaçınan rotalama |

---

## Lisans ve Teşekkür

Bu proje, **TÜBİTAK** proje kapsamında geliştirilmiştir.

Veri Seti ve Eğitilmiş hazır modeller için mail gönderiniz : bugra_ayrilmaz@outlook.com
