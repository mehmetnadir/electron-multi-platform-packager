# 📦 Installation Guide - v1.0.0

## 🚀 Quick Start (Recommended)

### Prerequisites
- Node.js 18.0.0 or higher
- npm or yarn
- 4GB RAM minimum
- 10GB free disk space

### Installation Steps

#### 1. Download Release
```bash
# Download from GitHub Releases
# https://github.com/mehmetnadir/electron-multi-platform-packager/releases/tag/v1.0.0

# Or clone repository
git clone https://github.com/mehmetnadir/electron-multi-platform-packager.git
cd electron-multi-platform-packager
git checkout v1.0.0
```

#### 2. Install Dependencies
```bash
npm install
```

#### 3. Run the Application
```bash
npm run electron
```

That's it! The application will open in a new window.

---

## 🖥️ Platform-Specific Instructions

### macOS

```bash
# Install Node.js (if not installed)
brew install node

# Clone and run
git clone https://github.com/mehmetnadir/electron-multi-platform-packager.git
cd electron-multi-platform-packager
npm install
npm run electron
```

**Note:** On first run, macOS may ask for permissions. Click "Allow" when prompted.

### Windows

```bash
# Install Node.js from https://nodejs.org/

# Clone and run
git clone https://github.com/mehmetnadir/electron-multi-platform-packager.git
cd electron-multi-platform-packager
npm install
npm run electron
```

**Note:** Windows Defender may scan the application on first run. This is normal.

### Linux

```bash
# Install Node.js
sudo apt update
sudo apt install nodejs npm

# Clone and run
git clone https://github.com/mehmetnadir/electron-multi-platform-packager.git
cd electron-multi-platform-packager
npm install
npm run electron
```

**Note:** Some Linux distributions may require additional dependencies for Electron.

---

## 🎯 Alternative: Download Source ZIP

If you don't want to use git:

1. Go to: https://github.com/mehmetnadir/electron-multi-platform-packager/releases/tag/v1.0.0
2. Download `Source code (zip)`
3. Extract the ZIP file
4. Open terminal in extracted folder
5. Run:
   ```bash
   npm install
   npm run electron
   ```

---

## 🔧 Troubleshooting

### "npm: command not found"
Install Node.js from https://nodejs.org/

### "Permission denied" on macOS/Linux
```bash
sudo chown -R $(whoami) ~/.npm
```

### "EACCES" errors
```bash
npm install --unsafe-perm
```

### Electron fails to start
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
npm run electron
```

---

## 📚 Next Steps

After installation:
1. Read [GETTING_STARTED.md](GETTING_STARTED.md) for usage guide
2. Try packaging your first app
3. Check [README.md](README.md) for features
4. Join discussions on GitHub

---

## 🆘 Need Help?

- **Issues**: https://github.com/mehmetnadir/electron-multi-platform-packager/issues
- **Discussions**: https://github.com/mehmetnadir/electron-multi-platform-packager/discussions
- **Documentation**: README.md, GETTING_STARTED.md

---

**Enjoy packaging! 🎉**
