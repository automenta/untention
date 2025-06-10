// This MUST be at the very top
import { vi } from 'vitest';

// Tell Vitest to use the manual mock for components.js
vi.mock('../../src/components.js');

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Import MainView (will be the original due to the manual mock's re-export)
// Import the MOCKED CONSTRUCTORS for child views from the manual mock.
import {
    MainView,
    MessageListView as MockMessageListViewCtor, // These are vi.fn() constructors from the mock
    NoThoughtSelectedView as MockNoThoughtSelectedViewCtor,
    NoteEditorView as MockNoteEditorViewCtor
} from '../../src/components.js';

// ui.js is NOT mocked, so MainView extends the REAL Component and uses REAL Button.
import { Component, Button } from '../../src/ui.js';


describe('MainView', () => {
    let mockApp;
    let mockDataStore;
    let mainView;
    let mockIdentity;
    let mockThoughts;
    let mockProfiles;

    // These will hold the mock instances returned by the mocked constructors
    let mockNoThoughtSelectedView;
    let mockNoteEditorView;
    let mockMessageListView;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Get the (shared) mock instances by calling the mocked constructors.
        // These constructors are from src/__mocks__/components.js and return predefined instances
        // which have vi.fn() methods as defined in src/__mocks__/components.js.
        mockNoThoughtSelectedView = new MockNoThoughtSelectedViewCtor();
        mockNoteEditorView = new MockNoteEditorViewCtor();
        mockMessageListView = new MockMessageListViewCtor();

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
                thoughts: mockThoughts, profiles: mockProfiles, identity: mockIdentity,
                messages: { note1: [], dm1: [], group1: [], public1: [] },
            },
            on: vi.fn(),
        };
        mockApp = { dataStore: mockDataStore, handleAction: vi.fn() };

        // MainView constructor will use the actual Component/Button classes from ui.js.
        // Child views (noThoughtSelectedView, etc.) are injected using the mock instances obtained above.
        mainView = new MainView(mockApp, {
            noThoughtSelectedView: mockNoThoughtSelectedView,
            noteEditorView: mockNoteEditorView,
            messageListView: mockMessageListView
        });
        document.body.appendChild(mainView.element);

        // Spy on methods of the actual Component instances created within MainView
        // (headerActions, inputForm, headerName are real Components)
        vi.spyOn(mainView.headerActions, 'add');
        vi.spyOn(mainView.inputForm, 'show');
        vi.spyOn(mainView.headerName, 'setContent');

        mainView.update(mockDataStore.state, mockIdentity);
    });

    afterEach(() => {
        if (mainView && mainView.element && mainView.element.parentNode) {
            document.body.removeChild(mainView.element);
        }
        vi.restoreAllMocks();
    });

    it('should initialize and show NoThoughtSelectedView due to null activeThoughtId', () => {
        expect(mockNoThoughtSelectedView.show).toHaveBeenCalledWith(true);
        expect(mockNoteEditorView.show).toHaveBeenCalledWith(false);
        expect(mockMessageListView.show).toHaveBeenCalledWith(false);
        expect(mainView.inputForm.show).toHaveBeenCalledWith(false);
        expect(mainView.inputForm.element.style.display).toBe('none');
    });

    describe('update method', () => {
        it('should show NoThoughtSelectedView if no active thought', () => {
            // Call update once to change state, then again to target state for this test
            mainView.update({ activeThoughtId: 'dm1', thoughts: mockThoughts, profiles: mockProfiles, identity: mockIdentity });
            mockNoThoughtSelectedView.show.mockClear(); // Clear calls from previous update
            mockNoteEditorView.show.mockClear();
            mockMessageListView.show.mockClear();
            mainView.inputForm.show.mockClear();
            mainView.headerName.setContent.mockClear();

            mainView.update({ activeThoughtId: null, thoughts: mockThoughts, profiles: mockProfiles, identity: mockIdentity });

            expect(mockNoThoughtSelectedView.show).toHaveBeenCalledWith(true);
            expect(mockNoteEditorView.show).toHaveBeenCalledWith(false);
            expect(mockMessageListView.show).toHaveBeenCalledWith(false);
            expect(mainView.inputForm.show).toHaveBeenCalledWith(false);
            expect(mainView.inputForm.element.style.display).toBe('none');
            expect(mainView.headerName.setContent).toHaveBeenCalledWith('No Thought Selected');
        });

        it('should show NoteEditorView for "note" type thoughts and hide input form', () => {
            mainView.update({ activeThoughtId: 'note1', thoughts: mockThoughts, profiles: mockProfiles, identity: mockIdentity });
            expect(mockNoteEditorView.show).toHaveBeenCalledWith(true);
            expect(mockNoteEditorView.update).toHaveBeenCalledWith(mockThoughts.note1);
            expect(mockNoThoughtSelectedView.show).toHaveBeenCalledWith(false);
            expect(mockMessageListView.show).toHaveBeenCalledWith(false);
            expect(mainView.inputForm.show).toHaveBeenCalledWith(false);
            expect(mainView.inputForm.element.style.display).toBe('none');
        });

        it('should show MessageListView for "dm" type thoughts and show input form if logged in', () => {
            mainView.update({ activeThoughtId: 'dm1', thoughts: mockThoughts, profiles: mockProfiles, identity: mockIdentity });
            expect(mockMessageListView.show).toHaveBeenCalledWith(true);
            expect(mockMessageListView.update).toHaveBeenCalledWith('dm1');
            expect(mockNoThoughtSelectedView.show).toHaveBeenCalledWith(false);
            expect(mockNoteEditorView.show).toHaveBeenCalledWith(false);
            expect(mainView.inputForm.show).toHaveBeenCalledWith(true);
            expect(mainView.inputForm.element.style.display).toBe('');
        });

        it('should show MessageListView for "group" type thoughts and show input form if logged in', () => {
            mainView.update({ activeThoughtId: 'group1', thoughts: mockThoughts, profiles: mockProfiles, identity: mockIdentity });
            expect(mockMessageListView.show).toHaveBeenCalledWith(true);
            expect(mockMessageListView.update).toHaveBeenCalledWith('group1');
            expect(mainView.inputForm.show).toHaveBeenCalledWith(true);
            expect(mainView.inputForm.element.style.display).toBe('');
        });

        it('should show MessageListView for "public" type thoughts and show input form if logged in', () => {
            mainView.update({ activeThoughtId: 'public1', thoughts: mockThoughts, profiles: mockProfiles, identity: mockIdentity });
            expect(mockMessageListView.show).toHaveBeenCalledWith(true);
            expect(mockMessageListView.update).toHaveBeenCalledWith('public1');
            expect(mainView.inputForm.show).toHaveBeenCalledWith(true);
            expect(mainView.inputForm.element.style.display).toBe('');
        });

        it('should hide input form for "public" type thoughts if not logged in', () => {
            const loggedOutIdentity = { pk: null, sk: null };
            mainView.update({ activeThoughtId: 'public1', thoughts: mockThoughts, profiles: mockProfiles, identity: loggedOutIdentity });
            expect(mockMessageListView.show).toHaveBeenCalledWith(true);
            expect(mockMessageListView.update).toHaveBeenCalledWith('public1');
            expect(mainView.inputForm.show).toHaveBeenCalledWith(false);
            expect(mainView.inputForm.element.style.display).toBe('none');
        });
    });

    describe('renderHeader method', () => {
        it('should set header name for a DM thought', () => {
            mainView.renderHeader(mockThoughts.dm1, mockProfiles);
            expect(mainView.headerName.setContent).toHaveBeenCalledWith(expect.stringContaining('User Two'));
        });

        it('should set header name for a group thought', () => {
            mainView.renderHeader(mockThoughts.group1, mockProfiles);
            expect(mainView.headerName.setContent).toHaveBeenCalledWith(expect.stringContaining('Test Group'));
        });

        it('should add Info and Leave buttons for group thought', async () => {
            mainView.renderHeader(mockThoughts.group1, mockProfiles);
            expect(mainView.headerActions.add).toHaveBeenCalledTimes(1);
            const addedArguments = mainView.headerActions.add.mock.calls[0][0];
            expect(addedArguments.length).toBe(2);
            expect(addedArguments[0].element.textContent).toBe('Info');
            expect(addedArguments[1].element.textContent).toBe('Leave');
        });

        it('should add Hide button for DM thought', async () => {
            mainView.renderHeader(mockThoughts.dm1, mockProfiles);
            expect(mainView.headerActions.add).toHaveBeenCalledTimes(1);
            const addedArgument = mainView.headerActions.add.mock.calls[0][0];
            expect(addedArgument.element.textContent).toBe('Hide');
        });
    });

    describe('sendMessage method', () => {
        it('should call app.handleAction with "send-message" and content', () => {
            mainView.input.element.value = 'Hello World  ';
            mainView.sendMessage();
            expect(mockApp.handleAction).toHaveBeenCalledWith('send-message', 'Hello World');
            expect(mainView.input.element.value).toBe('');
        });

        it('should not call app.handleAction if content is empty', () => {
            mainView.input.element.value = '   ';
            mainView.sendMessage();
            expect(mockApp.handleAction).not.toHaveBeenCalled();
        });
    });

    it('should register for state:updated on construction', () => {
        expect(mockApp.dataStore.on).toHaveBeenCalledWith('state:updated', expect.any(Function));
    });
});
