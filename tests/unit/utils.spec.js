import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Utils, Logger, EventEmitter } from '../../src/utils.js';

// Mocking for crypto.subtle and crypto.getRandomValues if not fully supported or for consistent IVs
// For this test suite, we'll rely on jsdom's Web Crypto API support.
// If specific errors arise, explicit mocks might be needed.

// Mock NostrTools if it were a direct dependency of utils.js and used for nip19, etc.
// For now, utils.js doesn't directly use nip19ToHex, so no mock needed here for that.

describe('Utils', () => {
  describe('now()', () => {
    it('should return a number (timestamp)', () => {
      const timestamp = Utils.now();
      expect(typeof timestamp).toBe('number');
      expect(timestamp).toBeGreaterThan(1600000000); // A reasonable lower bound for Unix timestamps
      expect(timestamp).toBeLessThan(Date.now() / 1000 + 1);
    });
  });

  describe('hexToBytes()', () => {
    it('should convert valid hex strings to Uint8Array', () => {
      expect(Utils.hexToBytes('48656c6c6f')).toEqual(new Uint8Array([72, 101, 108, 108, 111])); // "Hello"
      expect(Utils.hexToBytes('010203')).toEqual(new Uint8Array([1, 2, 3]));
      expect(Utils.hexToBytes('abcdef')).toEqual(new Uint8Array([171, 205, 239]));
    });

    it('should return an empty Uint8Array for an empty string', () => {
      expect(Utils.hexToBytes('')).toEqual(new Uint8Array([]));
    });

    it('should return an empty Uint8Array for null or undefined input', () => {
      expect(Utils.hexToBytes(null)).toEqual(new Uint8Array([]));
      expect(Utils.hexToBytes(undefined)).toEqual(new Uint8Array([]));
    });

    it('should throw an error for invalid hex strings (non-hex characters)', () => {
      expect(() => Utils.hexToBytes('48656c6c6g')).toThrow('Invalid hex string'); // 'g' is not hex
      expect(() => Utils.hexToBytes('1234xx')).toThrow('Invalid hex string');
    });

    it('should handle hex strings with odd length by ignoring the last character if match fails, or parsing if match succeeds', () => {
      // Current implementation: hex.match(/.{1,2}/g) will make "abc" -> ["ab", "c"]
      // parseInt("c", 16) is 12. So it becomes [171, 12]
      expect(Utils.hexToBytes('abc')).toEqual(new Uint8Array([171, 12]));
      expect(Utils.hexToBytes('a')).toEqual(new Uint8Array([10]));
    });
  });

  describe('bytesToHex()', () => {
    it('should convert Uint8Array to hex string', () => {
      expect(Utils.bytesToHex(new Uint8Array([72, 101, 108, 108, 111]))).toBe('48656c6c6f');
      expect(Utils.bytesToHex(new Uint8Array([1, 2, 3]))).toBe('010203');
      expect(Utils.bytesToHex(new Uint8Array([171, 205, 239]))).toBe('abcdef');
    });

    it('should return an empty string for an empty Uint8Array', () => {
      expect(Utils.bytesToHex(new Uint8Array([]))).toBe('');
    });
  });

  describe('uint8ArrayToBase64() and base64ToUint8Array()', () => {
    it('should correctly convert Uint8Array to base64 and back', () => {
      const original = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const base64 = Utils.uint8ArrayToBase64(original);
      expect(base64).toBe('SGVsbG8=');
      const decoded = Utils.base64ToUint8Array(base64);
      expect(decoded).toEqual(original);
    });

    it('should handle empty Uint8Array', () => {
      const original = new Uint8Array([]);
      const base64 = Utils.uint8ArrayToBase64(original);
      expect(base64).toBe('');
      const decoded = Utils.base64ToUint8Array(base64);
      expect(decoded).toEqual(original);
    });
  });

  describe('shortenPubkey()', () => {
    it('should shorten a typical pubkey', () => {
      const pubkey = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      expect(Utils.shortenPubkey(pubkey)).toBe('12345678...cdef');
    });

    it('should return "?" for empty or undefined pubkey', () => {
      expect(Utils.shortenPubkey('')).toBe('?');
      expect(Utils.shortenPubkey(null)).toBe('?');
      expect(Utils.shortenPubkey(undefined)).toBe('?');
    });

    it('should handle pubkeys shorter than 12 characters', () => {
      expect(Utils.shortenPubkey('12345')).toBe('12345...2345'); // Current behavior might be different, let's check
      // Based on implementation: `${p.slice(0, 8)}...${p.slice(-4)}`
      // If p.length < 8, p.slice(0,8) is p. p.slice(-4) is p if p.length < 4, else last 4.
      expect(Utils.shortenPubkey('short')).toBe('short...hort');
      expect(Utils.shortenPubkey('s')).toBe('s...s');
    });
  });

  describe('formatTime()', () => {
    it('should format a Unix timestamp into a locale time string', () => {
      // This test can be a bit flaky depending on the test environment's locale
      // For consistency, we might need to mock the locale or check for a pattern
      const timestamp = 1678886400; // March 15, 2023 12:00:00 PM UTC
      const formattedTime = Utils.formatTime(timestamp);
      // Example: "12:00 PM" or "12:00" or "07:00 AM" depending on locale.
      // We'll check if it matches a general time pattern HH:MM AM/PM or HH:MM
      expect(formattedTime).toMatch(/^\d{1,2}:\d{2}(\s(AM|PM))?$/i);
    });
  });

  describe('validateRelayUrl()', () => {
    it('should return hostname for valid wss:// URLs', () => {
      expect(Utils.validateRelayUrl('wss://relay.example.com')).toBe('relay.example.com');
      expect(Utils.validateRelayUrl('wss://another.relay.org/path')).toBe('another.relay.org');
    });

    it('should return false for ws:// URLs', () => {
      expect(Utils.validateRelayUrl('ws://relay.example.com')).toBe(false);
    });

    it('should return false for http:// or https:// URLs', () => {
      expect(Utils.validateRelayUrl('http://relay.example.com')).toBe(false);
      expect(Utils.validateRelayUrl('https://relay.example.com')).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      expect(Utils.validateRelayUrl('invalid-url')).toBe(false);
      expect(Utils.validateRelayUrl('')).toBe(false);
      expect(Utils.validateRelayUrl(null)).toBe(false);
      expect(Utils.validateRelayUrl('wss://')).toBe(false); // No hostname
    });
  });

  describe('escapeHtml()', () => {
    it('should escape HTML special characters', () => {
      expect(Utils.escapeHtml('<div class="test">Hello & World "!" \'Done\'</div>'))
        .toBe('&lt;div class=&quot;test&quot;&gt;Hello &amp; World &quot;!&quot; &#039;Done&#039;&lt;/div&gt;');
    });

    it('should return an empty string if input is null or undefined', () => {
      expect(Utils.escapeHtml(null)).toBe('');
      expect(Utils.escapeHtml(undefined)).toBe('');
    });

    it('should not change strings without special characters', () => {
      expect(Utils.escapeHtml('Hello World')).toBe('Hello World');
    });
  });

  describe('Utils.crypto', () => {
    let keyBase64;
    const plainText = "Hello, Nostr!";

    beforeEach(async () => {
      // Generate a fresh key for each test
      // Attempt to use globalThis.crypto explicitly for diagnostics
      const cryptoRef = typeof crypto !== 'undefined' ? crypto : globalThis.crypto;
      const key = await cryptoRef.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
      keyBase64 = await Utils.crypto.exportKeyAsBase64(key);
    });

    describe('exportKeyAsBase64() and importKeyFromBase64()', () => {
        it('should export a key to Base64 and import it back', async () => {
            const importedKey = await Utils.crypto.importKeyFromBase64(keyBase64);
            expect(importedKey).toBeInstanceOf(CryptoKey);
            expect(importedKey.type).toBe("secret");
            expect(importedKey.algorithm.name).toBe("AES-GCM");
        });

        it('exported key should be a valid base64 string', () => {
            expect(typeof keyBase64).toBe('string');
            // Basic base64 check (can be more robust)
            expect(keyBase64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
        });
    });

    describe('aesEncrypt() and aesDecrypt()', () => {
      it('should encrypt and decrypt data successfully (roundtrip)', async () => {
        const encryptedData = await Utils.crypto.aesEncrypt(plainText, keyBase64);
        expect(typeof encryptedData).toBe('string');
        expect(encryptedData.includes(':')).toBe(true); // IV:CipherText format

        const decryptedText = await Utils.crypto.aesDecrypt(encryptedData, keyBase64);
        expect(decryptedText).toBe(plainText);
      });

      it('aesDecrypt should throw an error for invalid key', async () => {
        const encryptedData = await Utils.crypto.aesEncrypt(plainText, keyBase64);
        const wrongKey = await Utils.crypto.exportKeyAsBase64(
            await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])
        );
        await expect(Utils.crypto.aesDecrypt(encryptedData, wrongKey)).rejects.toThrow();
      });

      it('aesDecrypt should throw an error for corrupted data (IV part)', async () => {
        const encryptedData = await Utils.crypto.aesEncrypt(plainText, keyBase64);
        const parts = encryptedData.split(':');
        const corruptedEncryptedData = `corrupted${parts[0]}:${parts[1]}`; // Corrupt IV
         await expect(Utils.crypto.aesDecrypt(corruptedEncryptedData, keyBase64)).rejects.toThrow();
      });

      it('aesDecrypt should throw an error for corrupted data (Ciphertext part)', async () => {
        const encryptedData = await Utils.crypto.aesEncrypt(plainText, keyBase64);
        const parts = encryptedData.split(':');
        const corruptedEncryptedData = `${parts[0]}:corrupted${parts[1]}`; // Corrupt Ciphertext
         await expect(Utils.crypto.aesDecrypt(corruptedEncryptedData, keyBase64)).rejects.toThrow();
      });

      it('aesDecrypt should throw an error for invalid encrypted data format', async () => {
        await expect(Utils.crypto.aesDecrypt("invalidformat", keyBase64)).rejects.toThrow('Invalid encrypted data format');
      });
    });
  });

  describe('getUserColor()', () => {
    it('should return a string (color hex)', () => {
      expect(typeof Utils.getUserColor('testpubkey')).toBe('string');
      expect(Utils.getUserColor('testpubkey')).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('should return consistent color for the same pubkey', () => {
      const pubkey = 'abcdef123456';
      expect(Utils.getUserColor(pubkey)).toBe(Utils.getUserColor(pubkey));
    });

    it('should return different colors for different pubkeys (usually)', () => {
      const pubkey1 = 'a'; // ASCII 97, 97 % 8 = 1
      const pubkey2 = 'b'; // ASCII 98, 98 % 8 = 2
      // These should map to different colors in the 8-color array.
      expect(Utils.getUserColor(pubkey1)).not.toBe(Utils.getUserColor(pubkey2));
    });

    it('should return a default color for null/undefined/empty input', () => {
        const defaultColor = Utils.getUserColor(null);
        expect(Utils.getUserColor(undefined)).toBe(defaultColor);
        expect(Utils.getUserColor('')).toBe(defaultColor);
    });
  });

  describe('createAvatarSvg()', () => {
    it('should return a valid data URI for SVG', () => {
      const svg = Utils.createAvatarSvg('T', 'testseed');
      expect(svg.startsWith('data:image/svg+xml,')).toBe(true);
    });

    it('should contain the initial character and color', () => {
      const initial = 'N';
      const seed = 'nostruser';
      const color = Utils.getUserColor(seed);
      const svg = Utils.createAvatarSvg(initial, seed);

      const decodedSvg = decodeURIComponent(svg.split(',')[1]);
      expect(decodedSvg).toContain(`fill="${Utils.escapeHtml(color)}"`);
      expect(decodedSvg).toContain(`>${Utils.escapeHtml(initial.toUpperCase())}</text>`);
    });

    it('should use "?" if text is empty or null, and escape it', () => {
      const svg = Utils.createAvatarSvg(null, 'testseed');
      const decodedSvg = decodeURIComponent(svg.split(',')[1]);
      expect(decodedSvg).toContain(`>${Utils.escapeHtml('?')}</text>`);
    });

    it('should escape special characters in initial and color', () => {
        // Color is from a predefined list, so no special chars.
        // Initial could be special.
        const initial = '<';
        const seed = 'testseed';
        const svg = Utils.createAvatarSvg(initial, seed);
        const decodedSvg = decodeURIComponent(svg.split(',')[1]);
        expect(decodedSvg).toContain(`>&lt;</text>`);
    });
  });

  describe('findTag()', () => {
    const mockEvent = {
        tags: [
            ['e', 'eventid123'],
            ['p', 'pubkeyabc'],
            ['g', 'groupid789'],
            ['p', 'pubkeydef'] // Multiple p tags
        ]
    };
    it("should find the first 'p' tag value", () => {
        expect(Utils.findTag(mockEvent, 'p')).toBe('pubkeyabc');
    });
    it("should find the 'g' tag value", () => {
        expect(Utils.findTag(mockEvent, 'g')).toBe('groupid789');
    });
    it("should return undefined for a missing tag", () => {
        expect(Utils.findTag(mockEvent, 'z')).toBeUndefined();
    });
    it("should return undefined if tags array is empty", () => {
        expect(Utils.findTag({tags:[]}, 'p')).toBeUndefined();
    });
     it("should return undefined if event or tags are undefined", () => {
        expect(Utils.findTag({}, 'p')).toBeUndefined();
        expect(Utils.findTag(undefined, 'p')).toBeUndefined();
    });
  });
});

// Tests for Logger and EventEmitter can be added if more complex behavior is introduced.
// For now, they are simple wrappers or standard implementations.

describe('Logger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Logger.log should call console.log with [N] prefix', () => {
    Logger.log('test message', 123);
    expect(console.log).toHaveBeenCalledWith('[N]', 'test message', 123);
  });

  it('Logger.warn should call console.warn with [N] prefix', () => {
    Logger.warn('test warning');
    expect(console.warn).toHaveBeenCalledWith('[N]', 'test warning');
  });

  it('Logger.error should call console.error with [N] prefix', () => {
    Logger.error('test error');
    expect(console.error).toHaveBeenCalledWith('[N]', 'test error');
  });
});

