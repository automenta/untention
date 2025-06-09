import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MainView, NoThoughtSelectedView, NoteEditorView, MessageListView } from '../../src/components.js';
import { Component, Button } from '../../src/ui.js'; // Button is used in renderHeader

// Mock sub-components
vi.mock('../../src/components.js', async (importOriginal) => {
    const original = await importOriginal();
    return {
        ...original,
        NoThoughtSelectedView: vi.fn(() => ({
            element: document.createElement('div'),
            show: vi.fn(),
            update: vi.fn(), // if it had one
        })),
        NoteEditorView: vi.fn(() => ({
            element: document.createElement('div'),
            show: vi.fn(),
            update: vi.fn(),
        })),
        MessageListView: vi.fn(() => ({
            element: document.createElement('div'),
            show: vi.fn(),
            update: vi.fn(),
        })),
    };
});

// Mock Button for renderHeader testing
vi.mock('../../src/ui.js', async (importOriginal) => {
    const original = await importOriginal();
    return {
        ...original,
        Button: vi.fn((options) => {
            const btn = new original.Button(options); // Use original for basic element creation
            vi.spyOn(btn, 'setContent');
            vi.spyOn(btn, 'setEnabled');
            // Mock other methods if needed by MainView's renderHeader
            return btn;
        }),
    };
});


