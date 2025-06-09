import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { App } from '../../src/index.js'; // Adjust path as necessary

// Mocking services and controllers
vi.mock('../../src/modal-service.js', () => ({
  ModalService: vi.fn(() => ({
    show: vi.fn(),
    hide: vi.fn(),
  })),
}));
vi.mock('../../src/nostr.js', () => ({
  Nostr: vi.fn(() => ({
    connect: vi.fn(),
    publish: vi.fn(event => Promise.resolve({...event, id: 'mockEventId'})), // Mock publish to return a resolved promise
    processMessage: vi.fn(),
    processKind0: vi.fn(),
    fetchHistoricalMessages: vi.fn(() => Promise.resolve()),
    fetchProfile: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
  })),
}));
vi.mock('../../src/store.js', () => ({
  Data: vi.fn(() => ({
    load: vi.fn(() => Promise.resolve()),
    saveThoughts: vi.fn(() => Promise.resolve()),
    saveIdentity: vi.fn(() => Promise.resolve()),
    saveActiveThoughtId: vi.fn(() => Promise.resolve()),
    clearIdentity: vi.fn(() => Promise.resolve()),
    loadMessages: vi.fn(() => Promise.resolve()),
    setState: vi.fn(updater => {
      // Allow simulating setState behavior if needed for specific tests
      if (typeof updater === 'function') {
        // This is a simplified mock; a more complex one could actually update a mock state
        updater(mockAppState.dataStore.state);
      } else {
        mockAppState.dataStore.state = {...mockAppState.dataStore.state, ...updater};
      }
    }),
    on: vi.fn(),
    state: { // Provide a default mock state
      identity: { sk: null, pk: null, profile: null },
      thoughts: { public: { id: 'public', name: 'Public Feed', type: 'public', unread: 0 } },
      activeThoughtId: 'public',
      relays: [],
      messages: {},
      profiles: {},
    },
    // Helper to update mock state for tests
    _updateMockState: function(newState) {
      this.state = { ...this.state, ...newState };
    }
  })),
}));
vi.mock('../../src/ui-controller.js', () => ({
  UIController: vi.fn(() => ({
    showToast: vi.fn(),
    setLoading: vi.fn(),
    hideModal: vi.fn(), // Added from App's usage
    showModal: vi.fn(), // Added from App's usage (though ModalService is primary)
  })),
}));

// Mocking UI components (actual implementations not needed for App logic tests)
vi.mock('../../src/components.js', () => ({
  IdentityPanel: vi.fn(),
  ThoughtList: vi.fn(),
  MainView: vi.fn(),
}));
vi.mock('../../src/ui.js', () => ({
  Button: vi.fn(),
  Component: vi.fn(() => ({ // Mock Component constructor and methods used by App's init
    add: vi.fn().mockReturnThis(),
    mount: vi.fn().mockReturnThis(),
    setContent: vi.fn().mockReturnThis(), // if App directly calls setContent on components
    element: {
        // Mock element properties if App's init interacts with them, e.g. for status bar
        // For now, keeping it simple as App's init mainly creates component instances
    }
  })),
}));


// Mocking utils
vi.mock('../../src/utils.js', () => ({
  Logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  Utils: {
    now: vi.fn(() => Math.floor(Date.now() / 1000)),
    bytesToHex: vi.fn(),
    hexToBytes: vi.fn(),
    shortenPubkey: vi.fn(pk => `${pk.slice(0,4)}...${pk.slice(-4)}`),
    validateRelayUrl: vi.fn(url => url.startsWith('wss://')),
    crypto: {
      aesEncrypt: vi.fn(() => Promise.resolve('encryptedContent')),
      exportKeyAsBase64: vi.fn(() => Promise.resolve('base64Key')),
    },
    // Add other Utils functions if App calls them directly
  },
  EventEmitter: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  })),
}));

