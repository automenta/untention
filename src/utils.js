export const Utils = {
    now: () => Math.floor(Date.now() / 1000),
    bytesToHex: b => Array.from(b, byte => byte.toString(16).padStart(2, '0')).join(''),
    hexToBytes: h => new Uint8Array(h.match(/.{1,2}/g).map(b => parseInt(b, 16))),
    uint8ArrayToBase64: a => btoa(String.fromCharCode(...a)),
    base64ToUint8Array: s => new Uint8Array(atob(s).split("").map(c => c.charCodeAt(0))),
    shortenPubkey: p => p ? `${p.slice(0, 8)}...${p.slice(-4)}` : '?',
    formatTime: t => new Date(t * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
    // Corrected HTML escaping function
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
    createAvatarSvg(t, s) {
        const i = (t?.charAt(0) || '?').toUpperCase(), o = this.getUserColor(s);
        // Ensure the escaped text is used for the SVG content
        return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${this.escapeHtml(o)}"/><text x="50%" y="50%" font-size="50" dominant-baseline="central" text-anchor="middle" fill="white" font-family="system-ui, sans-serif">${this.escapeHtml(i)}</text></svg>`)}`;
    },
    crypto: {
        aesEncrypt: async (t, k) => {
            const e = await Utils.crypto.importKeyFromBase64(k), n = crypto.getRandomValues(new Uint8Array(12)),
                c = await crypto.subtle.encrypt({name: "AES-GCM", iv: n}, e, new TextEncoder().encode(t));
            return `${Utils.uint8ArrayToBase64(n)}:${Utils.uint8ArrayToBase64(new Uint8Array(c))}`;
        },
        aesDecrypt: async (t, k) => {
            try {
                const e = await Utils.crypto.importKeyFromBase64(k), [n, c] = t.split(':');
                if (!n || !c) throw new Error('Invalid encrypted data');
                const r = await crypto.subtle.decrypt({
                    name: "AES-GCM",
                    iv: Utils.base64ToUint8Array(n)
                }, e, Utils.base64ToUint8Array(c));
                return new TextDecoder().decode(r);
            } catch (e) {
                Logger.error('AES decryption failed:', e);
                throw e;
            }
        },
        exportKeyAsBase64: async k => Utils.uint8ArrayToBase64(new Uint8Array(await crypto.subtle.exportKey("raw", k))),
        importKeyFromBase64: k => crypto.subtle.importKey("raw", Utils.base64ToUint8Array(k), {name: "AES-GCM"}, !0, ["encrypt", "decrypt"])
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
