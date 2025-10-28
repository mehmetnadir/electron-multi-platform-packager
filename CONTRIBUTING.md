# Contributing to Electron Multi-Platform Packager

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## 🤝 How to Contribute

### Reporting Bugs

Before creating a bug report, please check existing issues to avoid duplicates.

**When reporting a bug, include:**
- OS version and architecture
- Node.js version
- Electron version
- Steps to reproduce
- Expected vs actual behavior
- Error messages and logs
- Screenshots if applicable

### Suggesting Features

Feature requests are welcome! Please:
- Check if the feature already exists
- Clearly describe the use case
- Explain why this feature would be useful
- Provide examples if possible

### Pull Requests

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/amazing-feature
   ```

3. **Make your changes**
   - Follow the existing code style
   - Add tests if applicable
   - Update documentation

4. **Commit your changes**
   ```bash
   git commit -m "feat: add amazing feature"
   ```
   
   Use conventional commits:
   - `feat:` new feature
   - `fix:` bug fix
   - `docs:` documentation
   - `style:` formatting
   - `refactor:` code restructuring
   - `test:` adding tests
   - `chore:` maintenance

5. **Push to your fork**
   ```bash
   git push origin feature/amazing-feature
   ```

6. **Open a Pull Request**
   - Describe your changes
   - Reference related issues
   - Include screenshots for UI changes

## 💻 Development Setup

### Prerequisites
- Node.js 18+
- npm or yarn
- Git

### Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/electron-multi-platform-packager.git
cd electron-multi-platform-packager

# Install dependencies
npm install

# Start development
npm run electron
```

## 📝 Code Style

### JavaScript
- Use ES6+ features
- 2 spaces for indentation
- Semicolons required
- Single quotes for strings
- Descriptive variable names

### Comments
- Use JSDoc for functions
- Explain complex logic
- Keep comments up to date

### Example:
```javascript
/**
 * Package application for specified platform
 * @param {string} platform - Target platform (windows, macos, linux)
 * @param {Object} options - Packaging options
 * @returns {Promise<Object>} Packaging result
 */
async function packageForPlatform(platform, options) {
  // Implementation
}
```

## 🧪 Testing

Currently, the project encourages contributors to test their changes manually:

1. Test on your target platform
2. Verify all features work
3. Check for console errors
4. Test edge cases

## 📚 Documentation

When adding features:
- Update README.md if needed
- Add inline code comments
- Update LOGO_SUPPORT.md for logo-related changes
- Create examples if helpful

## 🔍 Code Review Process

1. Maintainers will review your PR
2. Address any requested changes
3. Once approved, your PR will be merged
4. Your contribution will be credited

## 🎯 Priority Areas

Help is especially welcome in:
- Cross-platform testing
- Documentation improvements
- Bug fixes
- Performance optimizations
- UI/UX enhancements

## 📧 Questions?

- Open an issue for questions
- Use GitHub Discussions for general topics
- Be respectful and constructive

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing!** 🎉
