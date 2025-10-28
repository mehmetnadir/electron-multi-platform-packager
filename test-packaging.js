#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Test all platforms with the provided build
async function testAllPlatforms() {
    console.log('🚀 Starting comprehensive platform testing...\n');
    
    const buildPath = '/Users/nadir/01dev/elecron-paket/test-build';
    const tempDir = '/Users/nadir/01dev/elecron-paket/temp';
    const testJobId = `test-job-${Date.now()}`;
    const testJobPath = path.join(tempDir, testJobId);
    
    // Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Create test job directory and copy build
    console.log(`📁 Creating test directory: ${testJobPath}`);
    fs.mkdirSync(testJobPath, { recursive: true });
    
    console.log(`📁 Copying build to test directory...`);
    await copyDirectory(buildPath, path.join(testJobPath, 'app'));
    
    // Test each platform
    const platforms = [
        { name: 'Linux (AppImage)', platform: 'linux', target: 'AppImage' },
        { name: 'Linux (DEB)', platform: 'linux', target: 'deb' },
        { name: 'Windows (NSIS)', platform: 'windows', target: 'nsis' },
        { name: 'macOS (DMG)', platform: 'macos', target: 'dmg' },
        { name: 'Android (APK)', platform: 'android', target: 'apk' }
    ];
    
    for (const platformConfig of platforms) {
        console.log(`\n📦 Testing ${platformConfig.name}...`);
        console.log('='.repeat(50));
        
        try {
            await testPlatform(testJobPath, platformConfig);
            console.log(`✅ ${platformConfig.name} test completed`);
        } catch (error) {
            console.error(`❌ ${platformConfig.name} test failed:`);
            console.error(error.message);
            if (error.details) {
                console.error('Details:', error.details);
            }
        }
    }
    
    console.log('\n🏁 All platform tests completed!');
}

async function testPlatform(testJobPath, platformConfig) {
    const appPath = path.join(testJobPath, 'app');
    
    // Create package.json if it doesn't exist
    const packageJsonPath = path.join(appPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        console.log('📄 Creating package.json with proper author and dependencies...');
        const packageJson = {
            name: 'test-app',
            version: '1.0.0',
            description: 'Test application',
            main: 'electron.js',
            author: {
                name: 'Test Author',
                email: 'test@example.com'
            },
            homepage: 'https://example.com',
            scripts: {
                start: 'electron .'
            },
            dependencies: {},
            devDependencies: {
                electron: '^27.0.0'
            },
            build: {
                appId: 'com.test.app',
                productName: 'Test App',
                directories: {
                    output: '../dist'
                },
                files: [
                    "**/*",
                    "!node_modules",
                    "!temp",
                    "!uploads"
                ]
            }
        };
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
        
        // Install electron locally to prevent version detection errors
        console.log('🔧 Installing electron locally...');
        try {
            const { spawn } = require('child_process');
            await new Promise((resolve, reject) => {
                const child = spawn('npm', ['install', 'electron@^27.0.0', '--save-dev'], {
                    cwd: appPath,
                    stdio: 'pipe',
                    shell: true
                });
                
                child.stdout.on('data', (data) => {
                    console.log('NPM:', data.toString().trim());
                });
                
                child.stderr.on('data', (data) => {
                    console.error('NPM Error:', data.toString().trim());
                });
                
                child.on('close', (code) => {
                    if (code === 0) {
                        console.log('✅ Electron installed successfully');
                        resolve();
                    } else {
                        console.warn('⚠️ Electron installation failed, continuing...');
                        resolve(); // Don't fail the process
                    }
                });
                
                child.on('error', () => {
                    console.warn('⚠️ NPM not found, skipping electron installation...');
                    resolve();
                });
            });
        } catch (error) {
            console.warn('⚠️ Electron installation skipped:', error.message);
        }
    }
    
    switch (platformConfig.platform) {
        case 'linux':
            await testLinux(appPath, platformConfig.target);
            break;
        case 'windows':
            await testWindows(appPath);
            break;
        case 'macos':
            await testMacOS(appPath);
            break;
        case 'android':
            await testAndroid(testJobPath);
            break;
    }
}

