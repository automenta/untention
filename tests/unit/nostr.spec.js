import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Nostr } from '../../src/nostr.js';
import { Logger } from '../../src/logger.js'; // Logger is mocked via setup.js
import * as TimeUtils from '../../src/utils/time-utils.js';
import * as RealCryptoUtils from '../../src/utils/crypto-utils.js'; // For resetting NostrTools mock

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

// NostrTools is globally mocked in tests/setup.js.

describe('Nostr Class', () => {
  let nostr;
  let mockSimplePoolInstance;

  beforeEach(() => {
    mockDataStoreInstance.state = {
        relays: ['wss://relay.example.com', 'wss://another.relay.org'],
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

    // Default publish mock for general success. Specific tests can override with mockImplementationOnce.
    mockSimplePoolInstance.publish.mockImplementation((relays, event) => {
        // Simulate success on at least one relay.
        // The actual SimplePool.publish returns an array of promises, one for each relay it tried.
        // Promise.any then needs one of these to resolve.
        // For a simple success mock, we can make the first one resolve.
        const promises = relays.map((r, i) =>
            i === 0 ? Promise.resolve({ event, relay: r, success: true }) : Promise.reject(new Error("Simulated relay failure"))
        );
        return promises; // Return array of promises
    });

    mockSimplePoolInstance.get.mockClear().mockResolvedValue(null);
    mockSimplePoolInstance.querySync.mockClear().mockResolvedValue([]);
    mockSimplePoolInstance.close.mockClear();

    NostrTools.generateSecretKey.mockReturnValue(new Uint8Array(32).fill(0xAA));
    NostrTools.finalizeEvent.mockImplementation((eventTemplate, sk) => ({
        ...eventTemplate,
        id: `mockEventId_${Math.random().toString(36).substring(2,10)}`,
        sig: 'mockSig',
        pubkey: `pk_for_${RealCryptoUtils.bytesToHex(sk)}`
    }));
    NostrTools.verifyEvent.mockReturnValue(true);

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
      const subscribeCoreSpy = vi.spyOn(nostr, 'subscribeToCoreEvents').mockImplementation(() => {});
      nostr.connect();
      expect(NostrTools.SimplePool).toHaveBeenCalledTimes(2);
      expect(subscribeCoreSpy).toHaveBeenCalled();
      expect(nostr.connectionStatus).toBe('connected');
      expect(mockUiControllerInstance.showToast).toHaveBeenCalledWith(`Subscriptions sent to ${mockDataStoreInstance.state.relays.length} relays.`, 'success');
      subscribeCoreSpy.mockRestore();
    });

    it('disconnect should unsub all subscriptions and close pool', () => {
      const mockSubUnsub = vi.fn();
      nostr.subs.set('testsub', { unsub: mockSubUnsub });
      nostr.disconnect();
      expect(mockSubUnsub).toHaveBeenCalled();
      expect(nostr.subs.size).toBe(0);
      expect(mockSimplePoolInstance.close).toHaveBeenCalledWith(mockDataStoreInstance.state.relays);
      expect(nostr.connectionStatus).toBe('disconnected');
    });

    it('disconnect should handle invalid sub objects gracefully', () => {
        nostr.subs.set('invalidsub', null);
        const warnSpy = vi.spyOn(Logger, 'warnWithContext');
        expect(() => nostr.disconnect()).not.toThrow();
        expect(warnSpy).toHaveBeenCalledWith('Nostr', 'Attempted to unsub an invalid subscription object:', null);
        warnSpy.mockRestore();
    });

    it('updateConnectionStatus should emit connection:status event and change status', () => {
      const emitSpy = vi.spyOn(nostr, 'emit');
      nostr.updateConnectionStatus('connecting');
      expect(nostr.connectionStatus).toBe('connecting');
      expect(emitSpy).toHaveBeenCalledWith('connection:status', { status: 'connecting', count: mockDataStoreInstance.state.relays.length });
    });

    it('updateConnectionStatus should not emit if status is the same', () => {
      nostr.connectionStatus = 'connected';
      const emitSpy = vi.spyOn(nostr, 'emit');
      nostr.updateConnectionStatus('connected');
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('Subscription Handling', () => {
    it('subscribe should call pool.subscribe and trigger eventProcessor.processNostrEvent', () => {
      const filters = [{ kinds: [1] }];
      const processEventSpy = vi.spyOn(nostr.eventProcessor, 'processNostrEvent');
      nostr.subscribe('testsub', filters);
      expect(mockSimplePoolInstance.subscribe).toHaveBeenCalledWith(
        mockDataStoreInstance.state.relays,
        filters,
        expect.objectContaining({ onevent: expect.any(Function) })
      );
      const eventCallback = mockSimplePoolInstance.subscribe.mock.calls[0][2].onevent;
      const mockEvent = { id: 'event1', kind: 1, content: 'hello', pubkey: 'pk1', created_at: TimeUtils.now(), tags:[] };
      eventCallback(mockEvent);
      expect(nostr.seenEventIds.has('event1')).toBe(true);
      expect(processEventSpy).toHaveBeenCalledWith(mockEvent, 'testsub');
      eventCallback(mockEvent);
      expect(processEventSpy).toHaveBeenCalledTimes(1);
      processEventSpy.mockRestore();
    });

    it('subscribe should clear old seenEventIds when cap is reached', () => {
        nostr.seenEventIds = new Set(Array.from({length: 2001}, (_, i) => `id${i}`));
        const debugSpy = vi.spyOn(Logger, 'debug');
        nostr.subscribe('capTestSub', [{ kinds: [1] }]);
        const eventCallback = mockSimplePoolInstance.subscribe.mock.calls[0][2].onevent;
        eventCallback({ id: 'newEventAfterCap', kind:1, content:'test', pubkey:'pk', created_at: TimeUtils.now(), tags:[] });
        expect(nostr.seenEventIds.size).toBeLessThanOrEqual(1501);
        expect(nostr.seenEventIds.has('newEventAfterCap')).toBe(true);
        expect(nostr.seenEventIds.has('id0')).toBe(false);
        expect(debugSpy).toHaveBeenCalledWith('Nostr', 'Pruned seenEventIds set.');
        debugSpy.mockRestore();
    });

    it('subscribeToCoreEvents should subscribe to public feed', () => {
      const subSpy = vi.spyOn(nostr, 'subscribe');
      nostr.subscribeToCoreEvents();
      expect(subSpy).toHaveBeenCalled();
      const publicCall = subSpy.mock.calls.find(call => call[0] === 'public');
      expect(publicCall).toBeDefined();
      expect(publicCall[0]).toBe('public');
      expect(publicCall[1]).toEqual([{ kinds: [1] }]);
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
        mockDataStoreInstance.state.identity.sk = skBytes;
        mockDataStoreInstance.state.identity.pk = pkHex;
        NostrTools.finalizeEvent.mockImplementation((eventTemplate, sk) => ({
            ...eventTemplate,
            id: `mockEventId_${Math.random().toString(36).substring(2,10)}`,
            sig: 'mockSig',
            pubkey: `pk_for_${RealCryptoUtils.bytesToHex(sk)}`
        }));
        // Ensure default successful publish mock for this block, can be overridden by mockImplementationOnce
        mockSimplePoolInstance.publish.mockImplementation((relays, event) =>
            relays.map((r, i) => i === 0 ? Promise.resolve({ event, relay: r, success: true }) : Promise.reject(new Error("Simulated relay failure")))
        );
    });

    it('should successfully publish an event', async () => {
      const eventTemplate = { kind: 1, content: 'Test note', tags: [], created_at: TimeUtils.now() };
      // Explicitly ensure successful mock for this test if needed, though beforeEach should cover it.
      mockSimplePoolInstance.publish.mockImplementationOnce((relays, event) =>
        relays.map((r, i) => i === 0 ? Promise.resolve({ event, relay: r, success: true }) : Promise.reject(new Error("Simulated relay failure")))
      );
      const signedEvent = await nostr.publish(eventTemplate);
      const finalizedEvent = NostrTools.finalizeEvent.mock.results[0].value;
      expect(NostrTools.finalizeEvent).toHaveBeenCalledWith(eventTemplate, skBytes);
      expect(mockSimplePoolInstance.publish).toHaveBeenCalledWith( mockDataStoreInstance.state.relays, finalizedEvent );
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
      mockSimplePoolInstance.publish.mockImplementationOnce((relays, event) =>
        relays.map(r => Promise.reject(new Error(`Failed relay ${r}`))) // All promises in the array reject
      );
      const errorSpy = vi.spyOn(Logger, 'errorWithContext');
      await expect(nostr.publish({})).rejects.toThrow('Failed to publish event to any relay.');
      expect(errorSpy).toHaveBeenCalledWith('Nostr', 'Publish failed on all relays (AggregateError):', expect.any(AggregateError));
      errorSpy.mockRestore();
    });

    it('should throw, log, and re-throw if NostrTools.finalizeEvent fails', async () => {
      const eventTemplate = { kind: 1, content: 'Test note', tags: [], created_at: TimeUtils.now() };
      const signingError = new Error('Signing failed');
      NostrTools.finalizeEvent.mockImplementationOnce(() => { throw signingError; });
      const errorSpy = vi.spyOn(Logger, 'errorWithContext');
      await expect(nostr.publish(eventTemplate)).rejects.toThrow(signingError);
      expect(errorSpy).toHaveBeenCalledWith('Nostr', 'Failed to sign event:', signingError, eventTemplate);
      errorSpy.mockRestore();
    });

    it('should log AggregateError specifically if Promise.any rejects with it', async () => {
        mockSimplePoolInstance.publish.mockImplementationOnce((relays, event) =>
             relays.map(r => Promise.reject(new Error(`Relay ${r} failed`))) // All promises in the array reject
        );
        const errorSpy = vi.spyOn(Logger, 'errorWithContext');
        const eventTemplate = { kind: 1, content: 'Test content', tags: [], created_at: TimeUtils.now() };
        await expect(nostr.publish(eventTemplate)).rejects.toThrow('Failed to publish event to any relay.');
        expect(errorSpy).toHaveBeenCalledWith(
            'Nostr', 'Publish failed on all relays (AggregateError):', expect.any(AggregateError)
        );
        errorSpy.mockRestore();
    });
  });

  describe('Event Fetching', () => {
    beforeEach(() => {
        mockDataStoreInstance.state.identity.pk = 'userpk';
    });

    it('fetchHistoricalMessages for public', async () => {
      const processEventSpy = vi.spyOn(nostr.eventProcessor, 'processNostrEvent');
      const mockEvents = [{id: 'ev1', kind: 1}];
      mockSimplePoolInstance.querySync.mockResolvedValue(mockEvents);
      await nostr.fetchHistoricalMessages({ id: 'public', type: 'public' });
      expect(mockSimplePoolInstance.querySync).toHaveBeenCalledWith(
        mockDataStoreInstance.state.relays, [{ kinds: [1], limit: 20, since: expect.any(Number) }]
      );
      expect(processEventSpy).toHaveBeenCalledWith(mockEvents[0], 'historical-public');
      processEventSpy.mockRestore();
    });

    it('fetchProfile should call pool.get and trigger eventProcessor.processNostrEvent', async () => {
      const pubkey = 'testprofilepk';
      const mockProfileEvent = { id: 'profileEvent', kind: 0, pubkey: pubkey, content: '{}' };
      mockSimplePoolInstance.get.mockResolvedValueOnce(mockProfileEvent);
      const processEventSpy = vi.spyOn(nostr.eventProcessor, 'processNostrEvent');
      await nostr.fetchProfile(pubkey);
      expect(mockSimplePoolInstance.get).toHaveBeenCalledWith(mockDataStoreInstance.state.relays, { kinds: [0], authors: [pubkey] });
      expect(processEventSpy).toHaveBeenCalledWith(mockProfileEvent, 'profile-fetch');
      expect(mockDataStoreInstance.state.fetchingProfiles.has(pubkey)).toBe(false);
      processEventSpy.mockRestore();
    });
  });
});
