/**
 * BookPreloader v2 — Sürekli yürüyen kitap sayfa önbelleği
 *
 * Davranış:
 * 1. Sayfa açılınca tüm kitapların ilk 3 sayfasını yükle
 * 2. Bitmeyince durma — 3'er 3'er tüm sayfaları yürümeye devam et
 * 3. Kitaba tıklanınca o kitabı önceliklendir (mevcut sayfa + sonraki 3)
 * 4. Kitap bitince başa sar, bir tur daha yap
 * 5. Etkinlik arkaplan görsellerini de dahil et
 */
class BookPreloader {
  constructor() {
    this.preloadedUrls = new Set();
    this.pendingRequests = new Map();
    this.activeRequests = 0;
    this.books = [];
    this.totalPages = {}; // assetId → toplam sayfa
    this.currentRound = {}; // assetId → şu anki sayfa no
    this.priorityBook = null; // tıklanan kitap
    this.priorityPage = 1; // tıklanan kitaptaki mevcut sayfa
    this.paused = false;
    this.batchSize = 3;
    this.roundsCompleted = {}; // assetId → kaç tur tamamlandı

    this.connectionType = this._getConnectionType();
    this.maxParallel = this.connectionType === 'slow' ? 2 : 4;
    this.delay = this.connectionType === 'slow' ? 300 : 100;

    this.baseUrl = '/Uploads/WebDijitapDosyalar/';
  }

  _getConnectionType() {
    try {
      const c = navigator.connection || navigator.mozConnection;
      if (!c) return 'unknown';
      if (c.effectiveType === '4g' || (c.downlink && c.downlink >= 2))
        return 'fast';
      if (c.effectiveType === '2g' || c.effectiveType === '3g')
        return 'slow';
    } catch (_) {}
    return 'unknown';
  }

  /**
   * Başlangıç — tüm kitapları al, toplam sayfa sayılarını
   * BookContent.xml cache'inden çek, yürümeye başla.
   */
  async init(books) {
    if (!books || books.length === 0) return;
    this.books = books.filter(b => b.assetId);

    // Toplam sayfa sayılarını xmlParser cache'inden al
    for (const book of this.books) {
      try {
        const units = await window.xmlParser.parseBookContent(
          book.path || `book${this.books.indexOf(book) + 1}`,
          book.assetId
        );
        // Son ünitenin sayfası + tahmini 20 sayfa
        const lastPage = units.length > 0
          ? Math.max(...units.map(u => u.page)) + 20
          : 50;
        this.totalPages[book.assetId] = lastPage;
      } catch (_) {
        this.totalPages[book.assetId] = 50; // varsayılan
      }
      this.currentRound[book.assetId] = 1;
      this.roundsCompleted[book.assetId] = 0;
    }

    // 500ms bekle — sayfa render'ını engelleme
    setTimeout(() => this._startContinuousPreload(), 500);
  }

  /**
   * Sürekli yürüyen preload döngüsü
   */
  async _startContinuousPreload() {
    while (true) {
      if (this.paused) {
        await this._sleep(500);
        continue;
      }

      // Öncelikli kitap varsa önce onu yükle
      if (this.priorityBook) {
        const done = await this._preloadBatch(
          this.priorityBook, this.priorityPage, this.batchSize, true
        );
        this.priorityPage += this.batchSize;

        // Kitap bittiğinde başa sar
        const total = this.totalPages[this.priorityBook] || 200;
        if (this.priorityPage > total) {
          this.priorityPage = 1;
          this.roundsCompleted[this.priorityBook] =
            (this.roundsCompleted[this.priorityBook] || 0) + 1;
          // 2. tur tamamlandıysa önceliği bırak
          if (this.roundsCompleted[this.priorityBook] >= 2) {
            this.priorityBook = null;
          }
        }
        await this._sleep(this.delay);
        continue;
      }

      // Normal mod — tüm kitapları round-robin 3'er sayfa
      let allDone = true;
      for (const book of this.books) {
        const aid = book.assetId;
        const current = this.currentRound[aid] || 1;
        const total = this.totalPages[aid] || 50;

        // Bu kitap 2 tur tamamladıysa atla
        if ((this.roundsCompleted[aid] || 0) >= 2) continue;

        if (current <= total) {
          allDone = false;
          await this._preloadBatch(aid, current, this.batchSize, false);
          this.currentRound[aid] = current + this.batchSize;

          // Etkinlik görsellerini de yükle (her 10 sayfada bir)
          if (current % 10 === 1) {
            this._preloadActivityAssets(aid, current);
          }

          await this._sleep(this.delay);
        } else if ((this.roundsCompleted[aid] || 0) < 2) {
          // Tur bitti — başa sar
          this.currentRound[aid] = 1;
          this.roundsCompleted[aid] =
            (this.roundsCompleted[aid] || 0) + 1;
        }
      }

      if (allDone) break; // 2 tur tamamlandı, dur
      await this._sleep(this.delay);
    }
  }

