import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NoteEditorView } from '../../src/components.js';
// import { Component } from '../../src/ui.js'; // Assuming it extends Component, though not strictly needed for these tests

describe('NoteEditorView', () => {
    let mockApp;
    let mockDataStore;
    let noteThought;
    let view;

    beforeEach(() => {
        noteThought = {
            id: 'note1',
            type: 'note',
            name: 'Test Note',
            body: 'Test body content',
            lastEventTimestamp: 0
        };

        mockDataStore = {
            state: {
                thoughts: {
                    'note1': noteThought
                },
                activeThoughtId: 'note1' // Important for _handleNoteUpdate
            },
            saveThoughts: vi.fn(),
            emitStateUpdated: vi.fn(),
        };
        // mockApp = { dataStore: mockDataStore, handleAction: vi.fn() }; // Original mock
        mockApp = {
            dataStore: mockDataStore,
            handleAction: vi.fn((action, data) => {
                if (action === 'update-note-content') {
                    const thoughtToUpdate = mockDataStore.state.thoughts[data.id];
                    if (thoughtToUpdate) {
                        if (data.field === 'title') {
                            thoughtToUpdate.name = data.value;
                        } else if (data.field === 'body') {
                            thoughtToUpdate.body = data.value;
                        }
                        // Simulate timestamp update if necessary for other tests, not strictly needed here
                        thoughtToUpdate.lastEventTimestamp = Math.floor(Date.now() / 1000);
                        // Simulate the effects of saveThoughts and emitStateUpdated if needed by other assertions
                        mockDataStore.saveThoughts();
                        mockDataStore.emitStateUpdated();
                    }
                }
            })
        };

        view = new NoteEditorView(mockApp, mockDataStore); // Pass both app and dataStore
        document.body.appendChild(view.element);
    });

    afterEach(() => {
        if (view && view.element.parentNode) {
            document.body.removeChild(view.element);
        }
        vi.clearAllMocks();
    });

    it('should render title input and body textarea', () => {
        expect(view.titleInput).not.toBeNull();
        expect(view.titleInput.element.tagName).toBe('INPUT');
        expect(view.titleInput.element.placeholder).toBe('Note Title');

        expect(view.bodyTextarea).not.toBeNull();
        expect(view.bodyTextarea.element.tagName).toBe('TEXTAREA');
        expect(view.bodyTextarea.element.placeholder).toBe('Your note...');
    });

    it('should load note data into inputs when update is called', () => {
        view.update(noteThought);
        expect(view.titleInput.element.value).toBe('Test Note');
        expect(view.bodyTextarea.element.value).toBe('Test body content');
    });

    it('should show the editor when update is called', () => {
        view.show(false); // Start hidden
        view.update(noteThought);
        expect(view.element.style.display).not.toBe('none');
    });

    it('should update thought name and save on title input calling _handleNoteUpdate', () => {
        view.update(noteThought); // Load the thought

        // Simulate user input and direct call to handler
        const newTitle = 'New Awesome Title';
        view.titleInput.element.value = newTitle; // Not strictly necessary as we call handler directly
        view._handleNoteUpdate('title', newTitle);

        expect(noteThought.name).toBe(newTitle);
        expect(noteThought.lastEventTimestamp).toBeGreaterThan(0); // Assuming Utils.now() gives a positive number
        expect(mockDataStore.saveThoughts).toHaveBeenCalledTimes(1);
        expect(mockDataStore.emitStateUpdated).toHaveBeenCalledTimes(1);
    });

    it('should update thought body and save on textarea input calling _handleNoteUpdate', () => {
        view.update(noteThought); // Load the thought

        // Simulate user input and direct call to handler
        const newBody = 'This is the new body of the note.';
        view.bodyTextarea.element.value = newBody; // Not strictly necessary
        view._handleNoteUpdate('body', newBody);

        expect(noteThought.body).toBe(newBody);
        expect(noteThought.lastEventTimestamp).toBeGreaterThan(0);
        expect(mockDataStore.saveThoughts).toHaveBeenCalledTimes(1);
        expect(mockDataStore.emitStateUpdated).toHaveBeenCalledTimes(1);
    });

    it('should not update if thought is not a note or not the active one (edge case for _handleNoteUpdate)', () => {
        // Change active thought to something else or thought type
        mockDataStore.state.activeThoughtId = 'othernote';

        view.update(noteThought); // Thought is loaded for editing initially
        view._handleNoteUpdate('title', 'Attempted Update');

        expect(noteThought.name).toBe('Test Note'); // Should not change
        expect(mockDataStore.saveThoughts).not.toHaveBeenCalled();
        expect(mockDataStore.emitStateUpdated).not.toHaveBeenCalled();

        // Reset for other tests
        mockDataStore.state.activeThoughtId = 'note1';
    });
});