// Mocking global browser/NostrTools features
global.NostrTools = {
  generateSecretKey: vi.fn(() => new Uint8Array(32).fill(1)), // returns mock sk
  nip19: {
    decode: vi.fn(npub => ({ type: 'npub', data: 'decoded-' + npub })),
    npubEncode: vi.fn(hex => 'npub' + hex),
  },
  nip04: {
    encrypt: vi.fn(() => Promise.resolve('encryptedNip04Content')),
  },
  getEventHash: vi.fn(event => event.id || 'mockHash'), // if used
  signEvent: vi.fn((event, sk) => ({...event, sig: 'mockSig'})), // if used
};

global.crypto = {
  ...global.crypto, // Preserve other crypto features if any
  subtle: {
    ...global.crypto?.subtle,
    generateKey: vi.fn(() => Promise.resolve({ type: 'secret', algorithm: { name: 'AES-GCM' } })), // Mock crypto.subtle.generateKey
    exportKey: vi.fn(() => Promise.resolve(new ArrayBuffer(32))), // Mock crypto.subtle.exportKey
    // Mock other subtle functions if used by app directly (e.g. digest, importKey)
  },
  randomUUID: vi.fn(() => 'mock-uuid'),
};

global.confirm = vi.fn(() => true); // Default to "OK" for confirms

global.localforage = {
  getItem: vi.fn(() => Promise.resolve(null)),
  setItem: vi.fn(() => Promise.resolve()),
  removeItem: vi.fn(() => Promise.resolve()),
  clear: vi.fn(() => Promise.resolve()),
  config: vi.fn(),
};

// Mock document methods that App.init might use
// Simplified: Assuming App's init uses high-level component abstractions mostly
global.document = {
  body: {
    appendChild: vi.fn(),
    // Add other body methods if used directly
  },
  getElementById: vi.fn(id => ({ remove: vi.fn() })), // For loading indicator
  addEventListener: vi.fn(),
  querySelector: vi.fn(), // if used by App directly
  // Mock other document methods if used by App directly
};

// Helper to create a fresh App instance with new mocks for each test
// This also helps in managing the mock state for dataStore
let mockAppState; // To hold instances for spying
function createAppInstance() {
  const app = new App();
  // Spy on methods after instantiation and mock dependencies are in place
  vi.spyOn(app, 'logout').mockImplementation(() => Promise.resolve());
  vi.spyOn(app, 'selectThought').mockImplementation(() => Promise.resolve());
  vi.spyOn(app, 'sendMessage').mockImplementation(() => Promise.resolve());
  vi.spyOn(app, 'createDmThought').mockImplementation(() => Promise.resolve());
  vi.spyOn(app, 'createGroupThought').mockImplementation(() => Promise.resolve());
  vi.spyOn(app, 'joinGroupThought').mockImplementation(() => Promise.resolve());
  vi.spyOn(app, 'createNoteThought').mockImplementation(() => Promise.resolve());
  vi.spyOn(app, 'updateRelays').mockImplementation(() => Promise.resolve());
  vi.spyOn(app, 'updateProfile').mockImplementation(() => Promise.resolve());


  // Store mock instances for easier access in tests
  mockAppState = {
    app,
    dataStore: app.dataStore,
    ui: app.ui,
    nostr: app.nostr,
    modalService: app.modalService,
  };
  return app;
}


