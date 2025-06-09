export const Utils = {
    now: () => Math.floor(Date.now() / 1000),
    bytesToHex: bytes => bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), ''),
    hexToBytes: hex => new Uint8Array(hex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []),
    uint8ArrayToBase64: arr => btoa(String.fromCharCode(...arr)),
    base64ToUint8Array: s => new Uint8Array(atob(s).split("").map(c => c.charCodeAt(0))),
    shortenPubkey: p => p ? `${p.slice(0, 8)}...${p.slice(-4)}` : '?',
    formatTime: t => new Date(t * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
    escapeHtml: text => {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text?.replace(/[&<>"']/g, char => map[char]) ?? '';
    },
    findTag: (e, k) => e.tags.find(t => t[0] === k)?.[1],
    getUserColor: p => {
        const c = ['#4dabf7', '#20c997', '#f06595', '#cc5de8', '#5c7cfa', '#fcc419', '#ff8787', '#74b816'];
        return c[p ? Array.from(p).reduce((acc, char) => acc + char.charCodeAt(0), 0) % c.length : 0];
    },
    createAvatarSvg(text, seed) {
        const initial = (text?.charAt(0) || '?').toUpperCase(), color = Utils.getUserColor(seed);
        return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${Utils.escapeHtml(color)}"/><text x="50%" y="50%" font-size="50" dominant-baseline="central" text-anchor="middle" fill="white" font-family="system-ui, sans-serif">${Utils.escapeHtml(initial)}</text></svg>`)}`;
    },
    crypto: {
        aesEncrypt: async (plainText, keyBase64) => {
            const key = await Utils.crypto.importKeyFromBase64(keyBase64);
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const cipherText = await crypto.subtle.encrypt({name: "AES-GCM", iv: iv}, key, new TextEncoder().encode(plainText));
            return `${Utils.uint8ArrayToBase64(iv)}:${Utils.uint8ArrayToBase64(new Uint8Array(cipherText))}`;
        },
        aesDecrypt: async (encryptedData, keyBase64) => {
            try {
                const key = await Utils.crypto.importKeyFromBase64(keyBase64);
                const [ivBase64, cipherTextBase64] = encryptedData.split(':');
                if (!ivBase64 || !cipherTextBase64) throw new Error('Invalid encrypted data format');
                const plainText = await crypto.subtle.decrypt({
                    name: "AES-GCM",
                    iv: Utils.base64ToUint8Array(ivBase64)
                }, key, Utils.base64ToUint8Array(cipherTextBase64));
                return new TextDecoder().decode(plainText);
            } catch (err) {
                Logger.error('AES decryption failed:', err);
                throw err;
            }
        },
        exportKeyAsBase64: async key => Utils.uint8ArrayToBase64(new Uint8Array(await crypto.subtle.exportKey("raw", key))),
        importKeyFromBase64: keyBase64 => crypto.subtle.importKey("raw", Utils.base64ToUint8Array(keyBase64), {name: "AES-GCM"}, true, ["encrypt", "decrypt"])
    },
    validateRelayUrl: url => {
        try {
            const u = new URL(url);
            return u.protocol === 'wss:' && u.hostname;
        } catch {
            return false;
        }
    }
};

export const Logger = {
    log: (...a) => console.log('[N]', ...a),
    warn: (...a) => console.warn('[N]', ...a),
    error: (...a) => console.error('[N]', ...a)
};

export class EventEmitter {
    constructor() {
        this.listeners = {};
    }

    on(event, callback) {
        (this.listeners[event] = this.listeners[event] || []).push(callback);
        return () => this.off(event, callback);
    }

    off(event, callback) {
        this.listeners[event] = this.listeners[event]?.filter(cb => cb !== callback);
    }

    emit(event, data) {
        this.listeners[event]?.forEach(cb => cb(data));
    }
}
