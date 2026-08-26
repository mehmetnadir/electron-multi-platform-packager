'use strict';
const path = require('path');

/**
 * macOS imza konfigürasyonu — electron-builder `mac` bloğuna yayılır (2026-08-26).
 * Kimlik env'den (APPLE_SIGN_IDENTITY) gelir; yoksa eski ad-hoc davranış sürer ama
 * uyarı loglanır (Gatekeeper reddeder). İKİ derleme yolu da bunu kullanmalı:
 * `packaging/packagingService.js` (canlı /api/package yolu) ve
 * `platforms/macos/MacOSPackagingService.js`.
 */
const ENTITLEMENTS = path.resolve(__dirname, 'resources/entitlements.mac.plist');

function macSigningConfig(env = process.env, log = console) {
  const identity = (env.APPLE_SIGN_IDENTITY || '').trim();
  if (!identity) {
    if (log && typeof log.warn === 'function') {
      log.warn('⚠️ APPLE_SIGN_IDENTITY yok — .app ad-hoc imzalanacak, Gatekeeper reddeder');
    }
    return { hardenedRuntime: false, gatekeeperAssess: false, identity: null };
  }
  return {
    identity,
    hardenedRuntime: true,
    gatekeeperAssess: false,      // notarization ajan tarafında ayrı adım
    entitlements: ENTITLEMENTS,
    entitlementsInherit: ENTITLEMENTS,
    notarize: false,              // electron-builder notarize etmesin; ajan notarytool ile
    type: 'distribution',
  };
}

module.exports = { macSigningConfig, ENTITLEMENTS };
