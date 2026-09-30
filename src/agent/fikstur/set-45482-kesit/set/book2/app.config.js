const AppConfig = {
    appName: 'Akıllı Tahta Yazılımı',
    appLogo: 'core/kurumlogo.png',
    imparkLogo: 'core/impark_logo.png',
    splashVideo: 'core/splash.mp4',
    bookModule: {
        enable: true,
        dll: 'classlibraries/ImWin32.dll',
    },
    initialLanguage: 'tr',
    testSolutionVideo : {
        apiTemplate: "/TestlerMobil/GetZKitapCozumLinkv2?" +
            "zKitapId={zKitapId}&" +
            "zKitapTestId={zKitapTestId}&" +
            "SoruSirasi={SoruSirasi}"
    },
    getZKitapNameRequestUrl: "https://www.sorucoz.tv/TestlerMobil/GetZKitapNameByZKitapId?zKitapId={zKitapId}",
    testLectureVideo: {
        apiTemplate: "https://www.sorucoz.tv/TestlerMobil/GetZKitapKonuAnlatimUrl?zKitapId={zKitapId}&zKitapTestId={zKitapTestId}&soruSirasi={questionNumber}",
    },
    testSameQuestionVideo: {
        apiTemplate: "https://www.sorucoz.tv/TestlerMobil/GetZKitapCozumLinkV2?zKitapId={zKitapId}&zKitapTestId={zKitapTestId}&soruSirasi={questionNumber}",
    },
    liveTestRequestUrl: "https://www.sorucoz.tv/CanliTestHazirla/{zKitapId}/{zKitapTestId}",
    publisherSeriesLogoUrl: "https://www.sorucoz.tv/MobilService/GetBookSeriesZKitapLogoUrl?zkitapId={zKitapId}",
    xml: {
        isWeb: false,
        web: {
            bookContent: {
                path: 'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}/data/BookContent.xml',
                //path: 'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}-{version}/data/BookContent.xml',
                encrypted: false,
                pagePath: 'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}/pages/{imageName}.png', //if web is true, it is required
                thumbnailPath: 'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}/thumbs/{imageName}.jpg', //if web is true, it is required
                //pagePath: 'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}-{version}/pages/{imageName}.png'
            },
            focus: {
                path: 'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}/data/Focus.xml',
                //path: 'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}-{version}/data/Focus.xml',
                encrypted: true,
            },
            show: {
                path:  'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}/data/Show.xml',
                //path:  'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}-{version}/data/Show.xml',
                encrypted: true,
                acceptedExtensions : ["png"],
                imagePath: 'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}/show/{imageName}.png' //if web is true, it is required
                //imagePath: 'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}-{version}/show/{imageName}.png'
            },
            test: {
                path: 'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}/data/Test.xml',
                //path: 'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}-{version}/data/Test.xml',
                encrypted: true,
            },
        },
        desktop : {
            imageType: 'png',
            thumbnailType: 'jpg',
            thumbnailPath: "/thumbs/",
            bookName: 'assets/8Sinif-Fen-Bilimleri-Soru-Bankasi---FARKLI-ISEM', //if bookModule is enable, bookName is invalid
            bookContent: {
                path: 'data/BookContent.xml',
                encrypted: false,
            },
            focus: {
                path: 'data/focus.xml',
                encrypted: true,
            },
            show: {
                path: 'data/show.xml',
                encrypted: true,
                imageType: 'png',
            },
            test: {
                path: 'data/test.xml',
                encrypted: true,
            },
            updateBookEndPoint: "https://www.sorucoz.tv/TestlerMobil/GetKitapGuncellemeBilgi?id={bookId}&setMi={isSet}&versiyon={version}"
        }
    },
    trigger : {
        video : {
            path :  'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}/video/{videoName}'
            // path :  'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}-{version}/video/{videoName}'
        },
        audio : {
            path :  'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}/audio/{audioName}'
            //path :  'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}-{version}/audio/{audioName}'
        },
        app : {
            path :  'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}/app/{appName}'
            //path :  'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}-{version}/app/{appName}'
        },
        swf : {
            path :  'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}/'
            //path :  'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}'
        },
        html : {
            path :  'http://localhost:3000/Uploads/WebZkitapDosyalar/{bookId}/{htmlName}'
        },
    },
    images: {
        backgroundImage: 'core/background.jpg',
        activityAreaBackgroundImage: 'core/activity-area-background.jpg',
        footerImage: "core/flipBook/altBar.svg",
    },
    buttons: {
        width: 48, //base w
        height: 48, //base h
        color: { //base colors
            normal: "#fbfbfb",
            over: "#fbfbfb",
        },
        icons: {
            width: 30, //icon base w
            height: 30, //icon base h
            color: { //icon base colors
                normal: "#4c4c4c",
                over: "#ff9641",
            },
        }
    },
    notification: {
        enable: false,
        maxMessageCount: 5,
        autoHideDuration: 1000,
        anchorOrigin: {
            vertical: 'bottom',
            horizontal: 'right',
        },
    },
    toolbar: {
        backgroundColor: "#eaeaea",
        colors: ['#000000', '#FF0000', '#FFFF00', '#00FF00', '#0000FF', '#ff6500', "#02a2c5", "#6300a4"],
        currentColor: '#000000',

        brushSize: 3,
        brushSizes: [1, 3, 6, 10, 20],

        
        eraserSize: 70,
        eraserSizes: [50, 70, 90, 120],
        
    },
    footerbar: {
        backgroundColor: "#e6e6e6df", 
        closeTime: 5, //Footerbar kaç saniye sonra kapansın?
    },
    videoPlayer: {
        width: 1600,
        height: 900,
        autoPlay: true,
        controlBar: {
            autoHide: true,
            playToggle: {
                active: true,
                order: 1
            },
            replayControl: {
                active: true,
                seconds: 10, // 5, 10, 30
                order: 2
            },
            forwardControl: {
                active: true,
                seconds: 30, // 5, 10, 30
                order: 3
            },
            currentTimeDisplay: {
                active: true,
                order: 4
            },
            timeDivider: {
                active: true,
                order: 5
            },
            durationDisplay: {
                active: true,
                order: 6
            },
            remainingTimeDisplay: {
                active: false,
                order: 7
            },
            progressControl: {
                active: true,
                order: 8
            },
            playbackRateMenuButton: {
                active: true,
                order: 9,
                rates: [5, 2, 1, 0.5, 0.1]
            },
            volumeMenuButton: {
                active: true,
                order: 10,
                direction: 'vertical' // vertical or horizontal
            },
            fullscreenToggle: {
                active: true,
                order: 11
            },
        }
    },
    drawingArea: {
        backgroundColor: "#fff",
    },
    hideFocusIcon: false, //Eğer "focus ikonlar" gözükmemesi gerekiyorsa true yapınınız. True da iken soru üzerine tıklanırsa soru açılır.
    hideShowIcon: false, // Show (Göz, anahtar) ikonların görünürlüğü
    hideTriggerIcon: true, //Sayfaya eklenen ses, viedo, html gibi etkinliklerin ikonların görünürlük ayarı
    hideDigitalContentButton: true, // Footerbar da yer alan dijital içerikler butonunun görünürlük ayarı
    
    showAreaHighlight: "#ff000010", // eğer hideShowIcon true ise kullanıcının nereye dokunacağını belirtmek için dokunma alanına belli bir renk verilebilir. Verilmez ise transparent olur.
    
    disableMobileDefaultHide: false, // Mobilde focus ve show ikonlar default olarak gözükmez. Bu değer ile default ayarı değiştirebilirsiniz.
    enableDoubleClick: false, //Silgi - Kalem ikilisi arasındaki geçişi uzun basma yerine çift tık olarak ayarlamak için true yapabilirsiniz.
    longPressDelay: 1000, // Silgi - Kalem arasındaki uzun basma süresi.
    
    // ilk açılış orta
    focusZoomToCenter: true, // true yapılırsa focus olduğunda sayfanın ortasına hizalar.

    
    defaultPageNumber: 1, //Kitap default olarak hangi sayfadan açılsın?
    
    defaultPageMode: 0, //0: SINGLE, 1: DUAL. Default olarak 0 ayarlıdır.  
    
    enableTestNavigation: false, // Eğer true yapılırsa sayfa numaraları olan yere testin kaçıncı soruda oldugu ve toplam test sorusu gösterilir.
    hidePageLoadingSkeleton: false, // Eğer true yapılırsa sayfa yüklenirken loading effect gizlenir.
    setBook: {
        enable: true,//true tek kitapda bile ise alt tarafta ana sayfa butonu çıkar ve bir üstteki index.html i açar.
    },
    externalbutton: {
        enable: false, // External butonun visible değeri
        icon:'core/externalButton.png', //Buton ikon değeri. Default değeri mevcut. Verilmesi zorunlu değil
        link:'/external/index.html',//https://www.impark.com.tr
    },
    exam: {
        enable: true,
        finishExamEndpoint: "https://apitest.dijitap.com/v1/Test/{userId}/saveanswer",
        getExamSolutionEndpoint: "https://apitest.dijitap.com/v1/Test/{userId}/zkitap/{zKitapId}/testanswers/{zKitapTestId}",
        isQuestionSolvedEndpoint: "http://localhost:4001/check-question"
    }
};
