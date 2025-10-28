# 🚀 Electron Multi-Platform Packager

A powerful desktop application for packaging web applications into native executables for Windows, macOS, Linux, Android, and PWA.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![Electron](https://img.shields.io/badge/electron-39.0.0-blue.svg)

## ✨ Features

### 🎯 Multi-Platform Support
- **🪟 Windows** - EXE installer with NSIS
- **🍎 macOS** - DMG with code signing support
- **🐧 Linux** - AppImage and DEB packages
- **🤖 Android** - APK via Capacitor
- **🌐 PWA** - Progressive Web App with manifest

### 🎨 Advanced Features
- **Custom Logo Support** - Use your own logo for all platforms
- **Queue Management** - Handle multiple packaging jobs efficiently
- **Real-time Progress** - WebSocket-based progress tracking
- **Modern Web UI** - Clean and intuitive interface
- **Automatic Icon Generation** - Convert logos to platform-specific formats
- **Build Caching** - Speed up repeated builds

## 📋 Requirements

- **Node.js** 18.0.0 or higher
- **npm** or **yarn**
- **4GB RAM** minimum (8GB recommended)
- **10GB free disk space**

### Platform-Specific Requirements

#### Windows Packaging:
- Windows 10/11 or macOS/Linux with Wine

#### macOS Packaging:
- macOS 10.13 or higher (for building)
- Xcode Command Line Tools

#### Linux Packaging:
- Any Linux distribution
- `fuse` for AppImage testing

#### Android Packaging:
- Java JDK 17
- Android SDK (automatically installed via Capacitor)

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/electron-multi-platform-packager.git
cd electron-multi-platform-packager

# Install dependencies
npm install

# Start the application
npm run electron
```

### First Build

1. **Upload Build Files**
   - Click "Upload Build" or drag & drop your ZIP file
   - ZIP should contain your web application files

2. **Configure**
   - Enter app name and version
   - Select target platforms
   - (Optional) Upload custom logo

3. **Start Packaging**
   - Click "Start Packaging"
   - Monitor progress in real-time
   - Download completed packages

## 📖 Usage

### Web Interface

The application provides a modern web interface accessible at `http://localhost:3000` when running in server mode, or through the Electron window.

#### Main Features:
- **Upload Management** - Drag & drop or browse for build files
- **Platform Selection** - Choose which platforms to build for
- **Queue View** - Monitor active and completed jobs
- **Logo Management** - Upload and manage custom logos
- **Settings** - Configure build options and preferences

### Command Line

```bash
# Start Electron app
npm run electron

# Start server only (no Electron window)
npm start

# Development mode with auto-reload
npm run dev
```

## 🎨 Logo Support

All platforms support custom logos:

| Platform | Format | Sizes |
|----------|--------|-------|
| Windows | ICO | 16, 32, 48, 64, 128, 256 |
| macOS | ICNS | 16, 32, 64, 128, 256, 512 |
| Linux | PNG | 512x512 |
| Android | PNG | 48, 72, 96, 144, 192 |
| PWA | PNG | 72, 96, 128, 144, 152, 192, 384, 512 |

**Recommended Logo:**
- Format: PNG with transparent background
- Size: 512x512 pixels minimum
- Aspect ratio: 1:1 (square)

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

Edit `package.json` to customize build settings:

```json
{
  "build": {
    "appId": "com.yourcompany.yourapp",
    "productName": "Your App Name",
    "win": {
      "target": "nsis",
      "certificateFile": "./certs/cert.pfx",
      "certificatePassword": "password"
    },
    "mac": {
      "category": "public.app-category.developer-tools",
      "hardenedRuntime": true
    }
  }
}
```

## 🏗️ Architecture

```
electron-multi-platform-packager/
├── src/
│   ├── main.js              # Electron main process
│   ├── client/              # Web UI
│   │   ├── public/
│   │   │   ├── index.html   # Main interface
│   │   │   └── app.js       # Frontend logic
│   │   └── settings.html    # Settings page
│   ├── server/              # Express server
│   │   ├── app.js           # Main server
│   │   └── localPackagingRoutes.js
│   ├── packaging/           # Packaging logic
│   │   └── packagingService.js
│   ├── services/            # Core services
│   │   ├── queueService.js  # Job queue
│   │   └── uploadService.js # File uploads
│   └── utils/               # Utilities
│       └── logoService.js   # Logo management
├── package.json
└── README.md
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific tests
npm run test:unit
npm run test:packaging
npm run test:dmg
```

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow existing code style
- Add tests for new features
- Update documentation
- Keep commits atomic and descriptive

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Electron](https://www.electronjs.org/)
- Packaging powered by [electron-builder](https://www.electron.build/)
- Android support via [Capacitor](https://capacitorjs.com/)
- Icons generated with [sharp](https://sharp.pixelplumbing.com/)

## 📧 Support

- **Issues:** [GitHub Issues](https://github.com/yourusername/electron-multi-platform-packager/issues)
- **Discussions:** [GitHub Discussions](https://github.com/yourusername/electron-multi-platform-packager/discussions)

## 🗺️ Roadmap

- [ ] iOS support via Capacitor
- [ ] Snap package for Linux
- [ ] Flatpak support
- [ ] Automated testing pipeline
- [ ] Plugin system for custom packaging steps
- [ ] Multi-language UI support
- [ ] Cloud build service integration

## ⭐ Star History

If you find this project useful, please consider giving it a star on GitHub!

---

**Made with ❤️ by the open source community**
