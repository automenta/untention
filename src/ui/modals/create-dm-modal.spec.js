import {beforeEach, describe, expect, it, vi} from 'vitest';
import {CreateDmModal} from './create-dm-modal.js';
import {Component} from '@/ui.js';

const mockApp = {
    ui: {
        showModal: vi.fn(),
        hideModal: vi.fn(),
        showToast: vi.fn(), // Used for validation
    },
    handleAction: vi.fn(), // Called on form submit
    dataStore: { state: {} }
};

describe('CreateDmModal', () => {
    let createDmModal;

    beforeEach(() => {
        vi.clearAllMocks();
        createDmModal = new CreateDmModal(mockApp);
        createDmModal.getContent(); // Initialize form
    });

    it('constructor should set the correct title', () => {
        expect(createDmModal.title).toBe('New Direct Message');
    });

    describe('getContent()', () => {
        it('should return a Component instance (form)', () => {
            const content = createDmModal.getContent();
            expect(content).toBeInstanceOf(Component);
            expect(content.element.tagName).toBe('FORM');
        });

        it('form should contain an input for pubkey', () => {
            const content = createDmModal.getContent();
            const input = content.element.querySelector('input[name="pubkey"]');
            expect(input).not.toBeNull();
            expect(input.placeholder).toBe('npub... or hex...');
            expect(input.required).toBe(true);
            // The message input is now a div for Quill, not a textarea
            const messageEditorDiv = content.element.querySelector('#message-editor');
            expect(messageEditorDiv).not.toBeNull();
        });

        it('form submission should call app.handleAction with "create-dm" and form data including Quill content', () => {
            const form = createDmModal._formComponent.element;
            form.querySelector('input[name="pubkey"]').value = 'npub1testkey';

            // Mock Quill editor behavior
            if (createDmModal._quillEditor) {
                vi.spyOn(createDmModal._quillEditor, 'getText').mockReturnValue({ trim: () => 'Some message content' });
                vi.spyOn(createDmModal._quillEditor.root, 'innerHTML', 'get').mockReturnValue('<p>Some message content</p>');
            } else {
                // Fallback mock if Quill wasn't initialized as expected
                createDmModal._quillEditor = {
                    getText: vi.fn().mockReturnValue({ trim: () => 'Some message content' }),
                    root: { innerHTML: '<p>Some message content</p>' },
                    focus: vi.fn()
                };
            }

            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(submitEvent);

            expect(mockApp.handleAction).toHaveBeenCalledTimes(1);
            expect(mockApp.handleAction.mock.calls[0][0]).toBe('create-dm');
            const formData = mockApp.handleAction.mock.calls[0][1];
            expect(formData).toBeInstanceOf(FormData);
            expect(formData.get('pubkey')).toBe('npub1testkey');
            expect(formData.get('message')).toBe('<p>Some message content</p>'); // Check for Quill's HTML content
        });
    });

    describe('getFooterButtons()', () => {
        it('should return "Cancel" and "Start DM" buttons', () => {
            const buttons = createDmModal.getFooterButtons();
            expect(buttons.length).toBe(2);
            expect(buttons[0].element.textContent).toBe('Cancel');
            expect(buttons[1].element.textContent).toBe('Start DM');
        });

        it('"Cancel" button should call modal.hide()', () => {
            const hideSpy = vi.spyOn(createDmModal, 'hide');
            const buttons = createDmModal.getFooterButtons();
            const cancelButton = buttons.find(b => b.element.textContent === 'Cancel');
            cancelButton.element.click();
            expect(hideSpy).toHaveBeenCalledTimes(1);
        });

        describe('"Start DM" button click', () => {
            let formElement;
            let requestSubmitSpy;
            let startDmButton;
            let pubkeyInput;

            beforeEach(() => {
                formElement = createDmModal._formComponent.element;
                requestSubmitSpy = vi.spyOn(formElement, 'requestSubmit');
                const buttons = createDmModal.getFooterButtons();
                startDmButton = buttons.find(b => b.element.textContent === 'Start DM');
                pubkeyInput = formElement.querySelector('input[name="pubkey"]');

                // Ensure _quillEditor is mocked for each test in this block
                if (createDmModal._quillEditor) {
                    // If already initialized by getContent in outer beforeEach, just spy on it
                    vi.spyOn(createDmModal._quillEditor, 'getText').mockReturnValue({ trim: () => 'Some message content' });
                    vi.spyOn(createDmModal._quillEditor, 'focus'); // Ensure focus is a spy
                    if (!createDmModal._quillEditor.root) { // Ensure root exists for innerHTML mocking if needed
                         createDmModal._quillEditor.root = { innerHTML: '<p>Some message content</p>' };
                    }
                    // If innerHTML is accessed directly on root, spy on its getter if not already done
                    // For this test block, primarily getText and focus are important for validation.
                } else {
                     // Fallback mock if Quill wasn't initialized as expected
                    createDmModal._quillEditor = {
                        getText: vi.fn().mockReturnValue({ trim: () => 'Some message content' }),
                        root: { innerHTML: '<p>Some message content</p>' },
                        focus: vi.fn()
                    };
                }
            });

            it('should trigger form submission if pubkey and message are provided', () => {
                pubkeyInput.value = 'npub1testkey';
                // Ensure Quill mock returns non-empty content
                createDmModal._quillEditor.getText.mockReturnValue({ trim: () => 'Some message content' });
                startDmButton.element.click();
                expect(requestSubmitSpy).toHaveBeenCalledTimes(1);
                expect(mockApp.ui.showToast).not.toHaveBeenCalled();
            });

            it('should show toast and not submit if pubkey is empty', () => {
                pubkeyInput.value = '';
                // Message content can be valid here, the focus is on pubkey
                createDmModal._quillEditor.getText.mockReturnValue({ trim: () => 'Some message content' });
                startDmButton.element.click();
                expect(requestSubmitSpy).not.toHaveBeenCalled();
                expect(mockApp.ui.showToast).toHaveBeenCalledWith("Recipient's Public Key is required.", 'error');
            });

            it('should show toast and not submit if message content is empty', () => {
                pubkeyInput.value = 'npub1testkey';
                // Mock Quill to return empty content
                createDmModal._quillEditor.getText.mockReturnValue({ trim: () => '' });
                startDmButton.element.click();
                expect(requestSubmitSpy).not.toHaveBeenCalled();
                expect(mockApp.ui.showToast).toHaveBeenCalledWith("Message content cannot be empty.", 'error');
                expect(createDmModal._quillEditor.focus).toHaveBeenCalled();
            });
        });
    });
});
