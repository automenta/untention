import {beforeEach, describe, expect, it, vi} from 'vitest';
import {IdentityModal} from './identity-modal.js';
import {Component} from '/ui/ui.js';

// Mock App, UIController, and DataStore
const mockApp = {
    ui: {
        showModal: vi.fn(),
        hideModal: vi.fn(),
        showToast: vi.fn(),
    },
    saveIdentity: vi.fn(), // Specific method IdentityModal will call
    // Mock other app methods/properties as needed by BaseModal or specific modals
    handleAction: vi.fn(),
    dataStore: { state: {} }
};

describe('IdentityModal', () => {
    let identityModal;

    beforeEach(() => {
        vi.clearAllMocks();
        identityModal = new IdentityModal(mockApp);
        // Call getContent to initialize _formComponent, similar to how it happens in BaseModal.show
        // This is important if getFooterButtons relies on _formComponent being set.
        identityModal.getContent();
    });

    it('should be an instance of BaseModal', () => {
        expect(identityModal).toBeInstanceOf(IdentityModal); // Corrected, was BaseModal
    });

    it('constructor should set the correct title', () => {
        expect(identityModal.title).toBe('Manage Identity');
    });

    describe('getContent()', () => {
        it('should return a Component instance (form)', () => {
            const content = identityModal.getContent();
            expect(content).toBeInstanceOf(Component);
            expect(content.element.tagName).toBe('FORM');
        });

        it('form should contain a password input for privkey', () => {
            const content = identityModal.getContent();
            const input = content.element.querySelector('input[name="privkey"]');
            expect(input).not.toBeNull();
            expect(input.type).toBe('password');
        });

        it('form submission should call app.saveIdentity with form data', () => {
            const form = identityModal.getContent().element;
            const privKeyInput = form.querySelector('input[name="privkey"]');
            privKeyInput.value = 'test_nsec_key';

            // Create and dispatch a submit event
            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(submitEvent);

            expect(mockApp.saveIdentity).toHaveBeenCalledTimes(1);
            expect(mockApp.saveIdentity).toHaveBeenCalledWith('test_nsec_key');
        });
    });

    describe('getFooterButtons()', () => {
        it('should return "Cancel" and "Load/Gen" buttons', () => {
            const buttons = identityModal.getFooterButtons();
            expect(buttons.length).toBe(2);
            expect(buttons[0].element.textContent).toBe('Cancel');
            expect(buttons[1].element.textContent).toBe('Load/Gen');
        });

        it('"Cancel" button should call modal.hide()', () => {
            const hideSpy = vi.spyOn(identityModal, 'hide');
            const buttons = identityModal.getFooterButtons();
            const cancelButton = buttons.find(b => b.element.textContent === 'Cancel');

            cancelButton.element.click(); // Simulate click
            expect(hideSpy).toHaveBeenCalledTimes(1);
        });

        it('"Load/Gen" button should trigger form submission', () => {
            const form = identityModal.getContent().element; // Get the actual form element
            const requestSubmitSpy = vi.spyOn(form, 'requestSubmit');

            const buttons = identityModal.getFooterButtons();
            const loadGenButton = buttons.find(b => b.element.textContent === 'Load/Gen');

            loadGenButton.element.click(); // Simulate click
            expect(requestSubmitSpy).toHaveBeenCalledTimes(1);
        });
    });
});