describe('MainView', () => {
    let mockApp;
    let mockDataStore;
    let mainView;
    let mockIdentity;
    let mockThoughts;
    let mockProfiles;

    beforeEach(() => {
        // Clear mocks before each test
        vi.clearAllMocks();

        // Re-import with mocks for MainView instance
        // This is a bit tricky with module-level mocks. Usually, you'd ensure mocks are set up before any import.
        // For this test, we'll rely on Vitest's hoisting or ensure MainView is instantiated after mocks are active.

        mockIdentity = { pk: 'user1', sk: 'sk1' };
        mockThoughts = {
            note1: { id: 'note1', type: 'note', name: 'My Note', body: 'Note body' },
            dm1: { id: 'dm1', type: 'dm', name: 'DM with User2', pubkey: 'user2' },
            group1: { id: 'group1', type: 'group', name: 'Test Group' },
            public1: { id: 'public1', type: 'public', name: 'Public Feed' },
        };
        mockProfiles = { user2: { name: 'User Two' } };

        mockDataStore = {
            state: {
                activeThoughtId: null,
                thoughts: mockThoughts,
                profiles: mockProfiles,
                identity: mockIdentity,
            },
            on: vi.fn(), // For 'state:updated'
            // No direct calls to saveThoughts or emitStateUpdated from MainView itself
        };
        mockApp = {
            dataStore: mockDataStore,
            handleAction: vi.fn(),
        };

        // Instantiate MainView AFTER mocks are in place due to vi.mock
        mainView = new MainView(mockApp);
        document.body.appendChild(mainView.element);

        // Link mocked instances to the properties on mainView for easier assertion
        // This assumes MainView constructor assigns them.
        // If MainView constructor is called before mocks are fully effective, this might not pick them up.
        // However, vi.mock should ensure these constructors return mocked instances.
        mainView.noThoughtSelectedView = new NoThoughtSelectedView();
        mainView.noteEditorView = new NoteEditorView(mockApp, mockDataStore);
        mainView.messageListView = new MessageListView(mockApp, mockDataStore);
    });

    afterEach(() => {
        if (mainView && mainView.element.parentNode) {
            document.body.removeChild(mainView.element);
        }
    });

    it('should initialize with sub-components hidden and inputForm hidden', () => {
        expect(mainView.noThoughtSelectedView.show).toHaveBeenCalledWith(false);
        expect(mainView.noteEditorView.show).toHaveBeenCalledWith(false);
        expect(mainView.messageListView.show).toHaveBeenCalledWith(false);
        expect(mainView.inputForm.element.style.display).toBe('none');
    });

    describe('update method', () => {
        it('should show NoThoughtSelectedView if no active thought', () => {
            mainView.update({ activeThoughtId: null, thoughts: mockThoughts, profiles: mockProfiles, identity: mockIdentity });
            expect(mainView.noThoughtSelectedView.show).toHaveBeenCalledWith(true);
            expect(mainView.noteEditorView.show).toHaveBeenCalledWith(false);
            expect(mainView.messageListView.show).toHaveBeenCalledWith(false);
            expect(mainView.inputForm.element.style.display).toBe('none');
            expect(mainView.headerName.element.textContent).toBe('No Thought Selected');
        });

        it('should show NoteEditorView for "note" type thoughts and hide input form', () => {
            mainView.update({ activeThoughtId: 'note1', thoughts: mockThoughts, profiles: mockProfiles, identity: mockIdentity });
            expect(mainView.noteEditorView.show).toHaveBeenCalledWith(true);
            expect(mainView.noteEditorView.update).toHaveBeenCalledWith(mockThoughts.note1);
            expect(mainView.noThoughtSelectedView.show).toHaveBeenCalledWith(false);
            expect(mainView.messageListView.show).toHaveBeenCalledWith(false);
            expect(mainView.inputForm.element.style.display).toBe('none'); // Input form hidden for notes
        });

        it('should show MessageListView for "dm" type thoughts and show input form if logged in', () => {
            mainView.update({ activeThoughtId: 'dm1', thoughts: mockThoughts, profiles: mockProfiles, identity: mockIdentity });
            expect(mainView.messageListView.show).toHaveBeenCalledWith(true);
            expect(mainView.messageListView.update).toHaveBeenCalledWith('dm1');
            expect(mainView.noThoughtSelectedView.show).toHaveBeenCalledWith(false);
            expect(mainView.noteEditorView.show).toHaveBeenCalledWith(false);
            expect(mainView.inputForm.element.style.display).not.toBe('none'); // Input form shown for DMs
        });

        it('should show MessageListView for "group" type thoughts and show input form if logged in', () => {
            mainView.update({ activeThoughtId: 'group1', thoughts: mockThoughts, profiles: mockProfiles, identity: mockIdentity });
            expect(mainView.messageListView.show).toHaveBeenCalledWith(true);
            expect(mainView.messageListView.update).toHaveBeenCalledWith('group1');
            expect(mainView.inputForm.element.style.display).not.toBe('none');
        });

        it('should show MessageListView for "public" type thoughts and show input form if logged in', () => {
            mainView.update({ activeThoughtId: 'public1', thoughts: mockThoughts, profiles: mockProfiles, identity: mockIdentity });
            expect(mainView.messageListView.show).toHaveBeenCalledWith(true);
            expect(mainView.messageListView.update).toHaveBeenCalledWith('public1');
            expect(mainView.inputForm.element.style.display).not.toBe('none'); // Shown if logged in
        });

        it('should hide input form for "public" type thoughts if not logged in', () => {
            const loggedOutIdentity = { pk: null, sk: null };
            mainView.update({ activeThoughtId: 'public1', thoughts: mockThoughts, profiles: mockProfiles, identity: loggedOutIdentity });
            expect(mainView.messageListView.show).toHaveBeenCalledWith(true);
            expect(mainView.messageListView.update).toHaveBeenCalledWith('public1');
            expect(mainView.inputForm.element.style.display).toBe('none'); // Hidden if not logged in
        });
    });

    describe('renderHeader method', () => {
        it('should set header name for a DM thought', () => {
            mainView.renderHeader(mockThoughts.dm1, mockProfiles);
            expect(mainView.headerName.element.textContent).toBe('User Two'); // DM name from profile
        });

        it('should set header name for a group thought', () => {
            mainView.renderHeader(mockThoughts.group1, mockProfiles);
            expect(mainView.headerName.element.textContent).toBe('Test Group');
        });

        it('should add Info and Leave buttons for group thought', () => {
            mainView.renderHeader(mockThoughts.group1, mockProfiles);
            // Button mock is tricky; check if add was called on headerActions
            expect(mainView.headerActions.element.children.length).toBe(2);
            // Could also check button textContent if Button mock allows or by inspecting element
        });

        it('should add Hide button for DM thought', () => {
            mainView.renderHeader(mockThoughts.dm1, mockProfiles);
            expect(mainView.headerActions.element.children.length).toBe(1);
        });
    });

    describe('sendMessage method', () => {
        it('should call app.handleAction with "send-message" and content', () => {
            mainView.input.element.value = 'Hello World  '; // With trailing spaces
            mainView.sendMessage();
            expect(mockApp.handleAction).toHaveBeenCalledWith('send-message', 'Hello World');
            expect(mainView.input.element.value).toBe(''); // Input cleared
        });

        it('should not call app.handleAction if content is empty', () => {
            mainView.input.element.value = '   '; // Only spaces
            mainView.sendMessage();
            expect(mockApp.handleAction).not.toHaveBeenCalled();
        });
    });

    it('should register for state:updated on construction', () => {
        expect(mockApp.dataStore.on).toHaveBeenCalledWith('state:updated', expect.any(Function));
    });
});
