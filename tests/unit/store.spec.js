import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { Data } from '../../src/store.js';
import { Utils } from '../../src/utils.js'; // Original Utils for some parts

// localforage is now mocked globally in tests/setup.js
// We will use globalThis.mockLocalForageStore to manipulate data for tests
// Also, the global localforage mock's methods (getItem, setItem etc.) are already vi.fn() from setup.js

// Mock parts of Utils.js used by store.js if needed
// Utils.validateRelayUrl is used in load() for relays
// Utils.bytesToHex and Utils.hexToBytes are used for identity
// Utils.now is used for timestamps
// These are simple enough that direct mocking might not be needed unless we want to control their output specifically.
// For now, we'll use the real implementations but be mindful.
// Logger is also from utils.js, we can spy on its methods.

// NostrTools is now mocked globally in tests/setup.js

describe('Data Store', () => {
  let dataStore;
  // localforage instance is now global from setup.js and its methods are vi.fn()

  beforeEach(async () => {
    // Reset the mock store's content before each test
    if (globalThis.mockLocalForageStore) {
        for (const key in globalThis.mockLocalForageStore) {
          delete globalThis.mockLocalForageStore[key];
        }
    } else {
        globalThis.mockLocalForageStore = {}; // Ensure it exists
    }
    // Reset call history for all mocks (including global ones like localforage methods)
    vi.clearAllMocks();

    dataStore = new Data();
    // Spy on console methods used by Logger
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks(); // Restores original console methods
    if (dataStore.debounceTimer) {
        clearTimeout(dataStore.debounceTimer); // Clear any pending timers
    }
  });

  describe('Initialization and Loading', () => {
    it('should have correct initial state', () => {
      expect(dataStore.state.identity).toEqual({ sk: null, pk: null, profile: null });
      expect(Array.isArray(dataStore.state.relays)).toBe(true);
      expect(dataStore.state.thoughts).toEqual({});
      expect(dataStore.state.messages).toEqual({});
      expect(dataStore.state.profiles).toEqual({});
      expect(dataStore.state.activeThoughtId).toBe('public');
      expect(dataStore.state.fetchingProfiles).toBeInstanceOf(Set);
    });

    it('should load data from localforage successfully', async () => {
      const mockIdentity = { skHex: '00'.repeat(32) };
      const mockThoughts = { public: { id: 'public', name: 'Public Feed', type: 'public', unread: 0, lastEventTimestamp: 0 } };
      const mockProfiles = { pk_for_mock_sk: { name: 'Test User' } };
      const mockActiveThoughtId = 'public';
      const mockRelays = ['wss://relay.example.com'];

      globalThis.mockLocalForageStore['identity_v2'] = mockIdentity;
      globalThis.mockLocalForageStore['thoughts_v3'] = mockThoughts;
      globalThis.mockLocalForageStore['profiles_v2'] = mockProfiles;
      globalThis.mockLocalForageStore['activeThoughtId_v3'] = mockActiveThoughtId;
      globalThis.mockLocalForageStore['relays_v2'] = mockRelays;

      // Mock Utils.validateRelayUrl to always return true for this test
      const validateRelayUrlSpy = vi.spyOn(Utils, 'validateRelayUrl').mockImplementation(() => true);

      await dataStore.load();

      expect(dataStore.state.identity.sk).toBeInstanceOf(Uint8Array);
      expect(dataStore.state.identity.pk).toBe(`pk_for_${mockIdentity.skHex}`);
      expect(dataStore.state.thoughts).toEqual(mockThoughts);
      // Profile assignment check (may need adjustment based on pk generation)
      // expect(dataStore.state.identity.profile).toEqual(mockProfiles.pk_for_mock_sk);
      expect(dataStore.state.activeThoughtId).toBe(mockActiveThoughtId);
      expect(dataStore.state.relays).toEqual(mockRelays);

      validateRelayUrlSpy.mockRestore();
    });

    it('should use defaults for empty/missing data and create public thought', async () => {
      await dataStore.load();
      expect(dataStore.state.identity).toEqual({ sk: null, pk: null, profile: null });
      expect(dataStore.state.thoughts.public).toBeDefined();
      expect(dataStore.state.thoughts.public.name).toBe('Public Feed');
      expect(dataStore.state.profiles).toEqual({});
      expect(dataStore.state.activeThoughtId).toBe('public');
      expect(dataStore.state.relays.length).toBeGreaterThan(0); // Default relays
    });

    it('should handle corrupted identity data by resetting', async () => {
      globalThis.mockLocalForageStore['identity_v2'] = { skHex: 'invalid-hex-string' }; // Corrupted
      const resetAppSpy = vi.spyOn(dataStore, 'resetApplicationData');

      await dataStore.load();

      expect(resetAppSpy).toHaveBeenCalled();
      expect(dataStore.state.identity.sk).toBeNull();
    });

    it('should initialize lastEventTimestamp for thoughts if missing', async () => {
        globalThis.mockLocalForageStore['thoughts_v3'] = {
            public: { id: 'public', name: 'Public', type: 'public' }, // Missing lastEventTimestamp
            dm1: { id: 'dm1', name: 'DM1', type: 'dm', lastEventTimestamp: 123 }
        };
        await dataStore.load();
        expect(dataStore.state.thoughts.public.lastEventTimestamp).toBe(0);
        expect(dataStore.state.thoughts.dm1.lastEventTimestamp).toBe(123);
    });


    it('should load messages for a specific thought', async () => {
      const thoughtId = 'testThought';
      const mockMessages = [{ id: 'msg1', content: 'Hello' }];
      globalThis.mockLocalForageStore[`messages_${thoughtId}`] = mockMessages;

      const emitSpy = vi.spyOn(dataStore, 'emit');
      await dataStore.loadMessages(thoughtId);

      expect(dataStore.state.messages[thoughtId]).toEqual(mockMessages);
      expect(emitSpy).toHaveBeenCalledWith(`messages:${thoughtId}:updated`, mockMessages);
    });

    it('should set empty array if messages not found for a thought', async () => {
        const thoughtId = 'nonExistentMessages';
        await dataStore.loadMessages(thoughtId);
        expect(dataStore.state.messages[thoughtId]).toEqual([]);
    });
  });

  describe('State Management', () => {
    it('setState should update state and emit debounced event', async () => {
      const emitSpy = vi.spyOn(dataStore, 'emit');
      vi.useFakeTimers();

      dataStore.setState(s => { s.activeThoughtId = 'newThought'; });
      expect(dataStore.state.activeThoughtId).toBe('newThought');

      // Event should not be emitted immediately
      expect(emitSpy).not.toHaveBeenCalledWith('state:updated', dataStore.state);

      vi.advanceTimersByTime(dataStore.DEBOUNCE_DELAY);
      expect(emitSpy).toHaveBeenCalledWith('state:updated', dataStore.state);
      expect(emitSpy).toHaveBeenCalledTimes(1);

      // Multiple setState calls should still result in one debounced emit
      dataStore.setState(s => { s.activeThoughtId = 'anotherThought'; });
      dataStore.setState(s => { s.activeThoughtId = 'finalThought'; });
      vi.advanceTimersByTime(dataStore.DEBOUNCE_DELAY);
      expect(emitSpy).toHaveBeenCalledTimes(2); // One for previous, one for this batch
      expect(dataStore.state.activeThoughtId).toBe('finalThought');

      vi.useRealTimers();
    });
  });

  describe('Identity Management', () => {
    it('saveIdentity should store skHex and update state', async () => {
      const sk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
      const skHex = Utils.bytesToHex(sk);

      await dataStore.saveIdentity(sk);
      expect(globalThis.localforage.setItem).toHaveBeenCalledWith('identity_v2', { skHex });
    });

    it('saveIdentity should log and re-throw error on failure', async () => {
        const sk = new Uint8Array(32);
        globalThis.localforage.setItem.mockRejectedValueOnce(new Error('Storage failed'));
        await expect(dataStore.saveIdentity(sk)).rejects.toThrow('Storage failed');
        expect(console.error).toHaveBeenCalled();
    });

    it('resetApplicationData should clear relevant localforage items and reset state', async () => {
      // Populate some mock data
      globalThis.mockLocalForageStore['identity_v2'] = { skHex: 'test' };
      globalThis.mockLocalForageStore['thoughts_v3'] = { t1: {} };
      globalThis.mockLocalForageStore['profiles_v2'] = { p1: {} };
      globalThis.mockLocalForageStore['activeThoughtId_v3'] = 't1';
      globalThis.mockLocalForageStore['messages_t1'] = [{id:'m1'}];
      globalThis.mockLocalForageStore['relays_v2'] = ['wss://r1.com']; // Relays are not cleared by resetApplicationData

      const setStateSpy = vi.spyOn(dataStore, 'setState');
      await dataStore.resetApplicationData();

      expect(globalThis.localforage.removeItem).toHaveBeenCalledWith('identity_v2');
      expect(globalThis.localforage.removeItem).toHaveBeenCalledWith('thoughts_v3');
      expect(globalThis.localforage.removeItem).toHaveBeenCalledWith('profiles_v2');
      expect(globalThis.localforage.removeItem).toHaveBeenCalledWith('activeThoughtId_v3');
      expect(globalThis.localforage.removeItem).toHaveBeenCalledWith('messages_t1');
      expect(globalThis.localforage.removeItem).not.toHaveBeenCalledWith('relays_v2');


      expect(setStateSpy).toHaveBeenCalled();
      const finalState = dataStore.state; // Get state after reset via spy or direct access
      expect(finalState.identity.sk).toBeNull();
      expect(finalState.thoughts.public).toBeDefined();
      expect(Object.keys(finalState.thoughts).length).toBe(1); // Only public thought
      expect(finalState.messages).toEqual({});
      expect(finalState.profiles).toEqual({});
      expect(finalState.activeThoughtId).toBe('public');
    });
  });

  describe('Data Saving Methods', () => {
    const testCases = [
      { method: 'saveThoughts', key: 'thoughts_v3', dataSelector: s => s.thoughts },
      { method: 'saveProfiles', key: 'profiles_v2', dataSelector: s => s.profiles },
      { method: 'saveActiveThoughtId', key: 'activeThoughtId_v3', dataSelector: s => s.activeThoughtId },
      { method: 'saveRelays', key: 'relays_v2', dataSelector: s => s.relays },
    ];

    for (const tc of testCases) {
      it(`${tc.method} should call localforage.setItem with correct key and data`, async () => {
        // Modify state if needed to have some data
        if (typeof dataStore.state[tc.key.split('_')[0]] === 'object') {
             dataStore.state[tc.key.split('_')[0]].testData = 'sample';
        } else {
             dataStore.state[tc.key.split('_')[0]] = 'sampleData';
        }
        await dataStore[tc.method]();
        expect(globalThis.localforage.setItem).toHaveBeenCalledWith(tc.key, tc.dataSelector(dataStore.state));
      });

      it(`${tc.method} should log and re-throw error on failure`, async () => {
        globalThis.localforage.setItem.mockRejectedValueOnce(new Error('Storage failed'));
        await expect(dataStore[tc.method]()).rejects.toThrow('Storage failed');
        expect(console.error).toHaveBeenCalled();
      });
    }

    it('saveMessages should call localforage.setItem for a specific thoughtId', async () => {
      const thoughtId = 'dm1';
      dataStore.state.messages[thoughtId] = [{ id: 'msg1', text: 'hello' }];
      await dataStore.saveMessages(thoughtId);
      expect(globalThis.localforage.setItem).toHaveBeenCalledWith(`messages_${thoughtId}`, dataStore.state.messages[thoughtId]);
    });

    it('saveMessages should not call setItem if thoughtId is null or messages dont exist', async () => {
        await dataStore.saveMessages(null);
        expect(globalThis.localforage.setItem).not.toHaveBeenCalledWith(expect.stringMatching(/^messages_/), expect.anything());
        await dataStore.saveMessages('nonexistent');
        expect(globalThis.localforage.setItem).not.toHaveBeenCalledWith(expect.stringMatching(/^messages_nonexistent/), expect.anything());
    });

    it('saveMessages should log and re-throw error on failure', async () => {
      const thoughtId = 'dm1';
      dataStore.state.messages[thoughtId] = [{ id: 'msg1' }];
      globalThis.localforage.setItem.mockRejectedValueOnce(new Error('Storage error for messages'));
      await expect(dataStore.saveMessages(thoughtId)).rejects.toThrow('Storage error for messages');
      expect(console.error).toHaveBeenCalled();
    });
  });
});
