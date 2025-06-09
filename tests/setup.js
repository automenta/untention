import { vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { Utils as RealUtils, Logger as RealLogger } from '../src/utils.js'; // Import real items

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
    getPublicKey: vi.fn(skUint8Array => `pk_for_${RealUtils.bytesToHex(skUint8Array)}`),
    generateSecretKey: vi.fn(() => new Uint8Array(32).fill(0xAA)),
    finalizeEvent: vi.fn((eventTemplate, sk) => ({
        ...eventTemplate,
        id: `mockEventId_${Math.random().toString(36).substring(2,10)}`,
        sig: 'mockSig',
        pubkey: `pk_for_${RealUtils.bytesToHex(sk)}`
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
// The actual `Utils` object with its functions will be imported by modules under test.
// We only mock the Logger part of it.
vi.mock('../src/utils.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual, // Exports EventEmitter, Utils object
    Logger: { // Mocked Logger
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    // If specific Utils functions need fine-grained mocking for some tests:
    // Utils: {
    //   ...actual.Utils,
    //   someFunctionToMock: vi.fn(),
    // }
  };
});
