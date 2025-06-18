import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { App } from '../../src/index.js';

// Crypto utils are not mocked at module level anymore for this file.
// App.js should import them directly. If a specific test needs to mock them, it will do so locally.

// Mocking services and controllers
vi.mock('../../src/modal-service.js', () => ({
  ModalService: vi.fn(() => ({ show: vi.fn(), hide: vi.fn() })),
}));
vi.mock('../../src/nostr.js', () => ({
  Nostr: vi.fn(() => ({
    connect: vi.fn(),
    publish: vi.fn(event => Promise.resolve({...event, id: 'mockEventId'})),
    fetchHistoricalMessages: vi.fn(() => Promise.resolve()),
    fetchProfile: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    eventProcessor: { processNostrEvent: vi.fn() }
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
    setState: vi.fn(function(updater) { // Use function to get 'this' context
      if (typeof updater === 'function') updater(this.state); // Use this.state
      else this.state = {...this.state, ...updater}; // Use this.state
    }),
    on: vi.fn(),
    state: { // This is the initial state for the mock
      identity: { sk: null, pk: null, profile: null },
      thoughts: { public: { id: 'public', name: 'Public Feed', type: 'public', unread: 0 } },
      activeThoughtId: 'public',
      relays: [], messages: {}, profiles: {}
    },
    _updateMockState: function(newState) { this.state = { ...this.state, ...newState }; }
  })),
}));
vi.mock('../../src/ui-controller.js', () => ({
  UIController: vi.fn(() => ({ showToast: vi.fn(), setLoading: vi.fn(), hideModal: vi.fn(), showModal: vi.fn() })),
}));
vi.mock('../../src/components.js', () => ({ IdentityPanel: vi.fn(), ThoughtList: vi.fn(), MainView: vi.fn() }));
vi.mock('../../src/ui.js', () => ({
  Button: vi.fn(),
  Component: vi.fn(() => ({ add: vi.fn().mockReturnThis(), mount: vi.fn().mockReturnThis(), setContent: vi.fn().mockReturnThis(), element: {} })),
}));

// Logger is globally mocked in tests/setup.js

// App.js directly imports from crypto-utils.js. For tests where specific crypto utils behavior
// needs to be controlled (like hexToBytes for saveIdentity tests, which are currently commented out),
// those specific functions would be spied on within those tests/describe blocks.
// For now, no module-level mock for crypto-utils.js here.

global.NostrTools = {
  generateSecretKey: vi.fn(() => new Uint8Array(32).fill(1)),
  nip19: { decode: vi.fn(npub => ({ type: 'npub', data: 'decoded-' + npub })), npubEncode: vi.fn(hex => 'npub' + hex) },
  nip04: { encrypt: vi.fn(() => Promise.resolve('encryptedNip04Content')) },
};
global.crypto = {
  ...global.crypto,
  subtle: { ...(global.crypto?.subtle || {}), generateKey: vi.fn(() => Promise.resolve({ type: 'secret', algorithm: { name: 'AES-GCM' } })), exportKey: vi.fn(() => Promise.resolve(new ArrayBuffer(32))) },
  randomUUID: vi.fn(() => 'mock-uuid'),
};

global.localforage = { getItem: vi.fn(() => Promise.resolve(null)), setItem: vi.fn(() => Promise.resolve()), removeItem: vi.fn(() => Promise.resolve()), clear: vi.fn(() => Promise.resolve()), config: vi.fn() };
global.document = {
  body: { appendChild: vi.fn() },
  getElementById: vi.fn(id => ({ remove: vi.fn() })),
  addEventListener: vi.fn(), querySelector: vi.fn(),
};

let mockAppState;
function createAppInstance() {
  const app = new App();
  vi.spyOn(app.identityService, 'logout').mockImplementation(() => Promise.resolve());
  // vi.spyOn(app.thoughtManagerService, 'selectThought').mockImplementation(() => Promise.resolve()); // REMOVE THIS MOCK to test actual implementation
  vi.spyOn(app.nostrPublishService, 'sendMessage').mockImplementation(() => Promise.resolve());
  vi.spyOn(app.thoughtCreationService, 'createDmThought').mockImplementation(() => Promise.resolve());
  vi.spyOn(app.thoughtCreationService, 'createGroupThought').mockImplementation(() => Promise.resolve());
  vi.spyOn(app.thoughtCreationService, 'joinGroupThought').mockImplementation(() => Promise.resolve());
  vi.spyOn(app.thoughtCreationService, 'createNoteThought').mockImplementation(() => Promise.resolve());
  vi.spyOn(app.relayManagerService, 'addRelay').mockImplementation(() => Promise.resolve());
  vi.spyOn(app.relayManagerService, 'removeRelay').mockImplementation(() => Promise.resolve()); // This spy is important
  vi.spyOn(app.nostrPublishService, 'updateProfile').mockImplementation(() => Promise.resolve());
  vi.spyOn(app.thoughtManagerService, 'leaveThought').mockImplementation(() => Promise.resolve());
  vi.spyOn(app.thoughtManagerService, 'updateNoteContent').mockImplementation(() => Promise.resolve());

  // Explicitly spy on the setLoading method of the ui instance that will be used
  vi.spyOn(app.ui, 'setLoading');
  vi.spyOn(app.ui, 'showToast');


  mockAppState = { app, dataStore: app.dataStore, ui: app.ui, nostr: app.nostr, modalService: app.modalService, identityService: app.identityService, thoughtManagerService: app.thoughtManagerService, nostrPublishService: app.nostrPublishService, relayManagerService: app.relayManagerService };
  return app;
}

