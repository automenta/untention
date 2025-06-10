import { vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { Logger as RealLogger } from '../src/logger.js'; // Import real items
import * as RealCryptoUtils from '../src/utils/crypto-utils.js'; // For NostrTools mock

// --- Crypto Polyfills ---
if (typeof globalThis.crypto === 'undefined') {
    vi.stubGlobal('crypto', webcrypto);
} else {
    if (!globalThis.crypto.subtle) globalThis.crypto.subtle = webcrypto.subtle;
    if (!globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues = webcrypto.getRandomValues;
}
if (typeof globalThis.CryptoKey === 'undefined' && typeof webcrypto.CryptoKey !== 'undefined') {
    vi.stubGlobal('CryptoKey', webcrypto.CryptoKey);
}

// --- btoa / atob Polyfills ---
if (typeof globalThis.btoa === 'undefined') {
    vi.stubGlobal('btoa', (str) => Buffer.from(str, 'binary').toString('base64'));
}
if (typeof globalThis.atob === 'undefined') {
    vi.stubGlobal('atob', (b64Encoded) => Buffer.from(b64Encoded, 'base64').toString('binary'));
}

// --- Mock localforage global ---
globalThis.mockLocalForageStore = {};
const localforageMock = {
  getItem: vi.fn(key => Promise.resolve(globalThis.mockLocalForageStore[key] !== undefined ? globalThis.mockLocalForageStore[key] : null)),
  setItem: vi.fn((key, value) => { globalThis.mockLocalForageStore[key] = value; return Promise.resolve(value); }),
  removeItem: vi.fn(key => { delete globalThis.mockLocalForageStore[key]; return Promise.resolve(); }),
  clear: vi.fn(() => { globalThis.mockLocalForageStore = {}; return Promise.resolve(); }),
  keys: vi.fn(() => Promise.resolve(Object.keys(globalThis.mockLocalForageStore))),
};
vi.stubGlobal('localforage', localforageMock);

// --- Mock NostrTools global ---
// This is the global variable `NostrTools` that `src/nostr.js` and `src/store.js` expect.
const mockSimplePoolInstance = {
  subscribe: vi.fn(() => ({ unsub: vi.fn() })),
  publish: vi.fn((relays, event) => Promise.resolve([])), // Simulates successful publish to at least one relay
  get: vi.fn((relays, filter) => Promise.resolve(null)),
  querySync: vi.fn((relays, filter) => []), // Nostr.js uses this, it's not standard NostrTools
  close: vi.fn(),
};

const nostrToolsMock = {
    getPublicKey: vi.fn(skUint8Array => `pk_for_${RealCryptoUtils.bytesToHex(skUint8Array)}`),
    generateSecretKey: vi.fn(() => new Uint8Array(32).fill(0xAA)),
    finalizeEvent: vi.fn((eventTemplate, sk) => ({
        ...eventTemplate,
        id: `mockEventId_${Math.random().toString(36).substring(2,10)}`,
        sig: 'mockSig',
        pubkey: `pk_for_${RealCryptoUtils.bytesToHex(sk)}`
    })),
    verifyEvent: vi.fn(() => true),
    nip04: {
        encrypt: vi.fn(async (sk, pk, text) => `nip04encrypted(${text},${pk})`),
        decrypt: vi.fn(async (sk, pk, text) => {
            if (text && text.startsWith('nip04encrypted(') && text.endsWith(`,${pk})`)) {
                return text.substring('nip04encrypted('.length, text.lastIndexOf(`,${pk}`));
            }
            throw new Error('NIP04 decryption failed in mock');
        }),
    },
    nip19: {
        decode: vi.fn((id = "") => ({ type: id.substring(0,4) || 'n', data: id.substring(4)})),
        npubEncode: vi.fn(hex => `npub${hex}`),
        nsecEncode: vi.fn(hex => `nsec${hex}`),
        noteEncode: vi.fn(hex => `note${hex}`),
    },
    SimplePool: vi.fn(() => mockSimplePoolInstance),
    _mockSimplePoolInstance: mockSimplePoolInstance, // For tests to access/reset easily
};
vi.stubGlobal('NostrTools', nostrToolsMock);


// --- Mock for src/utils.js Logger ---
// This allows us to spy on Logger.log, .warn, .error calls
// We fully mock the Logger class and its static methods.
vi.mock('../src/logger.js', () => ({
  Logger: {
    setDebugMode: vi.fn(),
    isDebugMode: vi.fn(),
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    logWithContext: vi.fn(),
    infoWithContext: vi.fn(),
    warnWithContext: vi.fn(),
    errorWithContext: vi.fn(),
    debug: vi.fn(),
  }
}));
