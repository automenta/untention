import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateDmModal } from './create-dm-modal.js';
import { Component, Button } from '../ui.js';

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
        });

        it('form submission should call app.handleAction with "create-dm" and form data', () => {
            const form = createDmModal._formComponent.element;
            form.querySelector('input[name="pubkey"]').value = 'npub1testkey';

            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(submitEvent);

            expect(mockApp.handleAction).toHaveBeenCalledTimes(1);
            expect(mockApp.handleAction.mock.calls[0][0]).toBe('create-dm');
            const formData = mockApp.handleAction.mock.calls[0][1];
            expect(formData).toBeInstanceOf(FormData);
            expect(formData.get('pubkey')).toBe('npub1testkey');
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
            });

            it('should trigger form submission if pubkey is provided', () => {
                pubkeyInput.value = 'npub1testkey';
                startDmButton.element.click();
                expect(requestSubmitSpy).toHaveBeenCalledTimes(1);
                expect(mockApp.ui.showToast).not.toHaveBeenCalled();
            });

            it('should show toast and not submit if pubkey is empty', () => {
                pubkeyInput.value = '';
                startDmButton.element.click();
                expect(requestSubmitSpy).not.toHaveBeenCalled();
                expect(mockApp.ui.showToast).toHaveBeenCalledWith("Recipient's Public Key is required.", 'error');
            });
        });
    });
});
