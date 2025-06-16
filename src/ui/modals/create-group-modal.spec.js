import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateGroupModal } from './create-group-modal.js';
import { Component, Button } from '/ui.js';

const mockApp = {
    ui: {
        showModal: vi.fn(),
        hideModal: vi.fn(),
        showToast: vi.fn(), // Used for validation message
    },
    handleAction: vi.fn(), // Called on form submit
    dataStore: { state: {} }
};

describe('CreateGroupModal', () => {
    let createGroupModal;

    beforeEach(() => {
        vi.clearAllMocks();
        createGroupModal = new CreateGroupModal(mockApp);
        createGroupModal.getContent(); // Initialize form
    });

    it('constructor should set the correct title', () => {
        expect(createGroupModal.title).toBe('Create Group');
    });

    describe('getContent()', () => {
        it('should return a Component instance (form)', () => {
            const content = createGroupModal.getContent();
            expect(content).toBeInstanceOf(Component);
            expect(content.element.tagName).toBe('FORM');
        });

        it('form should contain an input for group name', () => {
            const content = createGroupModal.getContent();
            const input = content.element.querySelector('input[name="name"]');
            expect(input).not.toBeNull();
            expect(input.placeholder).toBe('Enter group name');
            expect(input.required).toBe(true);
        });

        it('form submission should call app.handleAction with "create-group" and form data', () => {
            const form = createGroupModal._formComponent.element;
            form.querySelector('input[name="name"]').value = 'Test Group';

            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(submitEvent);

            expect(mockApp.handleAction).toHaveBeenCalledTimes(1);
            expect(mockApp.handleAction.mock.calls[0][0]).toBe('create-group');
            const formData = mockApp.handleAction.mock.calls[0][1];
            expect(formData).toBeInstanceOf(FormData);
            expect(formData.get('name')).toBe('Test Group');
        });
    });

    describe('getFooterButtons()', () => {
        it('should return "Cancel" and "Create" buttons', () => {
            const buttons = createGroupModal.getFooterButtons();
            expect(buttons.length).toBe(2);
            expect(buttons[0].element.textContent).toBe('Cancel');
            expect(buttons[1].element.textContent).toBe('Create');
        });

        it('"Cancel" button should call modal.hide()', () => {
            const hideSpy = vi.spyOn(createGroupModal, 'hide');
            const buttons = createGroupModal.getFooterButtons();
            const cancelButton = buttons.find(b => b.element.textContent === 'Cancel');
            cancelButton.element.click();
            expect(hideSpy).toHaveBeenCalledTimes(1);
        });

        describe('"Create" button click', () => {
            let formElement;
            let requestSubmitSpy;
            let createButton;

            beforeEach(() => {
                formElement = createGroupModal._formComponent.element;
                requestSubmitSpy = vi.spyOn(formElement, 'requestSubmit');
                const buttons = createGroupModal.getFooterButtons();
                createButton = buttons.find(b => b.element.textContent === 'Create');
            });

            it('should trigger form submission if name is provided', () => {
                formElement.querySelector('input[name="name"]').value = 'Valid Group Name';
                createButton.element.click();
                expect(requestSubmitSpy).toHaveBeenCalledTimes(1);
                expect(mockApp.ui.showToast).not.toHaveBeenCalled();
            });

            it('should show toast and not submit if name is empty', () => {
                formElement.querySelector('input[name="name"]').value = '';
                createButton.element.click();
                expect(requestSubmitSpy).not.toHaveBeenCalled();
                expect(mockApp.ui.showToast).toHaveBeenCalledWith('Group name is required.', 'error');
            });

            it('should show toast and not submit if name is only whitespace', () => {
                formElement.querySelector('input[name="name"]').value = '   ';
                createButton.element.click();
                expect(requestSubmitSpy).not.toHaveBeenCalled();
                expect(mockApp.ui.showToast).toHaveBeenCalledWith('Group name is required.', 'error');
            });
        });
    });
});