describe('App', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock App's init to prevent it from running fully during unit tests
    // We only want to test specific methods like handleAction in isolation first.
    // If init is essential for a test suite, it can be unmocked or partially mocked there.
    vi.spyOn(App.prototype, 'init').mockImplementation(() => Promise.resolve());

    app = createAppInstance();
  });

  afterEach(() => {
    vi.restoreAllMocks(); // Restore original implementations where spied on
  });

  describe('handleAction', () => {
    it("should call modalService.show('identity') for 'manage-identity' when not logged in", () => {
      mockAppState.dataStore._updateMockState({ identity: { sk: null } }); // Simulate not logged in
      app.handleAction('manage-identity');
      expect(mockAppState.modalService.show).toHaveBeenCalledWith('identity');
      expect(app.logout).not.toHaveBeenCalled();
    });

    it("should call app.logout() for 'manage-identity' when logged in", () => {
      mockAppState.dataStore._updateMockState({ identity: { sk: 'a_secret_key' } }); // Simulate logged in
      app.handleAction('manage-identity');
      expect(app.logout).toHaveBeenCalled();
      expect(mockAppState.modalService.show).not.toHaveBeenCalled();
    });

    it("should call modalService.show with modalName for 'show-modal'", () => {
      const modalName = 'profile';
      app.handleAction('show-modal', modalName);
      expect(mockAppState.modalService.show).toHaveBeenCalledWith(modalName);
    });

    it("should call app.selectThought with id for 'select-thought'", () => {
      const thoughtId = 'some-thought-id';
      app.handleAction('select-thought', thoughtId);
      expect(app.selectThought).toHaveBeenCalledWith(thoughtId);
    });

    it("should call app.sendMessage with content for 'send-message'", () => {
      const messageContent = 'Hello world';
      app.handleAction('send-message', messageContent);
      expect(app.sendMessage).toHaveBeenCalledWith(messageContent);
    });

    it("should call app.createGroupThought with name for 'create-group'", () => {
      const groupName = 'Test Group';
      const formData = { get: vi.fn(key => key === 'name' ? groupName : null) };
      app.handleAction('create-group', formData);
      expect(formData.get).toHaveBeenCalledWith('name');
      expect(app.createGroupThought).toHaveBeenCalledWith(groupName);
    });

    // Example for an action that uses formData and calls another app method
    it("should call app.createDmThought with pubkey for 'create-dm'", () => {
      const pubkey = 'test-pubkey';
      const formData = { get: vi.fn(key => key === 'pubkey' ? pubkey : null) };
      app.handleAction('create-dm', formData);
      expect(formData.get).toHaveBeenCalledWith('pubkey');
      expect(app.createDmThought).toHaveBeenCalledWith(pubkey);
    });

    it("should call app.leaveThought for 'leave-thought'", () => {
      app.handleAction('leave-thought');
      expect(app.leaveThought).toHaveBeenCalled();
    });

    it("should call app.updateProfile with formData for 'update-profile'", () => {
      const mockProfileData = { name: 'Test User', picture: 'http://example.com/pic.jpg', nip05: 'user@example.com' };
      const formData = { get: vi.fn(key => mockProfileData[key]) };
      app.handleAction('update-profile', formData);
      expect(app.updateProfile).toHaveBeenCalledWith(formData);
    });

    it("should call app.joinGroupThought with id, key, and name for 'join-group'", () => {
      const mockGroupJoinData = { id: 'group-id', key: 'group-key', name: 'Test Group Name' };
      const formData = { get: vi.fn(key => mockGroupJoinData[key]) };
      app.handleAction('join-group', formData);
      expect(formData.get).toHaveBeenCalledWith('id');
      expect(formData.get).toHaveBeenCalledWith('key');
      expect(formData.get).toHaveBeenCalledWith('name');
      expect(app.joinGroupThought).toHaveBeenCalledWith(mockGroupJoinData.id, mockGroupJoinData.key, mockGroupJoinData.name);
    });

    it("should call app.updateRelays with new relay list for 'add-relay'", () => {
      const initialRelays = ['wss://initial.relay.com'];
      mockAppState.dataStore._updateMockState({ relays: initialRelays });
      const newRelayUrl = 'wss://new.relay.com';
      const formData = { get: vi.fn(key => key === 'url' ? newRelayUrl : null) };

      app.handleAction('add-relay', formData);

      expect(formData.get).toHaveBeenCalledWith('url');
      expect(app.updateRelays).toHaveBeenCalledWith([...initialRelays, newRelayUrl]);
    });

    describe("'remove-relay' action", () => {
      const relayToRemove = 'wss://relay1.com';
      const otherRelay = 'wss://relay2.com';
      beforeEach(() => {
        // Setup initial relays in the mock DataStore state
        mockAppState.dataStore._updateMockState({ relays: [relayToRemove, otherRelay] });
      });

      it("should call app.updateRelays with filtered list if user confirms", () => {
        global.confirm.mockReturnValue(true); // User clicks "OK"
        app.handleAction('remove-relay', relayToRemove);
        expect(global.confirm).toHaveBeenCalledWith(`Are you sure you want to remove the relay: ${relayToRemove}?`);
        expect(app.updateRelays).toHaveBeenCalledWith([otherRelay]);
      });

      it("should NOT call app.updateRelays if user cancels", () => {
        global.confirm.mockReturnValue(false); // User clicks "Cancel"
        app.handleAction('remove-relay', relayToRemove);
        expect(global.confirm).toHaveBeenCalledWith(`Are you sure you want to remove the relay: ${relayToRemove}?`);
        expect(app.updateRelays).not.toHaveBeenCalled();
      });
    });

    it("should call app.createNoteThought for 'create-note'", () => {
      app.handleAction('create-note');
      expect(app.createNoteThought).toHaveBeenCalled();
    });

  });

  describe('selectThought(id)', () => {
    const currentThoughtId = 'currentPublic';
    const newThoughtId = 'newDmThought';
    let thoughtsMock;

    beforeEach(() => {
      // Restore selectThought to its original implementation for this suite
      if (app.selectThought.mockRestore) {
        app.selectThought.mockRestore();
      }
       // Reset spies on DataStore methods that might be called by selectThought
      vi.spyOn(mockAppState.dataStore, 'setState');
      vi.spyOn(mockAppState.dataStore, 'saveActiveThoughtId');
      vi.spyOn(mockAppState.dataStore, 'saveThoughts');
      vi.spyOn(mockAppState.dataStore, 'loadMessages');
      vi.spyOn(mockAppState.nostr, 'fetchHistoricalMessages');


      thoughtsMock = {
        [currentThoughtId]: { id: currentThoughtId, name: 'Current Public Thought', type: 'public', unread: 0 },
        [newThoughtId]: { id: newThoughtId, name: 'New DM', type: 'dm', pubkey: 'dm-pubkey', unread: 5 },
        public: { id: 'public', name: 'Default Public', type: 'public', unread: 0 } // Fallback thought
      };
      mockAppState.dataStore._updateMockState({
        activeThoughtId: currentThoughtId,
        thoughts: thoughtsMock,
        messages: {
            [currentThoughtId]: [],
            [newThoughtId]: [],
            public: []
        }
      });
    });

    it('successfully selects a new thought with unread messages', async () => {
      await app.selectThought(newThoughtId);

      expect(mockAppState.ui.setLoading).toHaveBeenCalledWith(true);
      expect(mockAppState.dataStore.setState).toHaveBeenCalledWith(expect.any(Function));

      // Simulate the effect of setState for verification
      const setStateFn = mockAppState.dataStore.setState.mock.calls[0][0];
      const tempState = { activeThoughtId: currentThoughtId, thoughts: JSON.parse(JSON.stringify(thoughtsMock)) };
      setStateFn(tempState);
      expect(tempState.activeThoughtId).toBe(newThoughtId);
      expect(tempState.thoughts[newThoughtId].unread).toBe(0);

      expect(mockAppState.dataStore.saveActiveThoughtId).toHaveBeenCalled();
      expect(mockAppState.dataStore.saveThoughts).toHaveBeenCalled(); // Because unread > 0 initially
      expect(mockAppState.dataStore.loadMessages).toHaveBeenCalledWith(newThoughtId);
      expect(mockAppState.nostr.fetchHistoricalMessages).toHaveBeenCalledWith(thoughtsMock[newThoughtId]);
      expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
    });

    it('does not call save/load methods if selecting the same thought with no unread messages', async () => {
      // Ensure the current thought has 0 unread messages
      thoughtsMock[currentThoughtId].unread = 0;
      mockAppState.dataStore._updateMockState({ activeThoughtId: currentThoughtId, thoughts: thoughtsMock });

      await app.selectThought(currentThoughtId);

      expect(mockAppState.ui.setLoading).toHaveBeenCalledWith(true);
      expect(mockAppState.dataStore.setState).toHaveBeenCalled(); // setState is still called

      expect(mockAppState.dataStore.saveActiveThoughtId).not.toHaveBeenCalled();
      expect(mockAppState.dataStore.saveThoughts).not.toHaveBeenCalled();
      expect(mockAppState.dataStore.loadMessages).not.toHaveBeenCalled();
      expect(mockAppState.nostr.fetchHistoricalMessages).not.toHaveBeenCalled();
      expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
    });

    it('selects a new thought with unread already 0, saves activeId, loads messages, but not thoughts', async () => {
      thoughtsMock[newThoughtId].unread = 0; // Set unread to 0 for this test
       mockAppState.dataStore._updateMockState({ thoughts: thoughtsMock, activeThoughtId: currentThoughtId });


      await app.selectThought(newThoughtId);

      expect(mockAppState.ui.setLoading).toHaveBeenCalledWith(true);
      expect(mockAppState.dataStore.setState).toHaveBeenCalled();

      const setStateFn = mockAppState.dataStore.setState.mock.calls[0][0];
      const tempState = { activeThoughtId: currentThoughtId, thoughts: JSON.parse(JSON.stringify(thoughtsMock)) };
      setStateFn(tempState); // activeThoughtId becomes newThoughtId, unread remains 0

      expect(mockAppState.dataStore.saveActiveThoughtId).toHaveBeenCalled();
      expect(mockAppState.dataStore.saveThoughts).not.toHaveBeenCalled(); // unread was already 0
      expect(mockAppState.dataStore.loadMessages).toHaveBeenCalledWith(newThoughtId);
      expect(mockAppState.nostr.fetchHistoricalMessages).toHaveBeenCalledWith(thoughtsMock[newThoughtId]);
      expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
    });

    it('selects "public" thought if an invalid thought ID is provided', async () => {
      const invalidThoughtId = 'nonExistentId';
      await app.selectThought(invalidThoughtId);

      expect(mockAppState.ui.setLoading).toHaveBeenCalledWith(true);
      expect(mockAppState.dataStore.setState).toHaveBeenCalled();

      const setStateFn = mockAppState.dataStore.setState.mock.calls[0][0];
      const tempState = { activeThoughtId: currentThoughtId, thoughts: JSON.parse(JSON.stringify(thoughtsMock)) };
      setStateFn(tempState);
      expect(tempState.activeThoughtId).toBe('public'); // Defaults to 'public'

      expect(mockAppState.dataStore.saveActiveThoughtId).toHaveBeenCalled();
      expect(mockAppState.dataStore.loadMessages).toHaveBeenCalledWith('public');
      expect(mockAppState.nostr.fetchHistoricalMessages).toHaveBeenCalledWith(thoughtsMock.public);
      expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
    });

    describe('Error Handling', () => {
      const error = new Error('Test Error');

      it('handles error from loadMessages', async () => {
        mockAppState.dataStore.loadMessages.mockRejectedValueOnce(error);
        await app.selectThought(newThoughtId);
        expect(mockAppState.ui.showToast).toHaveBeenCalledWith(expect.stringContaining('Failed to load thought: Test Error'), 'error');
        expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
      });

      it('handles error from fetchHistoricalMessages', async () => {
        mockAppState.nostr.fetchHistoricalMessages.mockRejectedValueOnce(error);
        await app.selectThought(newThoughtId);
        expect(mockAppState.ui.showToast).toHaveBeenCalledWith(expect.stringContaining('Failed to load thought: Test Error'), 'error');
        expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
      });

      it('handles error from saveActiveThoughtId', async () => {
        mockAppState.dataStore.saveActiveThoughtId.mockRejectedValueOnce(error);
        await app.selectThought(newThoughtId);
        expect(mockAppState.ui.showToast).toHaveBeenCalledWith(expect.stringContaining('Failed to load thought: Test Error'), 'error');
        expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
      });

      it('handles error from saveThoughts', async () => {
        // Ensure unread > 0 to trigger saveThoughts
        thoughtsMock[newThoughtId].unread = 1;
        mockAppState.dataStore._updateMockState({ thoughts: thoughtsMock });

        mockAppState.dataStore.saveThoughts.mockRejectedValueOnce(error);
        await app.selectThought(newThoughtId);
        expect(mockAppState.ui.showToast).toHaveBeenCalledWith(expect.stringContaining('Failed to load thought: Test Error'), 'error');
        expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
      });
    });
  });

  describe('saveIdentity(skInput)', () => {
    let mockDecodedNsecKey;
    let mockHexBytesKey;
    let mockGeneratedKey;

    beforeEach(() => {
      // Restore to original implementation for this suite
      if (app.saveIdentity?.mockRestore) app.saveIdentity.mockRestore();

      mockDecodedNsecKey = new Uint8Array([1, 2, 3]);
      mockHexBytesKey = new Uint8Array([4, 5, 6]);
      mockGeneratedKey = new Uint8Array([7, 8, 9]);

      // Reset spies or mocks that are specific to saveIdentity calls
      vi.spyOn(mockAppState.ui, 'hideModal');
      vi.spyOn(mockAppState.ui, 'setLoading');
      vi.spyOn(mockAppState.ui, 'showToast');
      vi.spyOn(mockAppState.dataStore, 'clearIdentity');
      vi.spyOn(mockAppState.dataStore, 'saveIdentity');
      vi.spyOn(mockAppState.dataStore, 'load');
      vi.spyOn(NostrTools.nip19, 'decode').mockReturnValue({ data: mockDecodedNsecKey });
      vi.spyOn(NostrTools, 'generateSecretKey').mockReturnValue(mockGeneratedKey);
      vi.spyOn(Utils, 'hexToBytes').mockReturnValue(mockHexBytesKey); // Assuming Utils is an object with hexToBytes
      global.confirm.mockClear(); // Clear confirm mock specifically
    });

    it('saves with a valid nsec input, no existing identity', async () => {
      mockAppState.dataStore._updateMockState({ identity: { sk: null } });

      await app.saveIdentity('nsec1validkey');

      expect(mockAppState.ui.hideModal).toHaveBeenCalled();
      expect(mockAppState.ui.setLoading).toHaveBeenCalledWith(true);
      expect(global.confirm).not.toHaveBeenCalled();
      expect(NostrTools.nip19.decode).toHaveBeenCalledWith('nsec1validkey');
      expect(mockAppState.dataStore.clearIdentity).toHaveBeenCalled();
      expect(mockAppState.dataStore.saveIdentity).toHaveBeenCalledWith(mockDecodedNsecKey);
      expect(mockAppState.dataStore.load).toHaveBeenCalled();
      expect(mockAppState.ui.showToast).toHaveBeenCalledWith('Identity loaded!', 'success');
      expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
    });

    it('saves with a valid hex input, existing identity, user confirms', async () => {
      mockAppState.dataStore._updateMockState({ identity: { sk: 'oldSecretKey' } });
      global.confirm.mockReturnValue(true);

      await app.saveIdentity('validhex64chars');

      expect(mockAppState.ui.hideModal).toHaveBeenCalled();
      expect(mockAppState.ui.setLoading).toHaveBeenCalledWith(true);
      expect(global.confirm).toHaveBeenCalledWith(expect.stringContaining('overwrite your existing identity'));
      expect(Utils.hexToBytes).toHaveBeenCalledWith('validhex64chars');
      expect(mockAppState.dataStore.clearIdentity).toHaveBeenCalled();
      expect(mockAppState.dataStore.saveIdentity).toHaveBeenCalledWith(mockHexBytesKey);
      expect(mockAppState.dataStore.load).toHaveBeenCalled();
      expect(mockAppState.ui.showToast).toHaveBeenCalledWith('Identity loaded!', 'success');
      expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
    });

    it('does NOT save if generating new key with existing identity and user cancels', async () => {
      mockAppState.dataStore._updateMockState({ identity: { sk: 'oldSecretKey' } });
      global.confirm.mockReturnValue(false);

      await app.saveIdentity(''); // Empty input means generate new

      expect(mockAppState.ui.hideModal).toHaveBeenCalled();
      expect(mockAppState.ui.setLoading).toHaveBeenCalledWith(true); // setLoading(true) is called before confirm
      expect(global.confirm).toHaveBeenCalledWith(expect.stringContaining('generate a new identity?'));
      expect(NostrTools.generateSecretKey).not.toHaveBeenCalled();
      expect(mockAppState.dataStore.clearIdentity).not.toHaveBeenCalled();
      expect(mockAppState.dataStore.saveIdentity).not.toHaveBeenCalled();
      expect(mockAppState.dataStore.load).not.toHaveBeenCalled();
      expect(mockAppState.ui.showToast).not.toHaveBeenCalledWith('Identity loaded!', 'success');
      expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false); // setLoading(false) due to early return
    });

    it('generates and saves a new key if no input and no existing identity', async () => {
      mockAppState.dataStore._updateMockState({ identity: { sk: null } });

      await app.saveIdentity('');

      expect(mockAppState.ui.hideModal).toHaveBeenCalled();
      expect(mockAppState.ui.setLoading).toHaveBeenCalledWith(true);
      expect(global.confirm).not.toHaveBeenCalled();
      expect(NostrTools.generateSecretKey).toHaveBeenCalled();
      expect(mockAppState.dataStore.clearIdentity).toHaveBeenCalled();
      expect(mockAppState.dataStore.saveIdentity).toHaveBeenCalledWith(mockGeneratedKey);
      expect(mockAppState.dataStore.load).toHaveBeenCalled();
      expect(mockAppState.ui.showToast).toHaveBeenCalledWith('Identity loaded!', 'success');
      expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
    });

    it('shows error toast for invalid secret key format', async () => {
      await app.saveIdentity('invalidformat');

      expect(mockAppState.ui.hideModal).toHaveBeenCalled();
      expect(mockAppState.ui.setLoading).toHaveBeenCalledWith(true);
      expect(mockAppState.ui.showToast).toHaveBeenCalledWith('Error saving identity: Invalid secret key format.', 'error');
      expect(mockAppState.dataStore.saveIdentity).not.toHaveBeenCalled();
      expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
    });

    it('handles error during dataStore.saveIdentity and calls clearIdentity again if generating new key', async () => {
      mockAppState.dataStore._updateMockState({ identity: { sk: null } }); // No existing key, so generating new
      const saveError = new Error('DB save failed');
      mockAppState.dataStore.saveIdentity.mockRejectedValueOnce(saveError);

      await app.saveIdentity(''); // Attempt to generate and save

      expect(mockAppState.ui.hideModal).toHaveBeenCalled();
      expect(mockAppState.ui.setLoading).toHaveBeenCalledWith(true);
      expect(NostrTools.generateSecretKey).toHaveBeenCalled();
      expect(mockAppState.dataStore.clearIdentity).toHaveBeenCalledTimes(2); // Once before save, once after failed save of new key
      expect(mockAppState.dataStore.saveIdentity).toHaveBeenCalledWith(mockGeneratedKey);
      expect(mockAppState.ui.showToast).toHaveBeenCalledWith(`Error saving identity: ${saveError.message}`, 'error');
      expect(mockAppState.dataStore.load).not.toHaveBeenCalled(); // Should not proceed to load
      expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
    });

    it('handles error during dataStore.saveIdentity and does NOT call clearIdentity again if importing key', async () => {
      mockAppState.dataStore._updateMockState({ identity: { sk: null } }); // No existing key
      const saveError = new Error('DB save failed');
      mockAppState.dataStore.saveIdentity.mockRejectedValueOnce(saveError);

      await app.saveIdentity('nsec1validkey'); // Attempt to import and save

      expect(mockAppState.dataStore.clearIdentity).toHaveBeenCalledTimes(1); // Only once before trying to save imported key
      expect(mockAppState.ui.showToast).toHaveBeenCalledWith(`Error saving identity: ${saveError.message}`, 'error');
      expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
    });


    it('handles error from nip19.decode', async () => {
      const decodeError = new Error('NIP19 decode failed');
      NostrTools.nip19.decode.mockImplementationOnce(() => { throw decodeError; });

      await app.saveIdentity('nsec1invalid');

      expect(mockAppState.ui.hideModal).toHaveBeenCalled();
      expect(mockAppState.ui.setLoading).toHaveBeenCalledWith(true);
      expect(mockAppState.ui.showToast).toHaveBeenCalledWith(`Error saving identity: ${decodeError.message}`, 'error');
      expect(mockAppState.dataStore.saveIdentity).not.toHaveBeenCalled();
      expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
    });
  });
});