describe('EventEmitter', () => {
  let emitter;
  beforeEach(() => {
    emitter = new EventEmitter();
  });

  it('should register and call an event listener', () => {
    const callback = vi.fn();
    emitter.on('testEvent', callback);
    emitter.emit('testEvent', 'data123');
    expect(callback).toHaveBeenCalledWith('data123');
  });

  it('should call multiple listeners for the same event', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    emitter.on('eventX', cb1);
    emitter.on('eventX', cb2);
    emitter.emit('eventX', 'payload');
    expect(cb1).toHaveBeenCalledWith('payload');
    expect(cb2).toHaveBeenCalledWith('payload');
  });

  it('should unregister a specific listener', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    emitter.on('eventY', cb1);
    emitter.on('eventY', cb2);
    emitter.off('eventY', cb1);
    emitter.emit('eventY', 'data');
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledWith('data');
  });

  it('unregistering a non-existent listener should not error', () => {
    const cb = vi.fn();
    expect(() => emitter.off('noEvent', cb)).not.toThrow();
  });

  it('emitting an event with no listeners should not error', () => {
    expect(() => emitter.emit('emptyEvent', 'data')).not.toThrow();
  });

  it('on() method should return an unsubscribe function', () => {
    const callback = vi.fn();
    const unsubscribe = emitter.on('myEvent', callback);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe(); // Call the unsubscribe function
    emitter.emit('myEvent', 'test data');
    expect(callback).not.toHaveBeenCalled();
  });
});

// Note: Debounce and Throttle tests were requested but functions are not in utils.js
// If they were, they'd look something like this (using vi.useFakeTimers):
/*
describe('Utils.debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('should call the function only once after multiple rapid calls', () => {
    const func = vi.fn();
    const debouncedFunc = Utils.debounce(func, 100);
    debouncedFunc();
    debouncedFunc();
    debouncedFunc();
    expect(func).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(func).toHaveBeenCalledTimes(1);
  });
});

describe('Utils.throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('should call the function at most once within the throttle period', () => {
    const func = vi.fn();
    const throttledFunc = Utils.throttle(func, 100);
    throttledFunc(); // Called
    throttledFunc(); // Throttled
    throttledFunc(); // Throttled
    expect(func).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(50);
    throttledFunc(); // Still throttled
    expect(func).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(50); // 100ms passed
    throttledFunc(); // Called again
    expect(func).toHaveBeenCalledTimes(2);
  });
});
*/
