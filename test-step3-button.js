/**
 * STEP 3 BUTTON TEST
 * Bu test Step 3'te buton metninin "İleri" olduğunu doğrular
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');

let testWindow;
let testResults = {
    total: 0,
    passed: 0,
    failed: 0,
    tests: []
};

async function runTests() {
    console.log('🧪 STEP 3 BUTTON TEST BAŞLIYOR');
    console.log('='.repeat(60));
    console.log('');

    // Test 1: totalSteps değeri
    await test('Test 1: totalSteps = 4', async () => {
        const result = await testWindow.webContents.executeJavaScript('app.totalSteps');
        console.log(`   totalSteps: ${result}`);
        if (result !== 4) {
            throw new Error(`totalSteps ${result} olmalı 4 değil!`);
        }
    });

    // Test 2: Step 1'de currentStep
    await test('Test 2: Step 1 - currentStep = 1', async () => {
        const result = await testWindow.webContents.executeJavaScript('app.currentStep');
        console.log(`   currentStep: ${result}`);
        if (result !== 1) {
            throw new Error(`Step 1'de currentStep ${result} olmalı 1 değil!`);
        }
    });

    // Test 3: Step 1'de buton metni
    await test('Test 3: Step 1 - Buton: "İleri"', async () => {
        const buttonText = await testWindow.webContents.executeJavaScript(
            'document.getElementById("btnNext").textContent.trim()'
        );
        console.log(`   Buton metni: "${buttonText}"`);
        if (!buttonText.includes('İleri')) {
            throw new Error(`Step 1'de buton "${buttonText}" olmalı "İleri" içermeli!`);
        }
    });

    // Test 4: Step 2'ye geç
    await test('Test 4: Step 1 → Step 2 geçiş', async () => {
        // Mock file upload
        await testWindow.webContents.executeJavaScript(`
            app.uploadedFile = { name: 'test.zip' };
            app.sessionId = 'test-session';
        `);
        
        // Next butonuna tıkla
        await testWindow.webContents.executeJavaScript('app.nextStep()');
        
        // Biraz bekle
        await sleep(500);
        
        const currentStep = await testWindow.webContents.executeJavaScript('app.currentStep');
        console.log(`   currentStep: ${currentStep}`);
        if (currentStep !== 2) {
            throw new Error(`Step 2'ye geçilmedi! currentStep: ${currentStep}`);
        }
    });

    // Test 5: Step 2'de buton metni
    await test('Test 5: Step 2 - Buton: "İleri"', async () => {
        const buttonText = await testWindow.webContents.executeJavaScript(
            'document.getElementById("btnNext").textContent.trim()'
        );
        console.log(`   Buton metni: "${buttonText}"`);
        if (!buttonText.includes('İleri')) {
            throw new Error(`Step 2'de buton "${buttonText}" olmalı "İleri" içermeli!`);
        }
    });

    // Test 6: Step 3'e geç
    await test('Test 6: Step 2 → Step 3 geçiş', async () => {
        // Mock form data
        await testWindow.webContents.executeJavaScript(`
            document.getElementById('appName').value = 'Test App';
            document.getElementById('appVersion').value = '1.0.0';
            document.getElementById('publisherSelect').innerHTML = '<option value="test-pub">Test Publisher</option>';
            document.getElementById('publisherSelect').value = 'test-pub';
        `);
        
        // Next butonuna tıkla
        await testWindow.webContents.executeJavaScript('app.nextStep()');
        
        // Biraz bekle
        await sleep(500);
        
        const currentStep = await testWindow.webContents.executeJavaScript('app.currentStep');
        console.log(`   currentStep: ${currentStep}`);
        if (currentStep !== 3) {
            throw new Error(`Step 3'e geçilmedi! currentStep: ${currentStep}`);
        }
    });

    // Test 7: Step 3'te buton metni - KRİTİK TEST!
    await test('Test 7: Step 3 - Buton: "İleri" (KRİTİK!)', async () => {
        const currentStep = await testWindow.webContents.executeJavaScript('app.currentStep');
        const totalSteps = await testWindow.webContents.executeJavaScript('app.totalSteps');
        const buttonText = await testWindow.webContents.executeJavaScript(
            'document.getElementById("btnNext").textContent.trim()'
        );
        
        console.log(`   currentStep: ${currentStep}`);
        console.log(`   totalSteps: ${totalSteps}`);
        console.log(`   Buton metni: "${buttonText}"`);
        console.log(`   currentStep === totalSteps: ${currentStep === totalSteps}`);
        
        if (buttonText.includes('Başlat')) {
            throw new Error(`❌ HATA! Step 3'te buton "Başlat" gösteriyor! Olmalı: "İleri"`);
        }
        
        if (!buttonText.includes('İleri')) {
            throw new Error(`❌ HATA! Step 3'te buton "${buttonText}" olmalı "İleri" içermeli!`);
        }
    });

    // Test 8: Step 4'e geç
    await test('Test 8: Step 3 → Step 4 geçiş', async () => {
        // Mock platform selection
        await testWindow.webContents.executeJavaScript(`
            app.selectedPlatforms = ['windows', 'macos'];
        `);
        
        // Next butonuna tıkla
        await testWindow.webContents.executeJavaScript('app.nextStep()');
        
        // Biraz bekle
        await sleep(500);
        
        const currentStep = await testWindow.webContents.executeJavaScript('app.currentStep');
        console.log(`   currentStep: ${currentStep}`);
        if (currentStep !== 4) {
            throw new Error(`Step 4'e geçilmedi! currentStep: ${currentStep}`);
        }
    });

    // Test 9: Step 4'te buton metni
    await test('Test 9: Step 4 - Buton: "Başlat"', async () => {
        const buttonText = await testWindow.webContents.executeJavaScript(
            'document.getElementById("btnNext").textContent.trim()'
        );
        console.log(`   Buton metni: "${buttonText}"`);
        if (!buttonText.includes('Başlat')) {
            throw new Error(`Step 4'te buton "${buttonText}" olmalı "Başlat" içermeli!`);
        }
    });

    // Summary
    console.log('');
    console.log('='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total:   ${testResults.total}`);
    console.log(`Passed:  ${testResults.passed} ✅`);
    console.log(`Failed:  ${testResults.failed} ❌`);
    console.log(`Success: ${Math.round((testResults.passed / testResults.total) * 100)}%`);
    console.log('');

    if (testResults.failed > 0) {
        console.log('❌ FAILED TESTS:');
        testResults.tests
            .filter(t => t.status === 'FAILED')
            .forEach(t => {
                console.log(`  • ${t.name}`);
                console.log(`    ${t.error}`);
            });
        console.log('');
    } else {
        console.log('🎉 ALL TESTS PASSED!');
        console.log('');
    }

    return testResults.failed === 0;
}

async function test(name, fn) {
    testResults.total++;
    try {
        await fn();
        testResults.passed++;
        testResults.tests.push({ name, status: 'PASSED' });
        console.log(`✅ ${name}`);
    } catch (error) {
        testResults.failed++;
        testResults.tests.push({ name, status: 'FAILED', error: error.message });
        console.log(`❌ ${name}`);
        console.log(`   Error: ${error.message}`);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Electron app ready
app.whenReady().then(async () => {
    testWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'src/preload.js')
        }
    });

    // Load app
    testWindow.loadURL('http://localhost:3000');

    // Wait for load
    await new Promise(resolve => {
        testWindow.webContents.on('did-finish-load', resolve);
    });

    // Wait for app to initialize
    await sleep(2000);

    // Run tests
    const success = await runTests();

    // Cleanup
    testWindow.close();
    app.quit();

    process.exit(success ? 0 : 1);
});

app.on('window-all-closed', () => {
    app.quit();
});
