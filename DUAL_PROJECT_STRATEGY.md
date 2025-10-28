# 🔄 Dual Project Strategy

## 🎯 **Strategy Overview**

Maintain two versions of the project:
1. **Open Source Version** - Public, generic, community-driven
2. **Private Version** - Custom features, publisher integrations

Both versions share the same code signing certificate from SignPath.io!

---

## 📦 **Project Structure**

```
/Users/nadir/01dev/
├── electron-multi-platform-packager/  # Open Source (NEW)
│   ├── .git/                          # Public GitHub repo
│   ├── src/
│   │   ├── packaging/                 # Core packaging (shared)
│   │   ├── services/                  # Queue, upload (shared)
│   │   ├── client/                    # Generic UI (English)
│   │   └── server/                    # Local packaging only
│   ├── README.md                      # English docs
│   ├── LICENSE                        # MIT
│   └── package.json
│
└── elecron-paket/                     # Private (EXISTING)
    ├── .git/                          # Private/local repo
    ├── src/
    │   ├── packaging/                 # Core packaging (synced)
    │   ├── services/                  # + Email, custom features
    │   ├── client/                    # Turkish UI + custom
    │   └── server/                    # + Remote packaging, Akıllı Tahta
    ├── README.md                      # Turkish docs
    └── package.json
```

---

## 🔐 **Code Signing Strategy**

### **How It Works:**

1. **Open Source Project** gets SignPath.io certificate
2. **Private Project** uses the SAME certificate
3. Both projects sign with the same identity

```javascript
// Both projects use same signing config
{
  "certificateSubjectName": "Electron Multi-Platform Packager",
  "certificateSha1": "SAME_HASH_FROM_SIGNPATH",
  "signingHashAlgorithms": ["sha256"]
}
```

### **Why This Works:**
- ✅ SignPath.io certificate is for the TOOL, not specific apps
- ✅ You're the maintainer of both projects
- ✅ Private project is just a fork with extra features
- ✅ Same code signing identity = same trust

---

## 🔄 **Sync Strategy**

### **Shared Code (Core Features):**

```bash
# Core modules to keep in sync
src/packaging/packagingService.js    # Main packaging logic
src/packaging/platforms/             # Platform-specific code
src/services/queueService.js         # Queue management
src/utils/logoService.js             # Logo handling
```

### **Sync Method:**

#### **Option 1: Git Subtree (Recommended)**
```bash
# In private project
git subtree add --prefix=core ../electron-multi-platform-packager main --squash

# Update from open source
git subtree pull --prefix=core ../electron-multi-platform-packager main --squash

# Push changes back to open source
git subtree push --prefix=core ../electron-multi-platform-packager main
```

#### **Option 2: Symlinks**
```bash
# In private project
ln -s ../electron-multi-platform-packager/src/packaging src/packaging-core
```

#### **Option 3: npm Package (Future)**
```bash
# Publish open source as npm package
npm install @yourname/electron-packager

# Use in private project
const packager = require('@yourname/electron-packager');
```

---

## 📋 **Feature Comparison**

| Feature | Open Source | Private |
|---------|-------------|---------|
| **Core Packaging** |
| Windows EXE | ✅ | ✅ |
| macOS DMG | ✅ | ✅ |
| Linux AppImage | ✅ | ✅ |
| Android APK | ✅ | ✅ |
| PWA | ✅ | ✅ |
| **UI** |
| Web Interface | ✅ English | ✅ Turkish |
| Queue Management | ✅ | ✅ |
| Progress Tracking | ✅ | ✅ |
| Logo Support | ✅ | ✅ |
| **Advanced Features** |
| Local Packaging | ✅ | ✅ |
| Remote Packaging | ❌ | ✅ |
| Akıllı Tahta Integration | ❌ | ✅ |
| Publisher Management | ❌ | ✅ |
| Email Notifications | ❌ | ✅ |
| Google Drive Sync | ❌ | ✅ |
| Custom Branding | ❌ | ✅ |
| **Code Signing** |
| SignPath.io Cert | ✅ | ✅ (same) |
| Self-signed | ✅ | ✅ |

---

## 🚀 **Implementation Steps**

### **Phase 1: Create Open Source Version (4-6 hours)**

#### **Step 1: Clone and Clean**
```bash
# Create new directory
cd /Users/nadir/01dev/
cp -r elecron-paket electron-multi-platform-packager
cd electron-multi-platform-packager

# Remove git history
rm -rf .git
git init
```

#### **Step 2: Remove Private Features**
```bash
# Delete files
rm -rf src/server/akillitahtaRoutes.js
rm -rf src/server/akillitahtaPublishersRoutes.js
rm -rf src/server/remotePackagingRoutes.js
rm -rf src/services/emailService.js
rm -rf test-email.js
rm -rf MAILJET_SETUP.md
```

#### **Step 3: Clean Code**
```javascript
// src/server/app.js
// Remove these lines:
// const akillitahtaRoutes = require('./akillitahtaRoutes');
// const akillitahtaPublishersRoutes = require('./akillitahtaPublishersRoutes');
// const remotePackagingRoutes = require('./remotePackagingRoutes');
// app.use('/api', akillitahtaRoutes);
// app.use('/api', akillitahtaPublishersRoutes);
// app.use('/api', remotePackagingRoutes);
```

#### **Step 4: Translate to English**
```bash
# Use find & replace
# Turkish → English translations
# See TRANSLATION_MAP.md
```

