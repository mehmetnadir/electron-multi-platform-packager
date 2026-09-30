/* Üretim Masası — çevrimdışı yaması.
   Tema dosyalarına DOKUNULMAZ; burada yalnız `file://` altında çalışmayan
   üç şey sarılır: settings/diller/özellik fetch'leri, ünite XML'i ve
   önyükleyicinin kök-mutlak yolu. */
(function () {
  "use strict";

  window.__setSettings = {
  "bookCount" : 4,
  "books" : {
    "book1" : {
      "assetId" : "44187",
      "contentType" : "book",
      "coverUrl" : "images\/book1.png",
      "displayOrder" : 0,
      "title" : "Reference Book"
    },
    "book2" : {
      "assetId" : "25772",
      "contentType" : "book",
      "coverUrl" : "images\/book2.png",
      "displayOrder" : 1,
      "title" : "Workbook"
    },
    "book3" : {
      "assetId" : "44579",
      "contentType" : "book",
      "coverUrl" : "images\/book3.png",
      "displayOrder" : 2,
      "title" : "Key Words"
    },
    "book4" : {
      "assetId" : "Grade-8-Games",
      "contentType" : "book",
      "coverUrl" : "images\/book4.png",
      "displayOrder" : 3,
      "title" : "Games"
    }
  },
  "contentVersion" : null,
  "extraMaterials" : [

  ],
  "features" : [
    {
      "clickable" : true,
      "contentUrl" : "features\/mobile-friendly.html",
      "id" : "mobile-friendly",
      "title" : "Mobil Uyumlu"
    },
    {
      "clickable" : true,
      "contentUrl" : "features\/interactive.html",
      "id" : "interactive",
      "title" : "Etkileşimli İçerikler"
    },
    {
      "clickable" : true,
      "contentUrl" : "features\/voiced.html",
      "id" : "voiced",
      "title" : "Seslendirilmiş"
    },
    {
      "clickable" : true,
      "contentUrl" : "features\/curriculum-aligned.html",
      "id" : "curriculum-aligned",
      "title" : "Müfredat Uyumlu"
    },
    {
      "clickable" : true,
      "contentUrl" : "features\/mobile-optic.html",
      "id" : "mobile-optic",
      "title" : "Mobil Optik"
    },
    {
      "clickable" : true,
      "contentUrl" : "features\/extra-materials.html",
      "id" : "extra-materials",
      "title" : "Ekstra Materyaller"
    },
    {
      "clickable" : true,
      "contentUrl" : "features\/live-test.html",
      "id" : "live-test",
      "title" : "Canlı Test"
    },
    {
      "clickable" : true,
      "id" : "updates",
      "title" : "Güncellemeler"
    }
  ],
  "materials" : {
    "audio" : false,
    "extra-materials" : false,
    "games" : false,
    "videos" : false
  },
  "publisherName" : "",
  "setTitle" : "Shall We 8 Set",
  "updates" : {
    "enabled" : false
  }
};
  window.__setLanguages = {"en":{"books":[{"id":"main-book","title":"Student Book"},{"id":"workbook","title":"Workbook"},{"id":"test-book","title":"Test Book"},{"id":"homework-book","title":"Homework Book"}],"materials":[{"id":"videos","title":"Videos"},{"id":"audio","title":"Audio Files"},{"id":"games","title":"Games"},{"id":"extra-materials","title":"Extra Materials"}],"ui":{"closeBtn":"Close","languageBtn":"Change language","loadingText":"Please wait","loadingTitle":"Opening...","menuBooksHeader":"Books","menuBookSubtitle":"Book","menuHeader":"Books & Units","menuMaterialsHeader":"Extra Materials","modalSubtitle":"units available","modalTitle":"Select Unit","openBook":"Open book","openBtn":"Open","pageLabel":"Page","selectUnit":"Select unit","showUnits":"Show units","unitsBtn":"Show units","unitsErrorText":"Units could not be loaded","unitsLoadError":"Units could not be loaded","unitsLoading":"Loading units...","unitsLoadingText":"Loading units..."}},"tr":{"books":[{"id":"main-book","title":"Ana Kitap"},{"id":"workbook","title":"Çalışma Kitabı"},{"id":"test-book","title":"Test Kitabı"},{"id":"homework-book","title":"Ödev Kitabı"}],"materials":[{"id":"videos","title":"Videolar"},{"id":"audio","title":"Ses Dosyaları"},{"id":"games","title":"Oyunlar"},{"id":"extra-materials","title":"Ek Materyaller"}],"ui":{"closeBtn":"Kapat","languageBtn":"Dil değiştir","loadingText":"Lütfen bekleyin","loadingTitle":"Açılıyor...","menuBooksHeader":"Kitaplar","modalSubtitle":"ünite mevcut","modalTitle":"Ünite Seçin","openBook":"Kitabı aç","openBtn":"Aç","selectUnit":"Ünite seçin","showUnits":"Üniteleri göster","unitsBtn":"Üniteleri göster","unitsLoadError":"Üniteler yüklenemedi","unitsLoading":"Üniteler yükleniyor..."}}};
  window.__setFeatures = {"features\/curriculum-aligned.html":"<!DOCTYPE html>\n<html lang=\"tr\">\n<head>\n  <meta charset=\"UTF-8\" \/>\n  <title>Müfredat Uyumlu<\/title>\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" \/>\n  <style>\n    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1c1c1e; }\n    .wrap { padding: 16px 20px; }\n    h1 { font-size: 20px; margin: 0 0 8px; }\n    p { font-size: 14px; line-height: 1.5; margin: 0; opacity: .8; }\n  <\/style>\n<\/head>\n<body>\n  <div class=\"wrap\">\n    <h1>Müfredat Uyumlu<\/h1>\n    <p>Kitap içeriklerimiz en güncel <strong>MEB müfredatına<\/strong> uygun hazırlanmıştır.<\/p>\n    <p style=\"margin-top:8px;\">Müfredat uyumluluğunu en üst düzeyde tutarak yıllık planlara ve hazırlık sınavları için ihtiyaç duyulan içerikler <strong>uzman öğretmen kadrolarımızca<\/strong> hazırlanmaktadır.<\/p>\n  <\/div>\n<\/body>\n<\/html>\n","features\/extra-materials.html":"<!DOCTYPE html>\n<html lang=\"tr\">\n<head>\n  <meta charset=\"UTF-8\" \/>\n  <title>Ekstra Materyaller<\/title>\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" \/>\n  <style>\n    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1c1c1e; }\n    .wrap { padding: 16px 20px; }\n    h1 { font-size: 20px; margin: 0 0 8px; }\n    p { font-size: 14px; line-height: 1.5; margin: 0; opacity: .8; }\n  <\/style>\n<\/head>\n<body>\n  <div class=\"wrap\">\n    <h1>Ekstra Materyaller<\/h1>\n    <p>Kitap içeriklerini hazırlayan ekiplerimiz, kitap dışında ihtiyaç duyabileceğiniz bazı ek materyalleri web aracılığı ile size ulaştırmaktadır.<\/p>\n    <p style=\"margin-top:8px;\">Bu materyaller arasında çalışma kağıtları, yazılı sınav örnekleri, ders videoları, sesli makaleler, indirilebilir sunum dosyaları bulunmaktadır.<\/p>\n  <\/div>\n<\/body>\n<\/html>\n","features\/interactive.html":"<!DOCTYPE html>\n<html lang=\"tr\">\n<head>\n  <meta charset=\"UTF-8\" \/>\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" \/>\n  <title>Etkileşimli İçerikler<\/title>\n  <style>\n    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; }\n    .content { padding: 12px 0; color: #1c1c1e; }\n    h2 { font-size: 18px; margin: 0 0 8px 0; }\n    p { font-size: 14px; line-height: 1.6; margin: 0 0 10px 0; color: #3c3c43; }\n    ul { margin: 8px 0 0 18px; color: #3c3c43; }\n  <\/style>\n  <\/head>\n<body>\n  <div class=\"content\">\n    <h2>Etkileşimli içerikler<\/h2>\n    <p>Özellikle ana kitap içindeki tüm etkinlikler etkileşimli şekilde çalışmaktadır. Sürükle bırak, sanal klavye ya da eşleştirme gibi etkileşimler ile kullanılabilir ve böylece anlık geri bildirimler sağlanır.<\/p>\n    <p>Kitap işleyişine uygun şekilde üretilen bu etkinlikler, tüm çalışmaları daha öğretici bir hale getirmek için tasarlanmıştır.<\/p>\n    <ul>\n      <li>Sürükle-bırak eşleştirmeler<\/li>\n      <li>Sanal klavye ile hızlı giriş<\/li>\n      <li>Anlık doğru\/yanlış geri bildirimleri<\/li>\n    <\/ul>\n  <\/div>\n<\/body>\n<\/html>\n","features\/live-test.html":"<!DOCTYPE html>\n<html lang=\"tr\">\n<head>\n  <meta charset=\"UTF-8\" \/>\n  <title>Canlı Test<\/title>\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" \/>\n  <style>\n    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1c1c1e; }\n    .wrap { padding: 16px 20px; }\n    h1 { font-size: 20px; margin: 0 0 8px; }\n    p { font-size: 14px; line-height: 1.5; margin: 0; opacity: .8; }\n  <\/style>\n<\/head>\n<body>\n  <div class=\"wrap\">\n    <h1>Canlı Test<\/h1>\n    <p>Canlı olarak test uygula, anında sonuçları gör!<\/p>\n    <p style=\"margin-top:8px;\">Kitap içindeki çoktan seçmeli testlerin bulunduğu sayfalarda <strong>Canlı Test<\/strong> butonuna tıklayıp, öğrencilerinize link gönderin. Bağlantıya tıklayan öğrencileriniz o teste anlık olarak katılır; herkes test sorularını çözerek ilerler, sorular cep telefonu ekranına yansır, seçenekler işaretlenir ve test bitiminde sınıf sıralaması görünür.<\/p>\n  <\/div>\n<\/body>\n<\/html>\n","features\/mobile-friendly.html":"<!DOCTYPE html>\n<html lang=\"tr\">\n<head>\n  <meta charset=\"UTF-8\" \/>\n  <title>Mobil Uyumlu<\/title>\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" \/>\n  <style>\n    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1c1c1e; }\n    .wrap { padding: 16px 20px; }\n    h1 { font-size: 20px; margin: 0 0 8px; }\n    p { font-size: 14px; line-height: 1.5; margin: 0; opacity: .8; }\n  <\/style>\n<\/head>\n<body>\n  <div class=\"wrap\">\n    <h1>Mobil Uyumlu<\/h1>\n    <p>Tüm akıllı tahta uygulamaları <strong>mobil uygulamamızdan<\/strong> erişilebilir durumda. Aynı zamanda <strong>web z kitap<\/strong> versiyonları ile mobil cihazlarınızdan akıllı tahta uygulamasını açabilirsiniz.<\/p>\n  <\/div>\n<\/body>\n<\/html>\n","features\/mobile-optic.html":"<!DOCTYPE html>\n<html lang=\"tr\">\n<head>\n  <meta charset=\"UTF-8\" \/>\n  <title>Mobil Optik<\/title>\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" \/>\n  <style>\n    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1c1c1e; }\n    .wrap { padding: 16px 20px; }\n    h1 { font-size: 20px; margin: 0 0 8px; }\n    p { font-size: 14px; line-height: 1.5; margin: 0; opacity: .8; }\n  <\/style>\n<\/head>\n<body>\n  <div class=\"wrap\">\n    <h1>Mobil Optik<\/h1>\n    <p>Testleri ödev olarak gönderin, öğrencileriniz ödevlerim ekranından ya da test QR'ı okutup <strong>mobil optik<\/strong> işaretleyip testleri çözsün!<\/p>\n    <p style=\"margin-top:8px;\">Türkiye geneli sıralaması ve netlerini görsünler. Bu işlemlerin raporlarına öğretmenler mobil cihazlarından ulaşabilsin.<\/p>\n  <\/div>\n<\/body>\n<\/html>\n","features\/voiced.html":"<!DOCTYPE html>\n<html lang=\"tr\">\n<head>\n  <meta charset=\"UTF-8\" \/>\n  <title>Seslendirilmiş<\/title>\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" \/>\n  <style>\n    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1c1c1e; }\n    .wrap { padding: 16px 20px; }\n    h1 { font-size: 20px; margin: 0 0 8px; }\n    p { font-size: 14px; line-height: 1.5; margin: 0; opacity: .8; }\n  <\/style>\n<\/head>\n<body>\n  <div class=\"wrap\">\n    <h1>Seslendirilmiş<\/h1>\n    <p>Kitap içinde seslendirilmesi gereken kısımlar, uzman eğitmenlerimiz tarafından onaylanan seslendirme ekipleri tarafından seslendirilerek kitabın uygun bölümlerine yerleştirilmiştir.<\/p>\n    <p style=\"margin-top:8px;\">Ses dosyalarını akıllı tahta yazılımı içindeki butonlara tıklayarak kullanabilirsiniz.<\/p>\n  <\/div>\n<\/body>\n<\/html>\n"};
  window.__cevrimdisi = true;

  /* Tema kitap kartlarını `Object.keys(settings.books)` sırasıyla çiziyor
     (language-set.js:1013 civarı) ve o sıra JSON metnindeki anahtar
     sırasından geliyor. Üretici `books`'u klasör adına göre (`book1,
     book2...`) ALFABETİK sıralı yazıyor (`JSONSerialization.sortedKeys`) —
     bu, kullanıcının listede gördüğü/sürüklediği SIRA ile aynı olmak
     ZORUNDA DEĞİL (bir klasör adı elle değiştirilmişse kesin farklı).
     `displayOrder` alanına göre burada yeniden diziyoruz ki kart sırası
     girişteki sırayı korusun; tema dosyasına DOKUNMUYORUZ. */
  if (window.__setSettings && window.__setSettings.books) {
    var __hamKitaplar = window.__setSettings.books;
    var __anahtarlar = Object.keys(__hamKitaplar).sort(function (a, b) {
      var sa = __hamKitaplar[a] && typeof __hamKitaplar[a].displayOrder === "number"
        ? __hamKitaplar[a].displayOrder : 0;
      var sb = __hamKitaplar[b] && typeof __hamKitaplar[b].displayOrder === "number"
        ? __hamKitaplar[b].displayOrder : 0;
      return sa - sb;
    });
    var __diziliKitaplar = {};
    for (var __i = 0; __i < __anahtarlar.length; __i++) {
      __diziliKitaplar[__anahtarlar[__i]] = __hamKitaplar[__anahtarlar[__i]];
    }
    window.__setSettings.books = __diziliKitaplar;
  }

  function yanit(govde, tur) {
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: function () { return tur; } },
      json: function () { return Promise.resolve(JSON.parse(govde)); },
      text: function () { return Promise.resolve(govde); }
    });
  }

  var asilFetch = window.fetch ? window.fetch.bind(window) : null;

  window.fetch = function (girdi, secenekler) {
    var adres = typeof girdi === "string" ? girdi : (girdi && girdi.url) || "";
    var sade = String(adres).split("?")[0];

    if (sade.indexOf("config/settings.json") !== -1) {
      return yanit(JSON.stringify(window.__setSettings), "application/json");
    }
    var dilEsleme = sade.match(/languages\/([a-zA-Z-]+)\.json$/);
    if (dilEsleme && window.__setLanguages[dilEsleme[1]]) {
      return yanit(JSON.stringify(window.__setLanguages[dilEsleme[1]]), "application/json");
    }
    for (var anahtar in window.__setFeatures) {
      if (sade.indexOf(anahtar) !== -1) {
        return yanit(window.__setFeatures[anahtar], "text/html");
      }
    }
    if (!asilFetch) {
      return Promise.reject(new Error("fetch yok"));
    }
    return asilFetch(girdi, secenekler);
  };

  /* Ünite XML'i offline pakette YOK. Sarmalanmazsa kitap kartına tıklamak
     hata veriyor ve gezinme HİÇ olmuyor (language-set.js:1750). */
  if (window.xmlParser && typeof window.xmlParser.parseBookContent === "function") {
    var asilAyristir = window.xmlParser.parseBookContent.bind(window.xmlParser);
    window.xmlParser.parseBookContent = function (yol, assetId) {
      return Promise.resolve()
        .then(function () { return asilAyristir(yol, assetId); })
        .catch(function () { return null; })
        .then(function (uniteler) {
          if (uniteler && uniteler.length) { return uniteler; }
          return [{ id: 1, name: "", page: 1, ratio: 0 }];
        });
    };
  }

  /* Önyükleyici kök-mutlak `/Uploads/WebDijitapDosyalar/` yolunu kullanıyor;
     offline'da hiçbir şey ısıtamaz, boşuna istek üretir. */
  if (window.bookPreloader) {
    window.bookPreloader.preloadBookOnClick = function () {};
    if (typeof window.bookPreloader.stop === "function") { window.bookPreloader.stop(); }
  }
})();