  /**
   * Batch preload — belirtilen sayfadan başlayarak N sayfa yükle
   */
  async _preloadBatch(assetId, startPage, count, highPriority) {
    const promises = [];
    for (let i = 0; i < count; i++) {
      const pageNo = startPage + i;
      const total = this.totalPages[assetId] || 200;
      if (pageNo > total) break;

      promises.push(this._preloadPage(assetId, pageNo));
    }

    // Paralel limit dahilinde bekle
    await Promise.all(promises);
  }

  /**
   * Tek sayfa preload — PNG + thumbnail
   */
  async _preloadPage(assetId, pageNo) {
    const pngUrl = `${this.baseUrl}${assetId}/pages/${pageNo}.png`;
    const thumbUrl = `${this.baseUrl}${assetId}/thumbs/${pageNo}.jpg`;

    // Zaten yüklenmişse atla
    if (this.preloadedUrls.has(pngUrl)) return;

    // Paralel limit bekle — pause edilmişse hemen çık
    while (this.activeRequests >= this.maxParallel) {
      if (this.paused) return;
      await this._sleep(50);
    }
    if (this.paused) return;

    this.activeRequests++;
    try {
      const resp = await fetch(pngUrl, { cache: 'force-cache' });
      if (resp.ok) {
        this.preloadedUrls.add(pngUrl);
        // Thumbnail da yükle (küçük dosya)
        fetch(thumbUrl, { cache: 'force-cache' }).catch(() => {});
      }
    } catch (_) {
      // Sessiz hata — ağ sorunu veya sayfa yok
    } finally {
      this.activeRequests--;
    }
  }

  /**
   * Etkinlik arkaplan görsellerini preload et
   * htmletk/u{N}/... altındaki görseller
   */
  _preloadActivityAssets(assetId, nearPage) {
    // Ünite numarasını sayfadan tahmin et (kabaca)
    const unitNo = Math.ceil(nearPage / 20);
    const patterns = [
      `${this.baseUrl}${assetId}/htmletk/u${unitNo}/images/background.png`,
      `${this.baseUrl}${assetId}/htmletk/u${unitNo}/images/background.jpg`,
      `${this.baseUrl}${assetId}/htmletk/u${unitNo}/player/images/background.png`,
      `${this.baseUrl}${assetId}/htmletk/u${unitNo}/player/images/background.jpg`,
    ];

    for (const url of patterns) {
      if (this.preloadedUrls.has(url)) continue;
      fetch(url, { cache: 'force-cache' })
        .then(r => { if (r.ok) this.preloadedUrls.add(url); })
        .catch(() => {});
    }
  }

  /**
   * Hover — ilk 5 sayfayı öncelikle yükle
   */
  preloadBookOnHover(assetId) {
    if (!assetId) return;
    for (let i = 1; i <= 5; i++) {
      this._preloadPage(assetId, i);
    }
  }

  /**
   * Kitap tıklandı — preload'u DURDUR, navigasyona yol aç
   * Tarayıcı bağlantı havuzunu serbest bırak
   */
  preloadBookOnClick(assetId, currentPage) {
    if (!assetId) return;
    // HEMEN durdur — navigasyon isteklerine bant genişliği aç
    this.paused = true;
    this.priorityBook = assetId;
    this.priorityPage = (currentPage || 1);
    this.roundsCompleted[assetId] = 0;
  }

  /**
   * Navigasyon tamamlandıktan sonra devam et
   * (language-set.js'ten çağrılır)
   */
  resume() {
    this.paused = false;
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

window.bookPreloader = new BookPreloader();