async function testLinux(appPath, target) {
    console.log(`🐧 Testing Linux ${target.toUpperCase()}...`);
    
    // Check for required files
    const electronJs = path.join(appPath, 'electron.js');
    if (!fs.existsSync(electronJs)) {
        throw new Error('electron.js not found');
    }
    
    // Try to build
    const buildCommand = target === 'AppImage' ? 'build --linux AppImage' : 'build --linux deb';
    console.log(`Running: npx electron-builder ${buildCommand}`);
    
    return new Promise((resolve, reject) => {
        const child = spawn('npx', ['electron-builder', ...buildCommand.split(' ').slice(1)], {
            cwd: appPath,
            stdio: ['inherit', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
            stdout += data;
            console.log(data.toString());
        });
        
        child.stderr.on('data', (data) => {
            stderr += data;
            console.error(data.toString());
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Linux ${target} build failed with code ${code}`, { details: stderr }));
            }
        });
    });
}

async function testWindows(appPath) {
    console.log('🪟 Testing Windows NSIS...');
    
    const buildCommand = 'build --windows nsis';
    console.log(`Running: npx electron-builder ${buildCommand}`);
    
    return new Promise((resolve, reject) => {
        const child = spawn('npx', ['electron-builder', '--windows', 'nsis'], {
            cwd: appPath,
            stdio: ['inherit', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
            stdout += data;
            console.log(data.toString());
        });
        
        child.stderr.on('data', (data) => {
            stderr += data;
            console.error(data.toString());
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Windows NSIS build failed with code ${code}`, { details: stderr }));
            }
        });
    });
}

async function testMacOS(appPath) {
    console.log('🍎 Testing macOS DMG...');
    
    // First check if the electron.js runs without syntax errors
    console.log('Checking electron.js for syntax errors...');
    try {
        // Check syntax only, don't try to require electron module
        const electronJsContent = fs.readFileSync(path.join(appPath, 'electron.js'), 'utf8');
        // Simple syntax check by creating a function
        new Function(electronJsContent.replace(/require\('electron'\)/g, '{}'));
        console.log('✅ electron.js syntax check passed');
    } catch (error) {
        console.error('❌ electron.js syntax error:', error.message);
        throw new Error(`macOS runtime error: ${error.message}`);
    }
    
    const buildCommand = 'build --mac dmg';
    console.log(`Running: npx electron-builder ${buildCommand}`);
    
    return new Promise((resolve, reject) => {
        const child = spawn('npx', ['electron-builder', '--mac', 'dmg'], {
            cwd: appPath,
            stdio: ['inherit', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
            stdout += data;
            console.log(data.toString());
        });
        
        child.stderr.on('data', (data) => {
            stderr += data;
            console.error(data.toString());
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`macOS DMG build failed with code ${code}`, { details: stderr }));
            }
        });
    });
}

async function testAndroid(testJobPath) {
    console.log('🤖 Testing Android APK...');
    
    const androidPath = path.join(testJobPath, 'android');
    const webappPath = path.join(androidPath, 'webapp');
    
    // Check if android directory structure exists
    if (!fs.existsSync(androidPath)) {
        throw new Error('Android directory not found - APK build not possible');
    }
    
    // Check for gradlew
    const gradlewPath = path.join(webappPath, 'gradlew');
    if (!fs.existsSync(gradlewPath)) {
        throw new Error('gradlew not found in Android project');
    }
    
    console.log('Running: ./gradlew assembleRelease');
    
    return new Promise((resolve, reject) => {
        const child = spawn('./gradlew', ['assembleRelease'], {
            cwd: webappPath,
            stdio: ['inherit', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
            stdout += data;
            console.log(data.toString());
        });
        
        child.stderr.on('data', (data) => {
            stderr += data;
            console.error(data.toString());
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Android APK build failed with code ${code}`, { details: stderr }));
            }
        });
    });
}

async function copyDirectory(src, dest) {
    return new Promise((resolve, reject) => {
        const cp = spawn('cp', ['-r', src, dest], {
            stdio: 'inherit'
        });
        
        cp.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Failed to copy directory: ${code}`));
            }
        });
    });
}

// Run the test
if (require.main === module) {
    testAllPlatforms().catch(console.error);
}

module.exports = { testAllPlatforms };