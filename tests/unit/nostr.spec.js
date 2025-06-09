import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Nostr } from '../../src/nostr.js';
import { Logger, Utils } from '../../src/utils.js'; // Logger is mocked via setup.js

// Mock DataStore (src/store.js)
const mockDataStoreInstance = {
  state: { /* Initial state will be set in beforeEach */ },
  emit: vi.fn(),
  setState: vi.fn(updater => updater(mockDataStoreInstance.state)),
  saveThoughts: vi.fn(() => Promise.resolve()),
  saveProfiles: vi.fn(() => Promise.resolve()),
  saveActiveThoughtId: vi.fn(() => Promise.resolve()),
  saveRelays: vi.fn(() => Promise.resolve()),
  saveMessages: vi.fn(() => Promise.resolve()),
  loadMessages: vi.fn(() => Promise.resolve()),
  resetApplicationData: vi.fn(() => Promise.resolve()),
  emitStateUpdated: vi.fn(),
};
vi.mock('../../src/store.js', () => ({
  Data: vi.fn(() => mockDataStoreInstance),
}));

// Mock UIController (src/ui-controller.js)
const mockUiControllerInstance = {
  showToast: vi.fn(),
};
vi.mock('../../src/ui-controller.js', () => ({
  UIController: vi.fn(() => mockUiControllerInstance),
}));

// Utils.js is partially mocked in tests/setup.js (for Logger).
// Real Utils.crypto methods will be used, relying on global crypto polyfilled in setup.js.
// NostrTools is globally mocked in tests/setup.js.


