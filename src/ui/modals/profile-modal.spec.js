import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileModal } from './profile-modal.js';
import { Component, Button } from '../ui.js';

const mockApp = {
    ui: {
        showModal: vi.fn(),
        hideModal: vi.fn(),
        showToast: vi.fn(),
    },
    handleAction: vi.fn(), // ProfileModal calls this on form submit
    dataStore: { state: {} }
};

describe('ProfileModal', () => {
    let profileModal;
    const initialProfileData = {
        name: 'Test User',
        picture: 'https://example.com/pic.jpg',
        nip05: 'user@example.com'
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('constructor should set the correct title and profileData', () => {
        profileModal = new ProfileModal(mockApp, initialProfileData);
        expect(profileModal.title).toBe('Edit Profile');
        expect(profileModal.profileData).toEqual(initialProfileData);
        profileModal.getContent(); // Initialize form
    });

    it('constructor should use empty object for profileData if not provided', () => {
        profileModal = new ProfileModal(mockApp);
        expect(profileModal.profileData).toEqual({});
        profileModal.getContent(); // Initialize form
    });

    describe('getContent()', () => {
        beforeEach(() => { // Ensure modal is new for each getContent test context
            profileModal = new ProfileModal(mockApp, initialProfileData);
        });

        it('should return a Component instance (form)', () => {
            const content = profileModal.getContent();
            expect(content).toBeInstanceOf(Component);
            expect(content.element.tagName).toBe('FORM');
        });

        it('form should contain inputs for name, picture, and nip05', () => {
            const content = profileModal.getContent();
            expect(content.element.querySelector('input[name="name"]')).not.toBeNull();
            expect(content.element.querySelector('input[name="picture"]')).not.toBeNull();
            expect(content.element.querySelector('input[name="nip05"]')).not.toBeNull();
        });

        it('form inputs should be pre-filled with profileData', () => {
            const content = profileModal.getContent();
            expect(content.element.querySelector('input[name="name"]').value).toBe(initialProfileData.name);
            expect(content.element.querySelector('input[name="picture"]').value).toBe(initialProfileData.picture);
            expect(content.element.querySelector('input[name="nip05"]').value).toBe(initialProfileData.nip05);
        });

        it('form inputs should be empty if no profileData provided', () => {
            profileModal = new ProfileModal(mockApp); // No initial data
            const content = profileModal.getContent();
            expect(content.element.querySelector('input[name="name"]').value).toBe('');
            expect(content.element.querySelector('input[name="picture"]').value).toBe('');
            expect(content.element.querySelector('input[name="nip05"]').value).toBe('');
        });

        it('form submission should call app.handleAction with "update-profile" and form data', () => {
            // Ensure form is created
            profileModal.getContent();
            const form = profileModal._formComponent.element;

            // Modify some data to simulate user input
            form.querySelector('input[name="name"]').value = 'Updated Name';

            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(submitEvent);

            expect(mockApp.handleAction).toHaveBeenCalledTimes(1);
            expect(mockApp.handleAction.mock.calls[0][0]).toBe('update-profile');
            const formData = mockApp.handleAction.mock.calls[0][1];
            expect(formData).toBeInstanceOf(FormData);
            expect(formData.get('name')).toBe('Updated Name');
            expect(formData.get('picture')).toBe(initialProfileData.picture); // Unchanged
        });
    });

    describe('getFooterButtons()', () => {
        beforeEach(() => {
            profileModal = new ProfileModal(mockApp, initialProfileData);
            profileModal.getContent(); // Ensure _formComponent is initialized
        });

        it('should return "Cancel" and "Save" buttons', () => {
            const buttons = profileModal.getFooterButtons();
            expect(buttons.length).toBe(2);
            expect(buttons[0].element.textContent).toBe('Cancel');
            expect(buttons[1].element.textContent).toBe('Save');
        });

        it('"Cancel" button should call modal.hide()', () => {
            const hideSpy = vi.spyOn(profileModal, 'hide');
            const buttons = profileModal.getFooterButtons();
            const cancelButton = buttons.find(b => b.element.textContent === 'Cancel');
            cancelButton.element.click();
            expect(hideSpy).toHaveBeenCalledTimes(1);
        });

        it('"Save" button should trigger form submission', () => {
            const form = profileModal._formComponent.element;
            const requestSubmitSpy = vi.spyOn(form, 'requestSubmit');

            const buttons = profileModal.getFooterButtons();
            const saveButton = buttons.find(b => b.element.textContent === 'Save');
            saveButton.element.click();
            expect(requestSubmitSpy).toHaveBeenCalledTimes(1);
        });
    });
});
