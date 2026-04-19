const { safeStorage } = require('electron')

/**
 * Wraps Electron's safeStorage API for encrypting sensitive strings
 * (connection passwords) using the OS keyring:
 *  - Windows: DPAPI (tied to current user account)
 *  - macOS:   Keychain Services
 *  - Linux:   libsecret / gnome-keyring / kwallet (must be installed)
 *
 * If the underlying keyring is unavailable (e.g. headless Linux without
 * libsecret), `isAvailable()` returns false and callers should fall back
 * to prompting the user — they must never persist plaintext silently.
 */
class CredentialStore {
  isAvailable() {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  /**
   * Encrypt a plaintext string. Returns a base64 string suitable for JSON
   * storage, or null if encryption is unavailable / fails.
   */
  encrypt(plaintext) {
    if (typeof plaintext !== 'string' || plaintext.length === 0) return null
    if (!this.isAvailable()) return null
    try {
      const buf = safeStorage.encryptString(plaintext)
      return buf.toString('base64')
    } catch {
      return null
    }
  }

  /**
   * Decrypt a base64-encoded encrypted string produced by encrypt().
   * Returns the plaintext or null if decryption fails (wrong user/OS,
   * corrupted blob, keyring unavailable).
   */
  decrypt(encryptedBase64) {
    if (typeof encryptedBase64 !== 'string' || encryptedBase64.length === 0) return null
    if (!this.isAvailable()) return null
    try {
      const buf = Buffer.from(encryptedBase64, 'base64')
      return safeStorage.decryptString(buf)
    } catch {
      return null
    }
  }
}

module.exports = new CredentialStore()