describe('App', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    // No specific hexToBytes mock needed here unless a test directly requires it for App.js methods
    vi.spyOn(App.prototype, 'init').mockImplementation(() => Promise.resolve());
    app = createAppInstance();
  });

  afterEach(() => { vi.restoreAllMocks(); });

  describe('handleAction', () => {
    it("should call modalService.show('identity') for 'manage-identity' when not logged in", () => {
      mockAppState.dataStore._updateMockState({ identity: { sk: null } });
      app.handleAction('manage-identity');
      expect(mockAppState.modalService.show).toHaveBeenCalledWith('identity');
      expect(app.identityService.logout).not.toHaveBeenCalled();
    });

    it("should call app.identityService.logout() for 'manage-identity' when logged in", () => {
      mockAppState.dataStore._updateMockState({ identity: { sk: 'a_secret_key' } });
      app.handleAction('manage-identity');
      expect(app.identityService.logout).toHaveBeenCalled();
      expect(mockAppState.modalService.show).not.toHaveBeenCalled();
    });

    it("should call modalService.show with modalName for 'show-modal'", () => {
      const modalName = 'profile';
      app.handleAction('show-modal', modalName);
      expect(mockAppState.modalService.show).toHaveBeenCalledWith(modalName);
    });

    it("should call app.thoughtManagerService.selectThought with id for 'select-thought'", () => {
      const thoughtId = 'some-thought-id';
      // Spy specifically for this test case, as other tests need the original implementation
      vi.spyOn(app.thoughtManagerService, 'selectThought');
      app.handleAction('select-thought', thoughtId);
      expect(app.thoughtManagerService.selectThought).toHaveBeenCalledWith(thoughtId);
    });

    it("should call app.nostrPublishService.sendMessage with content for 'send-message'", () => {
      const messageContent = 'Hello world';
      app.handleAction('send-message', messageContent);
      expect(app.nostrPublishService.sendMessage).toHaveBeenCalledWith(messageContent);
    });

    it("should call app.createGroupThought with name for 'create-group'", () => {
      const groupName = 'Test Group';
      const formData = { get: vi.fn(key => key === 'name' ? groupName : null) };
      app.handleAction('create-group', formData);
      expect(formData.get).toHaveBeenCalledWith('name');
      expect(app.thoughtCreationService.createGroupThought).toHaveBeenCalledWith(groupName);
    });

    it("should call app.createDmThought with pubkey for 'create-dm'", () => {
      const pubkey = 'test-pubkey';
      const formData = { get: vi.fn(key => key === 'pubkey' ? pubkey : null) };
      app.handleAction('create-dm', formData);
      expect(formData.get).toHaveBeenCalledWith('pubkey');
      expect(app.thoughtCreationService.createDmThought).toHaveBeenCalledWith(pubkey);
    });

    it("should call app.thoughtManagerService.leaveThought for 'leave-thought'", () => {
      app.handleAction('leave-thought');
      expect(app.thoughtManagerService.leaveThought).toHaveBeenCalled();
    });

    it("should call app.nostrPublishService.updateProfile with formData for 'update-profile'", () => {
      const mockProfileData = { name: 'Test User', picture: 'http://example.com/pic.jpg', nip05: 'user@example.com' };
      const formData = { get: vi.fn(key => mockProfileData[key]) };
      app.handleAction('update-profile', formData);
      expect(app.nostrPublishService.updateProfile).toHaveBeenCalledWith(formData);
    });

    it("should call app.joinGroupThought with id, key, and name for 'join-group'", () => {
      const mockGroupJoinData = { id: 'group-id', key: 'group-key', name: 'Test Group Name' };
      const formData = { get: vi.fn(key => mockGroupJoinData[key]) };
      app.handleAction('join-group', formData);
      expect(formData.get).toHaveBeenCalledWith('id');
      expect(formData.get).toHaveBeenCalledWith('key');
      expect(formData.get).toHaveBeenCalledWith('name');
      expect(app.thoughtCreationService.joinGroupThought).toHaveBeenCalledWith(mockGroupJoinData.id, mockGroupJoinData.key, mockGroupJoinData.name);
    });

    it("should call app.relayManagerService.addRelay for 'add-relay'", () => {
      const newRelayUrl = 'wss://new.relay.com';
      const formData = { get: vi.fn(key => key === 'url' ? newRelayUrl : null) };
      app.handleAction('add-relay', formData);
      expect(formData.get).toHaveBeenCalledWith('url');
      expect(app.relayManagerService.addRelay).toHaveBeenCalledWith(newRelayUrl);
    });

    describe("'remove-relay' action", () => {
      const relayToRemove = 'wss://relay1.com';

      beforeEach(() => { // This beforeEach is specific to this inner describe block
        mockAppState.dataStore._updateMockState({ relays: [relayToRemove, 'wss://relay2.com'] });
      });

      // The confirm logic is inside relayManagerService.removeRelay, not in App.handleAction directly.
      // So, these tests should just check if the service method is called.
      // The internal behavior of relayManagerService.removeRelay (including confirm)
      // should be tested in relay-manager-service.spec.js.
      it("should call app.relayManagerService.removeRelay for 'remove-relay'", () => {
        app.handleAction('remove-relay', relayToRemove);
        expect(app.relayManagerService.removeRelay).toHaveBeenCalledWith(relayToRemove);
      });
    });

    it("should call app.createNoteThought for 'create-note'", () => {
      app.handleAction('create-note');
      expect(app.thoughtCreationService.createNoteThought).toHaveBeenCalled();
    });
  });

  describe('selectThought(id)', () => {
    const currentThoughtId = 'currentPublic';
    const newThoughtId = 'newDmThought';
    let thoughtsMock;

    beforeEach(async () => {
      if (vi.isMockFunction(App.prototype.selectThought)) {
        App.prototype.selectThought.mockRestore();
      }
      vi.spyOn(mockAppState.dataStore, 'setState');
      vi.spyOn(mockAppState.dataStore, 'saveActiveThoughtId');
      vi.spyOn(mockAppState.dataStore, 'saveThoughts');
      vi.spyOn(mockAppState.dataStore, 'loadMessages');
      vi.spyOn(mockAppState.nostr, 'fetchHistoricalMessages');

      thoughtsMock = {
        [currentThoughtId]: { id: currentThoughtId, name: 'Current Public Thought', type: 'public', unread: 0 },
        [newThoughtId]: { id: newThoughtId, name: 'New DM', type: 'dm', pubkey: 'dm-pubkey', unread: 5 },
        public: { id: 'public', name: 'Default Public', type: 'public', unread: 0 }
      };
      mockAppState.dataStore._updateMockState({
        activeThoughtId: currentThoughtId,
        thoughts: thoughtsMock,
        messages: { [currentThoughtId]: [], [newThoughtId]: [], public: [] }
      });
    });

    it('successfully selects a new thought with unread messages', async () => {
      // Diagnostic lines removed

      await app.thoughtManagerService.selectThought(newThoughtId);
      expect(mockAppState.ui.setLoading).toHaveBeenCalledWith(true);
      expect(mockAppState.dataStore.setState).toHaveBeenCalledWith(expect.any(Function));
      const setStateFn = mockAppState.dataStore.setState.mock.calls[0][0];
      const tempState = { activeThoughtId: currentThoughtId, thoughts: JSON.parse(JSON.stringify(thoughtsMock)) };
      setStateFn(tempState);
      expect(tempState.activeThoughtId).toBe(newThoughtId);
      expect(tempState.thoughts[newThoughtId].unread).toBe(0);
      expect(mockAppState.dataStore.saveActiveThoughtId).toHaveBeenCalled();
      expect(mockAppState.dataStore.saveThoughts).toHaveBeenCalled();
      expect(mockAppState.dataStore.loadMessages).toHaveBeenCalledWith(newThoughtId);
      expect(mockAppState.nostr.fetchHistoricalMessages).toHaveBeenCalledWith(thoughtsMock[newThoughtId]);
      expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
    });

    it('does not call save/load methods if selecting the same thought with no unread messages', async () => {
      thoughtsMock[currentThoughtId].unread = 0;
      mockAppState.dataStore._updateMockState({ activeThoughtId: currentThoughtId, thoughts: thoughtsMock });
      await app.thoughtManagerService.selectThought(currentThoughtId);
      expect(mockAppState.ui.setLoading).toHaveBeenCalledWith(true);
      expect(mockAppState.dataStore.setState).toHaveBeenCalled();
      expect(mockAppState.dataStore.saveActiveThoughtId).not.toHaveBeenCalled();
      expect(mockAppState.dataStore.saveThoughts).not.toHaveBeenCalled();
      expect(mockAppState.dataStore.loadMessages).not.toHaveBeenCalled();
      expect(mockAppState.nostr.fetchHistoricalMessages).not.toHaveBeenCalled();
      expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
    });

    it('selects a new thought with unread already 0, saves activeId, loads messages, but not thoughts', async () => {
      thoughtsMock[newThoughtId].unread = 0;
      mockAppState.dataStore._updateMockState({ thoughts: thoughtsMock, activeThoughtId: currentThoughtId });
      await app.thoughtManagerService.selectThought(newThoughtId);
      expect(mockAppState.ui.setLoading).toHaveBeenCalledWith(true);
      expect(mockAppState.dataStore.setState).toHaveBeenCalled();
      const setStateFn = mockAppState.dataStore.setState.mock.calls[0][0];
      const tempState = { activeThoughtId: currentThoughtId, thoughts: JSON.parse(JSON.stringify(thoughtsMock)) };
      setStateFn(tempState);
      expect(mockAppState.dataStore.saveActiveThoughtId).toHaveBeenCalled();
      expect(mockAppState.dataStore.saveThoughts).not.toHaveBeenCalled();
      expect(mockAppState.dataStore.loadMessages).toHaveBeenCalledWith(newThoughtId);
      expect(mockAppState.nostr.fetchHistoricalMessages).toHaveBeenCalledWith(thoughtsMock[newThoughtId]);
      expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
    });

    it('selects "public" thought if an invalid thought ID is provided', async () => {
      const invalidThoughtId = 'nonExistentId';
      await app.thoughtManagerService.selectThought(invalidThoughtId);
      expect(mockAppState.ui.setLoading).toHaveBeenCalledWith(true);
      expect(mockAppState.dataStore.setState).toHaveBeenCalled();
      const setStateFn = mockAppState.dataStore.setState.mock.calls[0][0];
      const tempState = { activeThoughtId: currentThoughtId, thoughts: JSON.parse(JSON.stringify(thoughtsMock)) };
      setStateFn(tempState);
      expect(tempState.activeThoughtId).toBe('public');
      expect(mockAppState.dataStore.saveActiveThoughtId).toHaveBeenCalled();
      expect(mockAppState.dataStore.loadMessages).toHaveBeenCalledWith('public');
      expect(mockAppState.nostr.fetchHistoricalMessages).toHaveBeenCalledWith(thoughtsMock.public);
      expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
    });

    describe('Error Handling', () => {
      const error = new Error('Test Error');
      it('handles error from loadMessages', async () => {
        mockAppState.dataStore.loadMessages.mockRejectedValueOnce(error);
        await app.thoughtManagerService.selectThought(newThoughtId);
        expect(mockAppState.ui.showToast).toHaveBeenCalledWith(expect.stringContaining('Failed to load thought: Test Error'), 'error');
        expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
      });
      it('handles error from fetchHistoricalMessages', async () => {
        mockAppState.nostr.fetchHistoricalMessages.mockRejectedValueOnce(error);
        await app.thoughtManagerService.selectThought(newThoughtId);
        expect(mockAppState.ui.showToast).toHaveBeenCalledWith(expect.stringContaining('Failed to load thought: Test Error'), 'error');
        expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
      });
      it('handles error from saveActiveThoughtId', async () => {
        mockAppState.dataStore.saveActiveThoughtId.mockRejectedValueOnce(error);
        await app.thoughtManagerService.selectThought(newThoughtId);
        expect(mockAppState.ui.showToast).toHaveBeenCalledWith(expect.stringContaining('Failed to load thought: Test Error'), 'error');
        expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
      });
      it('handles error from saveThoughts', async () => {
        thoughtsMock[newThoughtId].unread = 1;
        mockAppState.dataStore._updateMockState({ thoughts: thoughtsMock });
        mockAppState.dataStore.saveThoughts.mockRejectedValueOnce(error);
        await app.thoughtManagerService.selectThought(newThoughtId);
        expect(mockAppState.ui.showToast).toHaveBeenCalledWith(expect.stringContaining('Failed to load thought: Test Error'), 'error');
        expect(mockAppState.ui.setLoading).toHaveBeenLastCalledWith(false);
      });
    });
  });

  // describe('saveIdentity(skInput)', () => { // Commented out: App.saveIdentity doesn't exist; this logic is likely in IdentityService
  // });
});
