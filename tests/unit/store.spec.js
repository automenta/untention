import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { Data } from '../../src/store.js';
import { Logger } from '../../src/logger.js';
import * as NostrUtils from '../../src/utils/nostr-utils.js';
import * as CryptoUtils from '../../src/utils/crypto-utils.js'; // Used for bytesToHex in a test
const { getPublicKey } = NostrTools; // Assuming NostrTools is globally available/mocked

vi.mock('../../src/utils/nostr-utils.js', async (importActual) => {
    const actual = await importActual();
    return { ...actual, validateRelayUrl: vi.fn() }; // Mock validateRelayUrl
});


describe('Data Store', () => {
  let dataStore;

  beforeEach(async () => {
    if (globalThis.mockLocalForageStore) {
        for (const key in globalThis.mockLocalForageStore) {
          delete globalThis.mockLocalForageStore[key];
        }
    } else {
        globalThis.mockLocalForageStore = {};
    }
    vi.clearAllMocks();

    // Reset specific mocks if they are modified by tests
    NostrUtils.validateRelayUrl.mockImplementation(() => true); // Default mock for tests
    if (NostrTools.getPublicKey.mockClear) NostrTools.getPublicKey.mockClear();


    dataStore = new Data();
  });

  afterEach(() => {
    if (dataStore.debounceTimer) {
        clearTimeout(dataStore.debounceTimer);
    }
  });

  describe('Initialization and Loading', () => {
    it('should have correct initial state', () => {
      expect(dataStore.state.identity).toEqual({ sk: null, pk: null, profile: null });
      expect(Array.isArray(dataStore.state.relays)).toBe(true);
      expect(dataStore.state.thoughts).toEqual({
        public: {
          id: 'public',
          name: 'Public Feed',
          type: 'public',
          unread: 0,
          lastEventTimestamp: 0
        }
      });
      expect(dataStore.state.messages).toEqual({});
      expect(dataStore.state.profiles).toEqual({});
      expect(dataStore.state.activeThoughtId).toBe('public');
      expect(dataStore.state.fetchingProfiles).toBeInstanceOf(Set);
    });

    it('should load data from localforage successfully', async () => {
      const mockSkHex = '00'.repeat(32);
      const mockPk = `pk_for_${mockSkHex}`; // Consistent with how setup.js mocks getPublicKey
      const mockIdentity = { skHex: mockSkHex };
      const mockThoughts = { public: { id: 'public', name: 'Public Feed', type: 'public', unread: 0, lastEventTimestamp: 0 } };
      const mockProfiles = { [mockPk]: { name: 'Test User' } };
      const mockActiveThoughtId = 'public';
      const mockRelays = ['wss://relay.example.com'];

      globalThis.mockLocalForageStore['identity_v2'] = mockIdentity;
      globalThis.mockLocalForageStore['thoughts_v3'] = mockThoughts;
      globalThis.mockLocalForageStore['profiles_v2'] = mockProfiles;
      globalThis.mockLocalForageStore['activeThoughtId_v3'] = mockActiveThoughtId;
      globalThis.mockLocalForageStore['relays_v2'] = mockRelays;

      NostrTools.getPublicKey.mockReturnValue(mockPk); // Ensure getPublicKey returns the expected pk

      await dataStore.load();

      expect(dataStore.state.identity.sk).toBeInstanceOf(Uint8Array);
      expect(dataStore.state.identity.pk).toBe(mockPk);
      expect(dataStore.state.thoughts).toEqual(mockThoughts);
      expect(dataStore.state.identity.profile).toEqual(mockProfiles[mockPk]);
      expect(dataStore.state.activeThoughtId).toBe(mockActiveThoughtId);
      expect(dataStore.state.relays).toEqual(mockRelays);
    });

    it('should use defaults for empty/missing data and create public thought', async () => {
      await dataStore.load();
      expect(dataStore.state.identity).toEqual({ sk: null, pk: null, profile: null });
      expect(dataStore.state.thoughts.public).toBeDefined();
      expect(dataStore.state.thoughts.public.name).toBe('Public Feed');
      expect(dataStore.state.profiles).toEqual({});
      expect(dataStore.state.activeThoughtId).toBe('public');
      expect(dataStore.state.relays.length).toBeGreaterThan(0);
    });

    it('should handle corrupted identity data by resetting identity and logging error', async () => {
      globalThis.mockLocalForageStore['identity_v2'] = { skHex: 'invalid-hex-string' };
      const resetAppSpy = vi.spyOn(dataStore, 'resetApplicationData');
      const errorSpy = vi.spyOn(Logger, 'errorWithContext');

      await dataStore.load();

      expect(dataStore.state.identity.sk).toBeNull();
      expect(dataStore.state.identity.pk).toBeNull();
      expect(dataStore.state.identity.profile).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith('DataStore', 'Corrupted identity data in storage (e.g., invalid hex or key format):', expect.any(Error));
      expect(resetAppSpy).not.toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it('should initialize lastEventTimestamp for thoughts if missing', async () => {
        globalThis.mockLocalForageStore['thoughts_v3'] = {
            public: { id: 'public', name: 'Public', type: 'public' },
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

      expect(emitSpy).not.toHaveBeenCalledWith('state:updated', dataStore.state);

      vi.advanceTimersByTime(dataStore.DEBOUNCE_DELAY);
      expect(emitSpy).toHaveBeenCalledWith('state:updated', dataStore.state);
      expect(emitSpy).toHaveBeenCalledTimes(1);

      dataStore.setState(s => { s.activeThoughtId = 'anotherThought'; });
      dataStore.setState(s => { s.activeThoughtId = 'finalThought'; });
      vi.advanceTimersByTime(dataStore.DEBOUNCE_DELAY);
      expect(emitSpy).toHaveBeenCalledTimes(2);
      expect(dataStore.state.activeThoughtId).toBe('finalThought');

      vi.useRealTimers();
    });
  });

  describe('Identity Management', () => {
    it('saveIdentity should store skHex and update state', async () => {
      const sk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
      const skHex = CryptoUtils.bytesToHex(sk);

      await dataStore.saveIdentity(sk);
      expect(globalThis.localforage.setItem).toHaveBeenCalledWith('identity_v2', { skHex });
    });

    it('saveIdentity should log and re-throw error on failure', async () => {
        const sk = new Uint8Array(32);
        globalThis.localforage.setItem.mockRejectedValueOnce(new Error('Storage failed'));
        const errorSpy = vi.spyOn(Logger, 'errorWithContext');
        await expect(dataStore.saveIdentity(sk)).rejects.toThrow('Storage failed');
        expect(errorSpy).toHaveBeenCalledWith('DataStore', 'Failed to save identity:', expect.any(Error));
        errorSpy.mockRestore();
    });

    it('resetApplicationData should clear relevant localforage items and reset state', async () => {
      globalThis.mockLocalForageStore['identity_v2'] = { skHex: 'test' };
      globalThis.mockLocalForageStore['thoughts_v3'] = { t1: {} };
      globalThis.mockLocalForageStore['profiles_v2'] = { p1: {} };
      globalThis.mockLocalForageStore['activeThoughtId_v3'] = 't1';
      globalThis.mockLocalForageStore['messages_t1'] = [{id:'m1'}];
      globalThis.mockLocalForageStore['relays_v2'] = ['wss://r1.com'];

      const setStateSpy = vi.spyOn(dataStore, 'setState');
      await dataStore.resetApplicationData();

      expect(globalThis.localforage.removeItem).toHaveBeenCalledWith('identity_v2');
      expect(globalThis.localforage.removeItem).toHaveBeenCalledWith('thoughts_v3');
      expect(globalThis.localforage.removeItem).toHaveBeenCalledWith('profiles_v2');
      expect(globalThis.localforage.removeItem).toHaveBeenCalledWith('activeThoughtId_v3');
      expect(globalThis.localforage.removeItem).toHaveBeenCalledWith('messages_t1');
      expect(globalThis.localforage.removeItem).toHaveBeenCalledWith('relays_v2'); // Expect relays_v2 to also be removed

      expect(setStateSpy).toHaveBeenCalled();
      const finalState = dataStore.state;
      expect(finalState.identity.sk).toBeNull();
      expect(finalState.thoughts.public).toBeDefined();
      expect(Object.keys(finalState.thoughts).length).toBe(1);
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
        const errorSpy = vi.spyOn(Logger, 'errorWithContext');
        await expect(dataStore[tc.method]()).rejects.toThrow('Storage failed');
        expect(errorSpy).toHaveBeenCalledWith('DataStore', `Failed to save ${tc.key.split('_')[0]}:`, expect.any(Error));
        errorSpy.mockRestore();
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
      const errorSpy = vi.spyOn(Logger, 'errorWithContext');
      await expect(dataStore.saveMessages(thoughtId)).rejects.toThrow('Storage error for messages');
      expect(errorSpy).toHaveBeenCalledWith('DataStore', `Failed to save messages for ${thoughtId}:`, expect.any(Error));
      errorSpy.mockRestore();
    });
  });
});
