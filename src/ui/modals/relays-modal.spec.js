import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RelaysModal } from './relays-modal.js';
import { Component, Button } from '../ui.js';
import { Utils } from '../../utils.js'; // Utils is used for escapeHtml

const mockApp = {
    ui: {
        showModal: vi.fn(),
        hideModal: vi.fn(),
        showToast: vi.fn(),
    },
    handleAction: vi.fn(), // Called for removing/adding relays
    dataStore: {
        state: {
            relays: [] // Provide a default empty relays list for ModalService fallback
        }
    }
};

describe('RelaysModal', () => {
    let relaysModal;
    const initialRelays = ['wss://relay1.com', 'wss://relay2.com'];

    beforeEach(() => {
        vi.clearAllMocks();
        // Ensure Utils.escapeHtml is behaving as expected or mock if it causes issues in test environment
        // For now, assume it works as a simple pass-through or basic escaper if not fully DOM-dependent
    });

    it('constructor should set the correct title and relaysList', () => {
        relaysModal = new RelaysModal(mockApp, initialRelays);
        expect(relaysModal.title).toBe('Manage Relays');
        expect(relaysModal.relaysList).toEqual(initialRelays);
    });

    describe('getContent()', () => {
        beforeEach(() => {
            relaysModal = new RelaysModal(mockApp, initialRelays);
        });

        it('should return a Component instance for the main content', () => {
            const content = relaysModal.getContent();
            expect(content).toBeInstanceOf(Component);
        });

        it('should display a list of relays', () => {
            const content = relaysModal.getContent();
            const listItems = content.element.querySelectorAll('.relays-list li');
            expect(listItems.length).toBe(initialRelays.length);
            listItems.forEach((li, index) => {
                expect(li.querySelector('span').textContent).toBe(Utils.escapeHtml(initialRelays[index]));
            });
        });

        it('each relay item should have a "Remove" button that calls app.handleAction', () => {
            const content = relaysModal.getContent();
            const removeButtons = content.element.querySelectorAll('.relays-list li button.danger');
            expect(removeButtons.length).toBe(initialRelays.length);

            removeButtons[0].click();
            expect(mockApp.handleAction).toHaveBeenCalledWith('remove-relay', initialRelays[0]);

            removeButtons[1].click();
            expect(mockApp.handleAction).toHaveBeenCalledWith('remove-relay', initialRelays[1]);
        });

        it('should display an "Add Relay" form', () => {
            const content = relaysModal.getContent();
            const form = content.element.querySelector('form.add-relay-form');
            expect(form).not.toBeNull();
            expect(form.querySelector('input[name="url"]')).not.toBeNull();
            expect(form.querySelector('button[type="submit"]')).not.toBeNull();
        });

        it('"Add Relay" form submission should call app.handleAction and reset the form', () => {
            const content = relaysModal.getContent();
            const form = content.element.querySelector('form.add-relay-form');
            const urlInput = form.querySelector('input[name="url"]');
            const resetSpy = vi.spyOn(form, 'reset');

            urlInput.value = 'wss://newrelay.com';
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

            expect(mockApp.handleAction).toHaveBeenCalledTimes(1);
            expect(mockApp.handleAction.mock.calls[0][0]).toBe('add-relay');
            const formData = mockApp.handleAction.mock.calls[0][1];
            expect(formData.get('url')).toBe('wss://newrelay.com');
            expect(resetSpy).toHaveBeenCalledTimes(1);
        });

        it('should handle empty relays list correctly', () => {
            relaysModal = new RelaysModal(mockApp, []);
            const content = relaysModal.getContent();
            const listItems = content.element.querySelectorAll('.relays-list li');
            expect(listItems.length).toBe(0);
        });
    });

    describe('getFooterButtons()', () => {
        it('should return a single "Close" button', () => {
            relaysModal = new RelaysModal(mockApp, initialRelays);
            const buttons = relaysModal.getFooterButtons();
            expect(buttons.length).toBe(1);
            expect(buttons[0].element.textContent).toBe('Close');
        });

        it('"Close" button should call modal.hide()', () => {
            relaysModal = new RelaysModal(mockApp, initialRelays);
            const hideSpy = vi.spyOn(relaysModal, 'hide');
            const buttons = relaysModal.getFooterButtons();
            buttons[0].element.click();
            expect(hideSpy).toHaveBeenCalledTimes(1);
        });
    });
});
