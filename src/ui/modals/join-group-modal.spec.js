import {beforeEach, describe, expect, it, vi} from 'vitest';
import {JoinGroupModal} from './join-group-modal.js';
import {Component} from '/ui/ui.js';

const mockApp = {
    ui: {
        showModal: vi.fn(),
        hideModal: vi.fn(),
        showToast: vi.fn(), // Used for validation messages
    },
    handleAction: vi.fn(), // Called on form submit
    dataStore: { state: {} }
};

describe('JoinGroupModal', () => {
    let joinGroupModal;

    beforeEach(() => {
        vi.clearAllMocks();
        joinGroupModal = new JoinGroupModal(mockApp);
        joinGroupModal.getContent(); // Initialize form
    });

    it('constructor should set the correct title', () => {
        expect(joinGroupModal.title).toBe('Join Group');
    });

    describe('getContent()', () => {
        it('should return a Component instance (form)', () => {
            const content = joinGroupModal.getContent();
            expect(content).toBeInstanceOf(Component);
            expect(content.element.tagName).toBe('FORM');
        });

        it('form should contain inputs for id, key, and name', () => {
            const content = joinGroupModal.getContent();
            expect(content.element.querySelector('input[name="id"]')).not.toBeNull();
            expect(content.element.querySelector('input[name="key"]')).not.toBeNull();
            expect(content.element.querySelector('input[name="name"]')).not.toBeNull(); // Optional name
        });

        it('form submission should call app.handleAction with "join-group" and form data', () => {
            const form = joinGroupModal._formComponent.element;
            form.querySelector('input[name="id"]').value = 'group_id_123';
            form.querySelector('input[name="key"]').value = 'secret_key_abc';
            form.querySelector('input[name="name"]').value = 'Optional Group Name';

            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(submitEvent);

            expect(mockApp.handleAction).toHaveBeenCalledTimes(1);
            expect(mockApp.handleAction.mock.calls[0][0]).toBe('join-group');
            const formData = mockApp.handleAction.mock.calls[0][1];
            expect(formData).toBeInstanceOf(FormData);
            expect(formData.get('id')).toBe('group_id_123');
            expect(formData.get('key')).toBe('secret_key_abc');
            expect(formData.get('name')).toBe('Optional Group Name');
        });
    });

    describe('getFooterButtons()', () => {
        it('should return "Cancel" and "Join" buttons', () => {
            const buttons = joinGroupModal.getFooterButtons();
            expect(buttons.length).toBe(2);
            expect(buttons[0].element.textContent).toBe('Cancel');
            expect(buttons[1].element.textContent).toBe('Join');
        });

        it('"Cancel" button should call modal.hide()', () => {
            const hideSpy = vi.spyOn(joinGroupModal, 'hide');
            const buttons = joinGroupModal.getFooterButtons();
            const cancelButton = buttons.find(b => b.element.textContent === 'Cancel');
            cancelButton.element.click();
            expect(hideSpy).toHaveBeenCalledTimes(1);
        });

        describe('"Join" button click', () => {
            let formElement;
            let requestSubmitSpy;
            let joinButton;
            let idInput, keyInput;

            beforeEach(() => {
                formElement = joinGroupModal._formComponent.element;
                requestSubmitSpy = vi.spyOn(formElement, 'requestSubmit');
                const buttons = joinGroupModal.getFooterButtons();
                joinButton = buttons.find(b => b.element.textContent === 'Join');
                idInput = formElement.querySelector('input[name="id"]');
                keyInput = formElement.querySelector('input[name="key"]');
            });

            it('should trigger form submission if id and key are provided', () => {
                idInput.value = 'group_id_123';
                keyInput.value = 'secret_key_abc';
                joinButton.element.click();
                expect(requestSubmitSpy).toHaveBeenCalledTimes(1);
                expect(mockApp.ui.showToast).not.toHaveBeenCalled();
            });

            it('should show toast and not submit if id is empty', () => {
                idInput.value = '';
                keyInput.value = 'secret_key_abc';
                joinButton.element.click();
                expect(requestSubmitSpy).not.toHaveBeenCalled();
                expect(mockApp.ui.showToast).toHaveBeenCalledWith('Group ID is required.', 'error');
            });

            it('should show toast and not submit if key is empty', () => {
                idInput.value = 'group_id_123';
                keyInput.value = '';
                joinButton.element.click();
                expect(requestSubmitSpy).not.toHaveBeenCalled();
                expect(mockApp.ui.showToast).toHaveBeenCalledWith('Secret Key is required.', 'error');
            });
        });
    });
});
