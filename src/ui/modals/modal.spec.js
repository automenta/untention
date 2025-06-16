import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseModal } from './modal.js';
import { Component } from '/ui/ui.js'; // Assuming ui.js is in the parent directory relative to modals

// Mock App and its properties (ui, dataStore)
const mockApp = {
    ui: {
        showModal: vi.fn(),
        hideModal: vi.fn(),
        showToast: vi.fn(), // Though not directly used by BaseModal, good to have for consistency
    },
    // other app methods that might be called by specific modals
    saveIdentity: vi.fn(),
    handleAction: vi.fn(),
    // dataStore might be needed if BaseModal or subclasses access it directly
    dataStore: {
        state: {
            identity: {},
            thoughts: {},
            relays: [],
        }
    }
};

// A concrete implementation for testing BaseModal, as it has abstract methods
class ConcreteModal extends BaseModal {
    constructor(app, title = 'Test Modal') {
        super(title, app);
        this.getContentMock = vi.fn(() => new Component('div', { textContent: 'Test Content' }));
        this.getFooterButtonsMock = vi.fn(() => [
            new Component('button', { textContent: 'OK' }) // Using Component for simplicity, real would be Button
        ]);
    }

    getContent() {
        return this.getContentMock();
    }

    getFooterButtons() {
        return this.getFooterButtonsMock();
    }
}

describe('BaseModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should throw an error if app or app.ui is not provided', () => {
        expect(() => new BaseModal('Title', null)).toThrow("BaseModal requires an app instance with a UI controller.");
        expect(() => new BaseModal('Title', {})).toThrow("BaseModal requires an app instance with a UI controller.");
    });

    it('constructor should set title and app properties', () => {
        const modal = new BaseModal('My Modal', mockApp);
        expect(modal.title).toBe('My Modal');
        expect(modal.app).toBe(mockApp);
        expect(modal.ui).toBe(mockApp.ui);
        expect(modal.modalElement).toBeNull();
    });

    describe('show()', () => {
        it('should call app.ui.showModal with correct parameters', () => {
            const modal = new ConcreteModal(mockApp, 'Show Test');
            const mockContent = new Component('div', { textContent: 'Specific Content' });
            const mockButtons = [new Component('button', { textContent: 'Test Button' })];

            modal.getContentMock.mockReturnValue(mockContent);
            modal.getFooterButtonsMock.mockReturnValue(mockButtons);

            modal.show();

            expect(mockApp.ui.showModal).toHaveBeenCalledTimes(1);
            expect(mockApp.ui.showModal).toHaveBeenCalledWith({
                title: 'Show Test',
                body: mockContent,
                buttons: mockButtons,
            });
        });

        it('should call getContent and getFooterButtons', () => {
            const modal = new ConcreteModal(mockApp);
            modal.show();
            expect(modal.getContentMock).toHaveBeenCalledTimes(1);
            expect(modal.getFooterButtonsMock).toHaveBeenCalledTimes(1);
        });
    });

    describe('hide()', () => {
        it('should call app.ui.hideModal', () => {
            const modal = new BaseModal('Test Hide', mockApp);
            modal.hide();
            expect(mockApp.ui.hideModal).toHaveBeenCalledTimes(1);
        });
    });

    describe('Abstract methods (direct call)', () => {
        it('getContent should throw if not implemented by subclass (when called directly)', () => {
            const modal = new BaseModal('Test Abstract', mockApp);
            expect(() => modal.getContent()).toThrow("Method 'getContent()' must be implemented by subclasses.");
        });

        it('getFooterButtons should throw if not implemented by subclass (when called directly)', () => {
            const modal = new BaseModal('Test Abstract', mockApp);
            expect(() => modal.getFooterButtons()).toThrow("Method 'getFooterButtons()' must be implemented by subclasses.");
        });
    });

    // Test for _createElement - though it's not directly used by show() in the current design
    // It's good to test its functionality if it's intended to be a utility or for future use.
    describe('_createElement()', () => {
        let modal;
        let mockContentElement;
        let mockButtonElement;

        beforeEach(() => {
            modal = new ConcreteModal(mockApp, 'Element Test');
            mockContentElement = new Component('p', {textContent: 'Mock Content'});
            mockButtonElement = new Component('button', {textContent: 'Mock Button'});
            modal.getContentMock.mockReturnValue(mockContentElement);
            modal.getFooterButtonsMock.mockReturnValue([mockButtonElement]);
        });

        it('should create a modal backdrop element', () => {
            modal._createElement();
            expect(modal.modalElement).toBeInstanceOf(Component);
            expect(modal.modalElement.element.className).toContain('modal-backdrop');
        });

        it('should create a dialog with header, content, and footer', () => {
            modal._createElement();
            const dialog = modal.modalElement.element.querySelector('.modal-dialog');
            expect(dialog).not.toBeNull();
            expect(dialog.querySelector('.modal-header')).not.toBeNull();
            expect(dialog.querySelector('.modal-content')).not.toBeNull();
            expect(dialog.querySelector('.modal-footer')).not.toBeNull();
        });

        it('header should contain the title and a close button', () => {
            modal._createElement();
            const header = modal.modalElement.element.querySelector('.modal-header');
            expect(header.querySelector('h2').textContent).toBe('Element Test');
            const closeButton = header.querySelector('.modal-close');
            expect(closeButton).not.toBeNull();
            expect(closeButton.textContent).toBe('×');
            // Test close button click
            closeButton.click();
            expect(mockApp.ui.hideModal).toHaveBeenCalledTimes(1);
        });

        it('content area should contain result from getContent()', () => {
            modal._createElement();
            const contentArea = modal.modalElement.element.querySelector('.modal-content');
            expect(contentArea.contains(mockContentElement.element)).toBe(true);
        });

        it('footer should contain buttons from getFooterButtons()', () => {
            modal._createElement();
            const footerArea = modal.modalElement.element.querySelector('.modal-footer');
            expect(footerArea.contains(mockButtonElement.element)).toBe(true);
        });

        it('should handle empty getContent() and getFooterButtons()', () => {
            modal.getContentMock.mockReturnValue(null);
            modal.getFooterButtonsMock.mockReturnValue([]);
            modal._createElement();
            const contentArea = modal.modalElement.element.querySelector('.modal-content');
            expect(contentArea.innerHTML).toBe('');
            const footerArea = modal.modalElement.element.querySelector('.modal-footer');
            expect(footerArea.innerHTML).toBe('');
        });
    });
});
