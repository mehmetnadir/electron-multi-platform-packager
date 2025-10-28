# 🚀 Electron Multi-Platform Packager

**Package web apps into native executables for Windows, macOS, Linux, Android, and PWA in 5 minutes!**

A powerful desktop application and build tool for packaging web applications into native executables. Supports Electron app packaging, automatic icon generation, and cross-platform builds with zero configuration.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![Electron](https://img.shields.io/badge/electron-39.0.0-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)
![Downloads](https://img.shields.io/github/downloads/mehmetnadir/electron-multi-platform-packager/total.svg)

**Keywords:** electron packager, electron builder, multi-platform packaging, cross-platform build tool, desktop app packager, icon generator, Windows app builder, macOS app builder, Linux app builder, Android APK builder, PWA generator, automated packaging, developer tools

## 🌟 Overview

Electron Multi-Platform Packager is a comprehensive solution for developers who need to package their web applications into native desktop and mobile applications. Built on top of industry-standard tools like Electron Builder and Capacitor, it provides a unified interface for multi-platform builds.

### 🎯 The Problem We Solve

**Traditional Way:**
- 6+ hours configuring electron-builder per platform
- Manually creating ICO, ICNS, and PNG icons in multiple sizes
- Complex platform-specific configurations
- Debugging obscure build errors

**Our Way:**
- ⚡ **5 minutes** from ZIP to native apps
- 🎨 **One PNG** → All icon formats automatically
- 🚀 **Zero configuration** required
- ✨ **Just upload and go!**

### Why This Tool?

- **Unified Workflow**: Package for 5 platforms from a single interface
- **Time Saving**: Save 97% of packaging time with automation
- **Automatic Icon Magic**: Upload one 512x512 PNG, get 25+ optimized icons
- **Professional Output**: Code-signing ready with proper app metadata
- **Queue Management**: Handle multiple packaging jobs efficiently
- **Real-time Feedback**: WebSocket-based progress tracking
- **No Platform Knowledge Needed**: We handle all the technical details

## ✨ Features

### 🎯 Multi-Platform Support

| Platform | Output Format | Features |
|----------|---------------|----------|
| 🪟 **Windows** | EXE + NSIS Installer | Code signing ready, custom icons, installer wizard |
| 🍎 **macOS** | DMG | Notarization ready, ICNS icons, app bundle |
| 🐧 **Linux** | AppImage + DEB | Desktop integration, portable execution |
| 🤖 **Android** | APK | Capacitor-based, adaptive icons, all densities |
| 🌐 **PWA** | Web App | Service worker, manifest, offline support |

### 🎨 Advanced Features

- **Custom Logo Support** - Automatically convert your logo to all platform-specific formats
- **Queue System** - Process multiple packaging jobs with priority management
- **Real-time Progress** - WebSocket-based live updates during packaging
- **Modern Web UI** - Clean, intuitive interface built with modern web standards
- **Automatic Icon Generation** - Convert single logo to ICO, ICNS, PNG in all required sizes
- **Build Caching** - Speed up repeated builds with intelligent caching

## 📋 Requirements

### System Requirements
- **Node.js** 18.0.0 or higher
- **npm** or **yarn**
- **4GB RAM** minimum (8GB recommended for Android builds)
- **10GB free disk space**

### Platform-Specific Requirements

#### For Windows Packaging:
- Windows 10/11 (native)
- OR macOS/Linux with Wine installed

#### For macOS Packaging:
- macOS 10.13 or higher
- Xcode Command Line Tools: `xcode-select --install`

#### For Linux Packaging:
- Any modern Linux distribution
- `fuse` package for AppImage testing

#### For Android Packaging:
- Java JDK 17
- Android SDK (automatically installed via Capacitor)
- 4GB additional RAM recommended

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/mehmetnadir/electron-multi-platform-packager.git
cd electron-multi-platform-packager

# Install dependencies
npm install

# Start the application
npm run electron
```

### First Build in 5 Minutes! ⚡

**The simplest workflow you'll ever use:**

1. **Build your web app** → Get a `build/` folder
2. **ZIP it** → `zip -r my-app.zip build/`
3. **Upload to our tool** → Drag & drop
4. **Add a logo** → One 512x512 PNG (we handle all formats!)
5. **Click "Start Packaging"** → Done!

**That's it!** Get Windows EXE, macOS DMG, Linux AppImage, and more!

📚 **Want detailed examples?** Check out [GETTING_STARTED.md](GETTING_STARTED.md) for:
- Real-world React app example
- What happens behind the scenes
- Logo magic explained
- Pro tips and best practices

## 📖 Usage

### Desktop Application Mode

```bash
# Start Electron app with GUI
npm run electron

# Development mode with DevTools
npm run electron-dev
```

The application will open with a modern web interface where you can:
- Upload and manage build files
- Configure packaging options
- Monitor active and completed jobs
- Manage custom logos
- View detailed logs

### Server Mode

```bash
# Start as web server only (no Electron window)
npm start

# Access via browser
open http://localhost:3000
```

### Development Mode

```bash
# Start with auto-reload
npm run dev
```

## 🎨 Logo Support

All platforms support custom logos with automatic format conversion:

### Supported Formats
- **Input**: PNG, JPG, JPEG, SVG
- **Recommended**: PNG with transparent background, 512x512px, 1:1 aspect ratio

### Platform-Specific Output

| Platform | Format | Sizes Generated |
|----------|--------|-----------------|
| Windows | ICO | 16, 32, 48, 64, 128, 256 |
| macOS | ICNS | 16, 32, 64, 128, 256, 512 |
| Linux | PNG | 512x512 |
| Android | PNG | 48, 72, 96, 144, 192 (mdpi to xxxhdpi) |
| PWA | PNG | 72, 96, 128, 144, 152, 192, 384, 512 |

### How It Works

1. Upload your logo (PNG, 512x512 recommended)
2. Logo is automatically converted to all required formats
3. Each platform receives optimized icons
4. Fallback to default icon if no logo provided

## 🔧 Configuration

### Environment Variables

Create a `.env` file in the root directory:

```bash
# Optional: Custom configuration directory
CONFIG_DIR=/path/to/config

# Optional: Server port (default: 3000)
PORT=3000

# Optional: Enable debug logging
DEBUG=true
```

### Build Configuration

Customize packaging in `package.json`:

```json
{
  "build": {
    "appId": "com.yourcompany.yourapp",
    "productName": "Your App Name",
    "win": {
      "target": "nsis",
      "certificateFile": "./certs/cert.pfx",
      "certificatePassword": "${CERT_PASSWORD}"
    },
    "mac": {
      "category": "public.app-category.developer-tools",
      "hardenedRuntime": true,
      "entitlements": "build/entitlements.mac.plist"
    },
    "linux": {
      "target": ["AppImage", "deb"],
      "category": "Development"
    }
  }
}
```

## 🏗️ Architecture

### Project Structure

```
electron-multi-platform-packager/
├── src/
│   ├── main.js                    # Electron main process
│   ├── preload.js                 # Preload script for security
│   │
│   ├── client/                    # Frontend
│   │   ├── public/
│   │   │   ├── index.html        # Main UI
│   │   │   ├── app.js            # Frontend logic
│   │   │   └── uploadManager.js  # File upload handling
│   │   └── settings.html         # Settings page
│   │
│   ├── server/                    # Backend
│   │   ├── app.js                # Express server
│   │   ├── localPackagingRoutes.js
│   │   ├── settingsRoutes.js
│   │   └── pwa-config-manager.js
│   │
│   ├── packaging/                 # Core packaging logic
│   │   ├── packagingService.js   # Main service
│   │   └── [platform templates]
│   │
│   ├── services/                  # Supporting services
│   │   ├── queueService.js       # Job queue management
│   │   ├── uploadService.js      # File upload handling
│   │   └── chunkedUploadService.js
│   │
│   ├── config/                    # Configuration
│   │   └── ConfigManager.js      # Settings management
│   │
│   └── utils/                     # Utilities
│       └── logoService.js        # Logo processing
│
├── package.json                   # Dependencies and scripts
├── README.md                      # This file
├── CONTRIBUTING.md                # Contribution guidelines
└── LICENSE                        # MIT License
```

### Technology Stack

**Core:**
- [Electron](https://www.electronjs.org/) - Desktop application framework
- [Node.js](https://nodejs.org/) - JavaScript runtime
- [Express.js](https://expressjs.com/) - Web server framework

**Packaging:**
- [electron-builder](https://www.electron.build/) - Windows, macOS, Linux packaging
- [Capacitor](https://capacitorjs.com/) - Android packaging
- [NSIS](https://nsis.sourceforge.io/) - Windows installer

**Image Processing:**
- [sharp](https://sharp.pixelplumbing.com/) - High-performance image processing
- [to-ico](https://www.npmjs.com/package/to-ico) - ICO file generation

**Real-time Communication:**
- [Socket.io](https://socket.io/) - WebSocket for live updates

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Quick Contribution Guide

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

### Areas for Contribution

- 🐛 Bug fixes
- 📚 Documentation improvements
- ✨ New features
- 🧪 Testing and QA
- 🌍 Translations
- 🎨 UI/UX improvements

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

### What This Means

- ✅ Commercial use allowed
- ✅ Modification allowed
- ✅ Distribution allowed
- ✅ Private use allowed
- ⚠️ No warranty provided
- ⚠️ No liability accepted

## 🙏 Acknowledgments

This project builds upon excellent open-source tools:

- **Electron** - Cross-platform desktop apps with web technologies
- **electron-builder** - Complete solution to package Electron apps
- **Capacitor** - Native mobile runtime for web apps
- **Sharp** - High-performance Node.js image processing
- **Express** - Fast, unopinionated web framework
- **Socket.io** - Real-time bidirectional event-based communication

## 📧 Support

- **Issues**: [GitHub Issues](https://github.com/mehmetnadir/electron-multi-platform-packager/issues)
- **Discussions**: [GitHub Discussions](https://github.com/mehmetnadir/electron-multi-platform-packager/discussions)
- **Documentation**: This README and inline code comments

## 🗺️ Roadmap

### Planned Features

- [ ] iOS support via Capacitor
- [ ] Snap package for Linux
- [ ] Flatpak support
- [ ] Windows Store (MSIX) packaging
- [ ] Automated testing pipeline
- [ ] Plugin system for custom build steps
- [ ] Multi-language UI support
- [ ] Cloud build service integration
- [ ] Build templates and presets
- [ ] Incremental update support

### In Progress

- [x] Multi-platform packaging
- [x] Custom logo support
- [x] Queue management
- [x] Real-time progress tracking
- [x] Modern web UI

## 📊 Project Stats

- **Platforms Supported**: 5 (Windows, macOS, Linux, Android, PWA)
- **Languages**: JavaScript (Node.js)
- **License**: MIT
- **Status**: Active Development

## ⭐ Star History

If you find this project useful, please consider giving it a star on GitHub! It helps others discover the project and motivates continued development.

---

**Built with ❤️ for the developer community**

*Making multi-platform packaging accessible to everyone*