#### **Step 5: Documentation**
```bash
# Create
README.md (English)
CONTRIBUTING.md
LICENSE (MIT)
CODE_OF_CONDUCT.md
.github/ISSUE_TEMPLATE/
.github/PULL_REQUEST_TEMPLATE.md
```

#### **Step 6: GitHub Setup**
```bash
# Create repo
gh repo create electron-multi-platform-packager --public

# Push
git add .
git commit -m "Initial open source release"
git push -u origin main
```

---

### **Phase 2: SignPath.io Application (30 min)**

#### **Application Details:**
```
Project Name: Electron Multi-Platform Packager
Project URL: https://github.com/yourusername/electron-multi-platform-packager
License: MIT
Description: Free and open source tool for packaging Electron applications 
             into native executables for Windows, macOS, and Linux
Purpose: Educational and development tool
Non-profit: Yes
Free distribution: Yes
```

#### **Wait for Approval:**
- ⏱️ Usually 1-5 business days
- 📧 Email notification
- 🔐 Certificate details provided

---

### **Phase 3: Configure Private Project (1 hour)**

#### **Step 1: Update Signing Config**
```javascript
// elecron-paket/package.json
{
  "build": {
    "win": {
      "certificateSubjectName": "Electron Multi-Platform Packager",
      "signingHashAlgorithms": ["sha256"],
      "rfc3161TimeStampServer": "http://timestamp.sectigo.com"
    }
  }
}
```

#### **Step 2: Environment Variables**
```bash
# elecron-paket/.env
# Add SignPath.io credentials (when approved)
SIGNPATH_API_TOKEN=xxx
SIGNPATH_ORGANIZATION_ID=xxx
SIGNPATH_PROJECT_SLUG=electron-multi-platform-packager
```

#### **Step 3: Signing Service**
```javascript
// elecron-paket/src/services/signingService.js
// Create wrapper for SignPath.io API
// Both projects use same service
```

---

## 🔄 **Maintenance Workflow**

### **Scenario 1: Bug Fix in Core**

```bash
# Fix in open source
cd electron-multi-platform-packager
# Make fix
git commit -m "fix: packaging bug"
git push

# Sync to private
cd ../elecron-paket
git subtree pull --prefix=core ../electron-multi-platform-packager main --squash
```

### **Scenario 2: New Feature in Private**

```bash
# Add feature in private
cd elecron-paket
# Add Akıllı Tahta feature
git commit -m "feat: add publisher integration"
# Keep private, don't sync
```

### **Scenario 3: Core Improvement**

```bash
# Improve in private first
cd elecron-paket
# Improve packaging logic
git commit -m "feat: improve packaging speed"

# Extract and push to open source
cd ../electron-multi-platform-packager
# Cherry-pick or manual merge
git commit -m "feat: improve packaging speed"
git push
```

---

## 📊 **Benefits**

### **For Open Source Project:**
- ✅ Free code signing
- ✅ Community contributions
- ✅ Bug reports and fixes
- ✅ Portfolio/reputation
- ✅ Wider testing

### **For Private Project:**
- ✅ Same code signing certificate
- ✅ Custom features
- ✅ Publisher integrations
- ✅ Proprietary improvements
- ✅ Core improvements from community

### **For Users:**
- ✅ Free tool available
- ✅ Professional signed apps
- ✅ Active development
- ✅ Multiple options

---

## ⚠️ **Important Notes**

### **1. Certificate Usage:**
```
✅ DO: Use same cert for both projects
✅ DO: Sign apps created by both tools
✅ DO: Maintain open source actively
❌ DON'T: Abuse fair use policy
❌ DON'T: Sign unrelated apps
❌ DON'T: Violate SignPath.io terms
```

### **2. Code Sharing:**
```
✅ DO: Share core packaging logic
✅ DO: Contribute improvements back
✅ DO: Keep APIs compatible
❌ DON'T: Copy private features to open source
❌ DON'T: Expose API keys/secrets
❌ DON'T: Include publisher-specific code
```

### **3. Branding:**
```
Open Source: "Electron Multi-Platform Packager"
Private: "Kitap Paketleme Servisi" (or keep current)

Both use same signing identity:
"Electron Multi-Platform Packager"
```

---

## 🎯 **Success Metrics**

### **Open Source Project:**
- [ ] GitHub stars: 100+ (6 months)
- [ ] Contributors: 5+ (1 year)
- [ ] Issues/PRs: Active
- [ ] SignPath.io approved
- [ ] Documentation complete

### **Private Project:**
- [ ] All features working
- [ ] Using SignPath.io cert
- [ ] Publisher integrations stable
- [ ] Core synced with open source

---

## 📅 **Timeline**

| Task | Duration | Priority |
|------|----------|----------|
| Create open source version | 4-6 hours | HIGH |
| Documentation | 2-3 hours | HIGH |
| GitHub setup | 30 min | HIGH |
| SignPath.io application | 30 min | HIGH |
| Wait for approval | 1-5 days | - |
| Configure private project | 1 hour | MEDIUM |
| Test signing | 1 hour | HIGH |
| **TOTAL** | **9-12 hours + waiting** | |

---

## 🚀 **Next Steps**

1. **Review this strategy**
2. **Approve project names**
3. **Start Phase 1: Create open source version**
4. **Apply to SignPath.io**
5. **Configure private project**
6. **Test both versions**

---

**Ready to start? 🎉**