describe('Nostr Class', () => {
  let nostr;
  let mockSimplePoolInstance;

  beforeEach(() => {
    mockDataStoreInstance.state = {
        relays: [],
        identity: { sk: null, pk: null, profile: null },
        thoughts: { public: { id: 'public', name: 'Public Feed', type: 'public', unread: 0, lastEventTimestamp: 0}},
        messages: {},
        profiles: {},
        activeThoughtId: 'public',
        fetchingProfiles: new Set(),
    };

    vi.clearAllMocks();

    mockSimplePoolInstance = NostrTools._mockSimplePoolInstance;
    mockSimplePoolInstance.subscribe.mockClear().mockReturnValue({ unsub: vi.fn() });
    mockSimplePoolInstance.publish.mockClear().mockImplementation((relays, event) => relays.map(r => Promise.resolve({ event, relay: r, success: true })));
    mockSimplePoolInstance.get.mockClear().mockResolvedValue(null);
    mockSimplePoolInstance.querySync.mockClear().mockResolvedValue([]);
    mockSimplePoolInstance.close.mockClear();

    nostr = new Nostr(mockDataStoreInstance, mockUiControllerInstance);
  });

  afterEach(() => {
    nostr.disconnect();
  });

  describe('Initialization', () => {
    it('should initialize with default values', () => {
      expect(nostr.dataStore).toBe(mockDataStoreInstance);
      expect(nostr.ui).toBe(mockUiControllerInstance);
      expect(NostrTools.SimplePool).toHaveBeenCalledTimes(1);
      expect(nostr.pool).toBe(mockSimplePoolInstance);
      expect(nostr.subs).toBeInstanceOf(Map);
      expect(nostr.subs.size).toBe(0);
      expect(nostr.seenEventIds).toBeInstanceOf(Set);
      expect(nostr.connectionStatus).toBe('disconnected');
    });
  });

  describe('Connection Management', () => {
    it('connect should do nothing and show toast if no relays', () => {
      mockDataStoreInstance.state.relays = [];
      nostr.connect();
      expect(NostrTools.SimplePool).toHaveBeenCalledTimes(1);
      expect(mockUiControllerInstance.showToast).toHaveBeenCalledWith('No relays configured. Please add relays.', 'warn');
      expect(nostr.connectionStatus).toBe('disconnected');
    });

    it('connect should initialize new pool, subscribe to core events, and update status with relays', () => {
      mockDataStoreInstance.state.relays = ['wss://relay.example.com'];
      const subscribeCoreSpy = vi.spyOn(nostr, 'subscribeToCoreEvents').mockImplementation(() => {});

      nostr.connect();

      expect(NostrTools.SimplePool).toHaveBeenCalledTimes(2);
      expect(subscribeCoreSpy).toHaveBeenCalled();
      expect(nostr.connectionStatus).toBe('connected');
      expect(mockUiControllerInstance.showToast).toHaveBeenCalledWith('Subscriptions sent to 1 relays.', 'success');
    });

    it('disconnect should unsub all subscriptions and close pool', () => {
      const mockSubUnsub = vi.fn();
      nostr.subs.set('testsub', { unsub: mockSubUnsub });
      mockDataStoreInstance.state.relays = ['wss://relay.example.com'];

      nostr.disconnect();

      expect(mockSubUnsub).toHaveBeenCalled();
      expect(nostr.subs.size).toBe(0);
      expect(mockSimplePoolInstance.close).toHaveBeenCalledWith(mockDataStoreInstance.state.relays);
      expect(nostr.connectionStatus).toBe('disconnected');
    });

    it('disconnect should handle invalid sub objects gracefully', () => {
        nostr.subs.set('invalidsub', null);
        expect(() => nostr.disconnect()).not.toThrow();
        expect(Logger.warn).toHaveBeenCalledWith('Attempted to unsub an invalid subscription object:', null);
    });

    it('updateConnectionStatus should emit connection:status event and change status', () => {
      const emitSpy = vi.spyOn(nostr, 'emit');
      nostr.updateConnectionStatus('connecting');
      expect(nostr.connectionStatus).toBe('connecting');
      expect(emitSpy).toHaveBeenCalledWith('connection:status', { status: 'connecting', count: 0 });
    });

    it('updateConnectionStatus should not emit if status is the same', () => {
      nostr.connectionStatus = 'connected';
      const emitSpy = vi.spyOn(nostr, 'emit');
      nostr.updateConnectionStatus('connected');
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('Subscription Handling', () => {
    beforeEach(() => {
        mockDataStoreInstance.state.relays = ['wss://relay.example.com'];
    });

    it('subscribe should call pool.subscribe and manage seenEventIds', () => {
      const filters = [{ kinds: [1] }];
      nostr.subscribe('testsub', filters);
      expect(mockSimplePoolInstance.subscribe).toHaveBeenCalledWith(
        mockDataStoreInstance.state.relays,
        filters,
        expect.objectContaining({ onevent: expect.any(Function) })
      );

      const eventCallback = mockSimplePoolInstance.subscribe.mock.calls[0][2].onevent;
      const mockEvent = { id: 'event1', kind: 1, content: 'hello', pubkey: 'pk1', created_at: Utils.now(), tags:[] };
      const processSpy = vi.spyOn(nostr, 'processNostrEvent');

      eventCallback(mockEvent);
      expect(nostr.seenEventIds.has('event1')).toBe(true);
      expect(processSpy).toHaveBeenCalledWith(mockEvent, 'testsub');

      eventCallback(mockEvent);
      expect(processSpy).toHaveBeenCalledTimes(1);
    });

    it('subscribe should clear old seenEventIds when cap is reached', () => {
        nostr.seenEventIds = new Set(Array.from({length: 2001}, (_, i) => `id${i}`));
        nostr.subscribe('capTestSub', [{ kinds: [1] }]);

        const eventCallback = mockSimplePoolInstance.subscribe.mock.calls[0][2].onevent;
        eventCallback({ id: 'newEventAfterCap', kind:1, content:'test', pubkey:'pk', created_at: Utils.now(), tags:[] });
        expect(nostr.seenEventIds.size).toBeLessThanOrEqual(1501);
        expect(nostr.seenEventIds.has('newEventAfterCap')).toBe(true);
        expect(nostr.seenEventIds.has('id0')).toBe(false);
    });

    it('subscribeToCoreEvents should subscribe to public feed', () => {
      const subSpy = vi.spyOn(nostr, 'subscribe');
      nostr.subscribeToCoreEvents();

      expect(subSpy).toHaveBeenCalled();
      const publicCall = subSpy.mock.calls.find(call => call[0] === 'public');
      expect(publicCall).toBeDefined();
      expect(publicCall[0]).toBe('public');
      expect(publicCall[1]).toEqual([{ kinds: [1] }]);
      expect(publicCall[2]).toBeTypeOf('object');
      expect(publicCall[2]).toHaveProperty('onevent');
      expect(typeof publicCall[2].onevent).toBe('function');
    });

    it('subscribeToCoreEvents should subscribe to DMs and profile if pk exists', () => {
      mockDataStoreInstance.state.identity.pk = 'userpk';
      const subSpy = vi.spyOn(nostr, 'subscribe');
      const resubGroupsSpy = vi.spyOn(nostr, 'resubscribeToGroups');

      nostr.subscribeToCoreEvents();

      expect(subSpy).toHaveBeenCalledWith('dms', [{ kinds: [4], '#p': ['userpk'], since: expect.any(Number) }]);
      expect(subSpy).toHaveBeenCalledWith('profile', [{ kinds: [0], authors: ['userpk'], limit: 1 }]);
      expect(resubGroupsSpy).toHaveBeenCalled();
    });

    it('resubscribeToGroups should subscribe if groups exist', () => {
      mockDataStoreInstance.state.thoughts.group1 = { id: 'g1', type: 'group' };
      const subSpy = vi.spyOn(nostr, 'subscribe');
      nostr.resubscribeToGroups();
      expect(subSpy).toHaveBeenCalledWith('groups', [{ kinds: [41], '#g': ['g1'], since: expect.any(Number) }]);
    });
  });

  describe('Event Publishing (publish)', () => {
    const skBytes = new Uint8Array(32).fill(0x01);
    const pkHex = `pk_for_${'01'.repeat(32)}`;

    beforeEach(() => {
        mockDataStoreInstance.state.relays = ['wss://relay.example.com'];
        mockDataStoreInstance.state.identity.sk = skBytes;
        mockDataStoreInstance.state.identity.pk = pkHex;
    });

    it('should successfully publish an event', async () => {
      const eventTemplate = { kind: 1, content: 'Test note', tags: [], created_at: Utils.now() };

      const signedEvent = await nostr.publish(eventTemplate);
      const finalizedEvent = NostrTools.finalizeEvent.mock.results[0].value;

      expect(NostrTools.finalizeEvent).toHaveBeenCalledWith(eventTemplate, skBytes);
      expect(mockSimplePoolInstance.publish).toHaveBeenCalledWith(
        mockDataStoreInstance.state.relays,
        finalizedEvent
      );
      expect(signedEvent).toEqual(finalizedEvent);
    });

    it('should throw error if not logged in (no sk)', async () => {
      mockDataStoreInstance.state.identity.sk = null;
      await expect(nostr.publish({})).rejects.toThrow('Not logged in.');
    });

    it('should throw error if no relays are available', async () => {
      mockDataStoreInstance.state.relays = [];
      await expect(nostr.publish({})).rejects.toThrow('No relays available for publishing.');
    });

    it('should throw error if publishing fails on all relays', async () => {
      mockSimplePoolInstance.publish.mockImplementation((relays, event) => {
        return relays.map(r => Promise.reject(new Error(`Failed relay ${r}`)));
      });

      await expect(nostr.publish({})).rejects.toThrow('Failed to publish event to any relay.');
      // Logger.error is called with different arguments depending on AggregateError or not
      // This is tested by the actual src/nostr.js logic which differentiates.
      // The key is that Logger.error is called.
      expect(Logger.error).toHaveBeenCalled();
    });

    it('should throw, log, and re-throw if NostrTools.finalizeEvent fails', async () => {
      const eventTemplate = { kind: 1, content: 'Test note', tags: [], created_at: Utils.now() };
      const signingError = new Error('Signing failed');
      NostrTools.finalizeEvent.mockImplementation(() => {
        throw signingError;
      });
      const loggerSpy = vi.spyOn(Logger, 'error');

      await expect(nostr.publish(eventTemplate)).rejects.toThrow(signingError);
      expect(loggerSpy).toHaveBeenCalledWith('Failed to sign event:', signingError, eventTemplate);
      loggerSpy.mockRestore();
    });

    it('should log AggregateError specifically if Promise.any rejects with it', async () => {
        mockSimplePoolInstance.publish.mockImplementation((relays, event) => {
            return relays.map(r => Promise.reject(new Error(`Relay ${r} failed`)));
        });
        const loggerSpy = vi.spyOn(Logger, 'error');
        const eventTemplate = { kind: 1, content: 'Test content', tags: [], created_at: Utils.now() };

        await expect(nostr.publish(eventTemplate)).rejects.toThrow('Failed to publish event to any relay.');

        expect(loggerSpy).toHaveBeenCalledWith(
            'Publish failed on all relays (AggregateError):',
            expect.arrayContaining([expect.any(Error)]) // Check for the array of errors
        );
        loggerSpy.mockRestore();
    });
  });

  describe('Event Fetching', () => {
    beforeEach(() => {
        mockDataStoreInstance.state.relays = ['wss://relay.example.com'];
        mockDataStoreInstance.state.identity.pk = 'userpk';
    });

    it('fetchHistoricalMessages for public', async () => {
      await nostr.fetchHistoricalMessages({ id: 'public', type: 'public' });
      expect(mockSimplePoolInstance.querySync).toHaveBeenCalledWith(
        mockDataStoreInstance.state.relays, [{ kinds: [1], limit: 20, since: expect.any(Number) }]
      );
    });

    it('fetchProfile should call pool.get and process event', async () => {
      const pubkey = 'testprofilepk';
      const mockProfileEvent = { id: 'profileEvent', kind: 0, pubkey: pubkey, content: '{}' };
      mockSimplePoolInstance.get.mockResolvedValueOnce(mockProfileEvent);
      const processSpy = vi.spyOn(nostr, 'processNostrEvent');

      await nostr.fetchProfile(pubkey);
      expect(mockSimplePoolInstance.get).toHaveBeenCalledWith(mockDataStoreInstance.state.relays, { kinds: [0], authors: [pubkey] });
      expect(processSpy).toHaveBeenCalledWith(mockProfileEvent, 'profile-fetch');
      expect(mockDataStoreInstance.state.fetchingProfiles.has(pubkey)).toBe(false);
    });
  });

  describe('Event Processing', () => {
    const userTestSk = new Uint8Array(32).fill(0xBB);
    const userTestPk = `pk_for_${'bb'.repeat(32)}`;
    const otherTestPk = 'otherTestPk123';

    beforeEach(() => {
        mockDataStoreInstance.state.identity.sk = userTestSk;
        mockDataStoreInstance.state.identity.pk = userTestPk;
        NostrTools.verifyEvent.mockReturnValue(true);
    });

    it('processNostrEvent should ignore invalid events (verifyEvent fails)', async () => {
      NostrTools.verifyEvent.mockReturnValueOnce(false);
      const event = { id: 'ev1', kind: 1, content: 'test', pubkey:'pk', created_at: Utils.now(), tags:[] };
      const processMsgSpy = vi.spyOn(nostr, 'processMessage');
      await nostr.processNostrEvent(event, 'sub1');
      expect(Logger.warn).toHaveBeenCalledWith('Invalid event signature:', event);
      expect(processMsgSpy).not.toHaveBeenCalled();
    });

    it('processKind0 should update profile if newer', async () => {
      const profilePk = 'someProfilePk';
      const now = Utils.now();
      mockDataStoreInstance.state.profiles[profilePk] = { name:"Old", pubkey: profilePk, lastUpdatedAt: now - 100 };
      const event = { kind: 0, pubkey: profilePk, created_at: now, content: '{"name":"Alice"}' };

      await nostr.processKind0(event);

      expect(mockDataStoreInstance.setState).toHaveBeenCalled();
      const updatedProfile = mockDataStoreInstance.state.profiles[profilePk];
      expect(updatedProfile.name).toBe("Alice");
      expect(mockDataStoreInstance.saveProfiles).toHaveBeenCalled();
    });

    it('processNostrEvent for kind 4 (DM) should decrypt and process', async () => {
      const dmContent = 'Secret message';
      const encryptedDM = `nip04encrypted(${dmContent},${otherTestPk})`;
      const event = { id: 'dmEvent', kind: 4, pubkey: otherTestPk, content: encryptedDM, tags: [['p', userTestPk]] };
      // nip04.decrypt is mocked in setup.js
      const processMsgSpy = vi.spyOn(nostr, 'processMessage');
      delete mockDataStoreInstance.state.thoughts[otherTestPk];

      await nostr.processNostrEvent(event, 'dms');

      expect(NostrTools.nip04.decrypt).toHaveBeenCalledWith(userTestSk, otherTestPk, encryptedDM);
      expect(mockDataStoreInstance.state.thoughts[otherTestPk]).toBeDefined();
      expect(mockDataStoreInstance.saveThoughts).toHaveBeenCalled();
      expect(processMsgSpy).toHaveBeenCalledWith(expect.objectContaining({ content: dmContent }), otherTestPk);
    });

    it('processNostrEvent for kind 41 (Group DM) should decrypt and process', async () => {
      const groupId = 'group1';
      const rawKey = new Uint8Array(32).fill(0xCF); // Use a different key for clarity
      const groupSecretKey = Utils.uint8ArrayToBase64(rawKey); // Valid base64 key
      const groupContent = 'Super secret group text';
      const encryptedGroupMsg = await Utils.crypto.aesEncrypt(groupContent, groupSecretKey);

      mockDataStoreInstance.state.thoughts[groupId] = { id: groupId, type: 'group', secretKey: groupSecretKey, name: 'Test Group' };
      const event = { id: 'groupEvent1', kind: 41, content: encryptedGroupMsg, tags: [['g', groupId]], pubkey: 'someGroupMemberPk' };
      const processMsgSpy = vi.spyOn(nostr, 'processMessage');

      await nostr.processNostrEvent(event, 'groups');

      expect(processMsgSpy).toHaveBeenCalledWith(
        expect.objectContaining({ content: groupContent }),
        groupId
      );
    });

    it('processNostrEvent should skip kind 41 if group or secretKey missing', async () => {
        const event = { id: 'evGroup', kind: 41, content: 'content', tags: [['g', 'unknownGroup']], created_at: Utils.now(), pubkey: 'pk' };
        const processMsgSpy = vi.spyOn(nostr, 'processMessage');
        await nostr.processNostrEvent(event, 'groups');
        expect(processMsgSpy).not.toHaveBeenCalled();
        expect(Logger.warn).toHaveBeenCalledWith(`No secret key for group unknownGroup. Cannot decrypt. Event ID: evGroup`);
    });

    // --- Start of new error condition tests for processNostrEvent ---
    describe('processNostrEvent - Decryption Error Handling', () => {
        const userTestSk = new Uint8Array(32).fill(0xBB);
        const userTestPk = `pk_for_${'bb'.repeat(32)}`;
        const otherTestPk = 'otherTestPkForDecryptionErrors';
        let processMessageSpy;
        let loggerWarnSpy;

        beforeEach(() => {
            mockDataStoreInstance.state.identity.sk = userTestSk;
            mockDataStoreInstance.state.identity.pk = userTestPk;
            NostrTools.verifyEvent.mockReturnValue(true); // Assume events are valid unless specified
            processMessageSpy = vi.spyOn(nostr, 'processMessage');
            loggerWarnSpy = vi.spyOn(Logger, 'warn');
        });

        afterEach(() => {
            loggerWarnSpy.mockRestore();
        });

        it('Kind 4 (DM) - should log warning and not process if nip04.decrypt fails', async () => {
            const eventId = 'dmDecryptFailEvent';
            const event = { id: eventId, kind: 4, pubkey: otherTestPk, content: 'encrypted', tags: [['p', userTestPk]], created_at: Utils.now() };
            const decryptError = new Error('Decryption failed');
            NostrTools.nip04.decrypt.mockRejectedValueOnce(decryptError); // Mocking global NostrTools

            await nostr.processNostrEvent(event, 'dms');

            expect(NostrTools.nip04.decrypt).toHaveBeenCalledWith(userTestSk, otherTestPk, 'encrypted');
            expect(loggerWarnSpy).toHaveBeenCalledWith(`Failed to decrypt DM for ${otherTestPk}: ${decryptError.message}. Event ID: ${eventId}`);
            expect(processMessageSpy).not.toHaveBeenCalled();
        });

        it('Kind 4 (DM) - should log warning and not process if sk is missing', async () => {
            mockDataStoreInstance.state.identity.sk = null;
            const eventId = 'dmMissingSkEvent';
            const event = { id: eventId, kind: 4, pubkey: otherTestPk, content: 'encrypted', tags: [['p', userTestPk]], created_at: Utils.now() };

            await nostr.processNostrEvent(event, 'dms');

            expect(loggerWarnSpy).toHaveBeenCalledWith(`Cannot decrypt DM: Secret key (sk) not available. Event ID: ${eventId}`);
            expect(processMessageSpy).not.toHaveBeenCalled();
        });

        it('Kind 41 (Group Message) - should log warning and not process if aesDecrypt fails', async () => {
            const groupId = 'groupDecryptFail';
            const eventId = 'groupDecryptFailEvent';
            const groupSecretKey = Utils.uint8ArrayToBase64(new Uint8Array(32).fill(0xDD));
            mockDataStoreInstance.state.thoughts[groupId] = { id: groupId, type: 'group', secretKey: groupSecretKey, name: 'Test Group Decrypt Fail' };
            const event = { id: eventId, kind: 41, content: 'encryptedGroupMessage', tags: [['g', groupId]], created_at: Utils.now(), pubkey: 'someSender' };
            const decryptError = new Error('AES Decryption failed miserably');

            // Mock Utils.crypto.aesDecrypt specifically for this test
            const originalAesDecrypt = Utils.crypto.aesDecrypt;
            Utils.crypto.aesDecrypt = vi.fn().mockRejectedValueOnce(decryptError);

            await nostr.processNostrEvent(event, 'groups');

            expect(Utils.crypto.aesDecrypt).toHaveBeenCalledWith('encryptedGroupMessage', groupSecretKey);
            expect(loggerWarnSpy).toHaveBeenCalledWith(`Failed to decrypt group message for ${groupId}: ${decryptError.message}. Event ID: ${eventId}`);
            expect(processMessageSpy).not.toHaveBeenCalled();

            Utils.crypto.aesDecrypt = originalAesDecrypt; // Restore original
        });

        it('Kind 41 (Group Message) - should log warning and not process if secretKey for group is missing', async () => {
            const groupId = 'groupMissingKey';
            const eventId = 'groupMissingKeyEvent';
            // Ensure group exists but without a secretKey
            mockDataStoreInstance.state.thoughts[groupId] = { id: groupId, type: 'group', name: 'Test Group No Key' };
            const event = { id: eventId, kind: 41, content: 'someContent', tags: [['g', groupId]], created_at: Utils.now(), pubkey: 'someSender' };

            await nostr.processNostrEvent(event, 'groups');

            expect(loggerWarnSpy).toHaveBeenCalledWith(`No secret key for group ${groupId}. Cannot decrypt. Event ID: ${eventId}`);
            expect(processMessageSpy).not.toHaveBeenCalled();
        });
    });
    // --- End of new error condition tests for processNostrEvent ---

    it('processMessage should add message, update thought (for other user), and emit events', async () => {
      const thoughtId = 'dmWithOtherUser';
      const now = Utils.now();
      const message = { id: 'msgDm1', pubkey: 'anotherUserPk', content: 'Hello to me', created_at: now, tags:[['p', userTestPk]] };

      mockDataStoreInstance.state.identity.pk = userTestPk;
      mockDataStoreInstance.state.activeThoughtId = 'public'; // Active thought is different
      mockDataStoreInstance.state.thoughts[thoughtId] = { id: thoughtId, type: 'dm', pubkey: 'anotherUserPk', unread: 0, lastEventTimestamp: now -100 };
      mockDataStoreInstance.state.messages[thoughtId] = [];


      const fetchProfileSpy = vi.spyOn(nostr, 'fetchProfile');

      await nostr.processMessage(message, thoughtId);

      expect(mockDataStoreInstance.state.messages[thoughtId]).toContainEqual(message);
      expect(mockDataStoreInstance.state.thoughts[thoughtId].lastEventTimestamp).toBe(now);
      expect(mockDataStoreInstance.state.thoughts[thoughtId].unread).toBe(1); // Should be 1
      expect(mockDataStoreInstance.emit).toHaveBeenCalledWith(`messages:${thoughtId}:updated`, [message]);
      expect(mockDataStoreInstance.emitStateUpdated).toHaveBeenCalled();
      expect(fetchProfileSpy).toHaveBeenCalledWith('anotherUserPk');
      expect(mockDataStoreInstance.saveMessages).toHaveBeenCalledWith(thoughtId);
    });
  });
});
