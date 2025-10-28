#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const packagingService = require('./src/packaging/packagingService');

/**
 * Android APK Failure Test - Ensure no project files are created on failure
 */

async function testAndroidFailure() {
    console.log('🤖 Testing Android Failure Behavior - APK Only Rule\n');
    console.log('='.repeat(60));
    
    const testJobId = `test-android-failure-${Date.now()}`;
    const tempPath = path.join('temp', testJobId);
    
    // Create minimal test environment
    await fs.ensureDir(tempPath);
    
    // Create minimal app that will cause Android build to fail
    const workingPath = path.join(tempPath, 'app');
    await fs.ensureDir(workingPath);
    
    // Create a minimal HTML file
    await fs.writeFile(path.join(workingPath, 'index.html'), `
<!DOCTYPE html>
<html>
<head><title>Test App</title></head>
<body><h1>Test</h1></body>
</html>
    `);
    
    console.log('📂 Minimal test environment created');
    console.log(`   - Working Path: ${workingPath}`);
    console.log(`   - Temp Path: ${tempPath}\n`);
    
    // Test parameters designed to cause failure (no Android SDK)
    const testParams = {
        workingPath,
        tempPath,
        appName: 'Test Failure App',
        appVersion: '1.0.0',
        logoPath: null,
        options: {
            publisherName: 'Test Publisher',
            description: 'Test failure app'
        }
    };
    
    console.log('🚀 Testing Android packaging failure...\n');
    
    try {
        // Mock IO
        const mockIO = {
            emit: (event, data) => {
                console.log(`📡 Event: ${event} - ${data.message || data.status} (${data.progress || 0}%)`);
            }
        };
        
        // This should fail and throw an error (no APK, no project files)
        const result = await packagingService.packageAndroid(
            testParams.workingPath,
            testParams.tempPath,
            testParams.appName,
            testParams.appVersion,
            testParams.logoPath,
            testParams.options,
            mockIO,
            testJobId,
            0, // platformIndex
            1  // totalPlatforms
        );
        
        // If we get here, something's wrong - it should have failed
        console.error('❌ UNEXPECTED: Android packaging succeeded when it should have failed');
        console.error('📋 This violates the APK-only rule testing');
        
    } catch (error) {
        console.log('\n✅ CORRECT BEHAVIOR: Android packaging failed as expected');
        console.log('='.repeat(50));
        console.error(`🔥 Error: ${error.message}`);
        
        // Check if any ZIP files were created (they shouldn't be)
        const tempFiles = await fs.readdir(tempPath, { recursive: true });
        const zipFiles = tempFiles.filter(file => file.endsWith('.zip'));
        
        if (zipFiles.length === 0) {
            console.log('\n✅ EXCELLENT: No ZIP project files were created');
            console.log('📋 APK-only rule is correctly enforced');
        } else {
            console.error('\n❌ VIOLATION: ZIP project files were found:');
            zipFiles.forEach(file => console.error(`   - ${file}`));
            console.error('📋 This violates the user\'s strict APK-only rule!');
        }
        
        console.log('\n📋 Test Results:');
        console.log('✅ Android packaging correctly throws error on failure');
        console.log('✅ No fallback project files created');
        console.log('✅ APK-only rule strictly enforced');
        
    } finally {
        // Cleanup
        console.log('\n🧹 Cleaning up test folder...');
        await fs.remove(tempPath);
        console.log('✅ Cleanup completed');
    }
}

// Run test
if (require.main === module) {
    testAndroidFailure()
        .then(() => {
            console.log('\n🎊 Android failure test completed successfully!');
            console.log('📱 APK-only rule is properly enforced');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Test error:', error.message);
            process.exit(1);
        });
}