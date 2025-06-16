import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GroupInfoModal } from './group-info-modal.js';
import { Component, Button } from '/ui/ui.js';

const mockApp = {
    ui: {
        showModal: vi.fn(),
        hideModal: vi.fn(),
        showToast: vi.fn(),
    },
    // No specific app actions are called by GroupInfoModal itself, only by BaseModal's hide.
    dataStore: { state: {} }
};

describe('GroupInfoModal', () => {
    let groupInfoModal;
    const mockGroupData = {
        name: 'Test Group',
        id: 'group123',
        secretKey: 'secretXYZ'
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('constructor should set the correct title and groupData', () => {
        groupInfoModal = new GroupInfoModal(mockApp, mockGroupData);
        expect(groupInfoModal.title).toBe('Group Info');
        expect(groupInfoModal.groupData).toEqual(mockGroupData);
    });

    describe('getContent()', () => {
        it('should return a Component instance', () => {
            groupInfoModal = new GroupInfoModal(mockApp, mockGroupData);
            const content = groupInfoModal.getContent();
            expect(content).toBeInstanceOf(Component);
        });

        it('should display group name, id, and secret key as read-only inputs', () => {
            groupInfoModal = new GroupInfoModal(mockApp, mockGroupData);
            const content = groupInfoModal.getContent();
            const form = content.element.querySelector('form'); // Content is a div wrapping a form
            expect(form).not.toBeNull();

            const nameInput = form.querySelector('input[name="name"]');
            const idInput = form.querySelector('input[name="id"]');
            const keyInput = form.querySelector('input[name="key"]');

            expect(nameInput).not.toBeNull();
            expect(nameInput.value).toBe(mockGroupData.name);
            expect(nameInput.readOnly).toBe(true);

            expect(idInput).not.toBeNull();
            expect(idInput.value).toBe(mockGroupData.id);
            expect(idInput.readOnly).toBe(true);

            expect(keyInput).not.toBeNull();
            expect(keyInput.value).toBe(mockGroupData.secretKey);
            expect(keyInput.readOnly).toBe(true);
        });

        it('should display "not available" message if groupData is missing or incomplete', () => {
            groupInfoModal = new GroupInfoModal(mockApp, null); // No group data
            let content = groupInfoModal.getContent();
            expect(content.element.querySelector('p').textContent).toBe('Group data is not available.');

            // Re-initialize _contentComponent to null by creating new instance or manually setting
            groupInfoModal = new GroupInfoModal(mockApp, { name: 'Only Name'}); // Incomplete data
            content = groupInfoModal.getContent();
            expect(content.element.querySelector('p').textContent).toBe('Group data is not available.');
        });
    });

    describe('getFooterButtons()', () => {
        it('should return a single "Close" button', () => {
            groupInfoModal = new GroupInfoModal(mockApp, mockGroupData);
            const buttons = groupInfoModal.getFooterButtons();
            expect(buttons.length).toBe(1);
            expect(buttons[0].element.textContent).toBe('Close');
        });

        it('"Close" button should call modal.hide()', () => {
            groupInfoModal = new GroupInfoModal(mockApp, mockGroupData);
            const hideSpy = vi.spyOn(groupInfoModal, 'hide');
            const buttons = groupInfoModal.getFooterButtons();
            const closeButton = buttons[0];

            closeButton.element.click(); // Simulate click
            expect(hideSpy).toHaveBeenCalledTimes(1);
        });
    });
});
