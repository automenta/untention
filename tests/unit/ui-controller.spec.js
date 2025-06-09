import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UIController } from '../../src/ui-controller'; // Adjust path as necessary

// Mock Component and Button
const mockComponentInstance = {
    element: {
        classList: {
            add: vi.fn(),
            remove: vi.fn(),
            toggle: vi.fn(),
        },
        style: {},
        querySelector: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        innerHTML: '',
        id: '',
        className: '',
        textContent: '',
        appendChild: vi.fn(),
        remove: vi.fn(),
        append: vi.fn(), // For modalContent.append
    },
    add: vi.fn().mockReturnThis(),
    mount: vi.fn().mockReturnThis(),
    setContent: vi.fn().mockReturnThis(),
    destroy: vi.fn(),
    show: vi.fn().mockReturnThis(),
};

const mockButtonInstance = {
    ...mockComponentInstance, // Buttons share Component's base structure
    setEnabled: vi.fn(),
};

vi.mock('../../src/ui', () => ({
    Component: vi.fn(() => ({ ...mockComponentInstance, element: { ...mockComponentInstance.element, classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() }, querySelector: vi.fn(() => mockComponentInstance.element), appendChild: vi.fn(), remove: vi.fn(), addEventListener: vi.fn(), append: vi.fn()} })),
    Button: vi.fn(() => ({ ...mockButtonInstance, element: { ...mockButtonInstance.element, classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() } } })),
}));


describe('UIController', () => {
    let uiController;
    const { Component, Button } = await import('../../src/ui'); // Get the mocked versions

    beforeEach(() => {
        // Reset mocks before each test
        vi.clearAllMocks();
        // Mock document.body.appendChild/remove for specific elements if needed,
        // or ensure elements are cleaned up.
        // For loading indicator and modal/toast container:
        document.body.innerHTML = ''; // Clear body for each test

        // Re-initialize Component and Button mocks for clean state per test if complex
        // For simple mocks like these, vi.clearAllMocks() is often enough.
        // However, element properties might need manual reset if they are modified.
        mockComponentInstance.element.innerHTML = '';
        mockComponentInstance.element.id = '';
        mockComponentInstance.element.className = '';
        mockComponentInstance.element.textContent = '';
        mockComponentInstance.element.style = {};


        // Mock querySelector for modal content specifically
        mockComponentInstance.element.querySelector.mockImplementation((selector) => {
            if (selector === '.modal-content') {
                // Return a new mock element for modal-content to avoid interference
                return { ...mockComponentInstance.element, innerHTML: '', append: vi.fn(), classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() } };
            }
            return null;
        });


        uiController = new UIController();
    });

    afterEach(() => {
        document.body.innerHTML = ''; // Clean up body
        vi.useRealTimers(); // Restore real timers if fake ones were used
    });

    describe('constructor', () => {
        it('should create and mount a modal overlay', () => {
            expect(Component).toHaveBeenCalledWith('div', { className: 'modal-overlay' });
            const modalInstance = Component.mock.results[0].value; // Get the instance created for modal
            expect(modalInstance.add).toHaveBeenCalled(); // With modal-content
            expect(modalInstance.mount).toHaveBeenCalledWith(document.body);
            expect(modalInstance.element.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
        });

        it('should create and mount a toast container', () => {
            expect(Component).toHaveBeenCalledWith('div', { className: 'toast-container' });
            const toastContainerInstance = Component.mock.results[1].value; // Get the instance for toastContainer
            expect(toastContainerInstance.mount).toHaveBeenCalledWith(document.body);
        });
    });

    describe('createModal (called by constructor)', () => {
        it('should attach a click listener to the overlay to hide modal', () => {
            const modalInstance = Component.mock.results[0].value;
            const clickListener = modalInstance.element.addEventListener.mock.calls[0][1];

            // Simulate click on overlay itself
            const mockEvent = { target: modalInstance.element };
            clickListener(mockEvent);
            expect(modalInstance.element.classList.remove).toHaveBeenCalledWith('visible');
        });

        it('should not hide modal if click is on modal content (event bubbling)', () => {
            const modalInstance = Component.mock.results[0].value;
            const clickListener = modalInstance.element.addEventListener.mock.calls[0][1];

            const mockModalContentElement = document.createElement('div'); // Or a mock
            const mockEvent = { target: mockModalContentElement }; // Click on content
            clickListener(mockEvent);
            expect(modalInstance.element.classList.remove).not.toHaveBeenCalledWith('visible');
        });
    });


    describe('showModal', () => {
        it('should clear modal content, create and append title, body (Component), and buttons', () => {
            const title = 'Test Modal';
            const bodyComponent = new Component('p', { textContent: 'Modal body text' });
            const mockButton1 = new Button({ textContent: 'OK' });
            const buttons = [mockButton1];

            uiController.showModal({ title, body: bodyComponent, buttons });

            const modalInstance = uiController.modal; // actual instance used
            const modalContentElement = modalInstance.element.querySelector('.modal-content');

            expect(modalContentElement.innerHTML).toBe(''); // Cleared
            expect(Component).toHaveBeenCalledWith('h3', { textContent: title }); // Title
            expect(Component).toHaveBeenCalledWith('div', { className: 'modal-buttons' }); // Buttons container

            const buttonsContainerInstance = Component.mock.results.find(
                (result) => result.value.element.className === 'modal-buttons' || result.value.element.className.includes('modal-buttons')
            )?.value;

            // Check if body component's element was appended
            // Check if button was added to buttonsContainer
            expect(modalContentElement.append).toHaveBeenCalledTimes(1);
            expect(modalContentElement.append).toHaveBeenCalledWith(
                expect.any(Object), // title H3 element
                bodyComponent.element, // body component's element
                buttonsContainerInstance.element // buttons container element
            );
            expect(buttonsContainerInstance.add).toHaveBeenCalledWith(mockButton1);
            expect(modalInstance.element.classList.add).toHaveBeenCalledWith('visible');
        });

        it('should handle body as a native DOM element', () => {
            const title = 'Test Native Element';
            const nativeBodyElement = document.createElement('div');
            nativeBodyElement.textContent = 'Native content';
            const buttons = [new Button({ textContent: 'Close' })];

            uiController.showModal({ title, body: nativeBodyElement, buttons });

            const modalInstance = uiController.modal;
            const modalContentElement = modalInstance.element.querySelector('.modal-content');
            expect(modalContentElement.append).toHaveBeenCalledWith(
                expect.any(Object),
                nativeBodyElement,
                expect.any(Object)
            );
            expect(modalInstance.element.classList.add).toHaveBeenCalledWith('visible');
        });
    });

    describe('hideModal', () => {
        it('should remove "visible" class from modal overlay', () => {
            uiController.hideModal();
            const modalInstance = uiController.modal;
            expect(modalInstance.element.classList.remove).toHaveBeenCalledWith('visible');
        });
    });

    describe('showToast', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        it('should create a toast, add to container, show, then hide and destroy', () => {
            const message = 'Test toast';
            const duration = 3000;

            uiController.showToast(message, 'info', duration);

            // Default emoji for 'info' is 'ℹ️'
            expect(Component).toHaveBeenCalledWith('div', { className: 'toast', textContent: `ℹ️ ${message}` });
            const toastInstance = Component.mock.results[Component.mock.calls.length -1].value;
            const toastContainerInstance = uiController.toastContainer;

            expect(toastContainerInstance.add).toHaveBeenCalledWith(toastInstance);

            // Visibility class added after short delay
            expect(toastInstance.element.classList.add).not.toHaveBeenCalledWith('visible');
            vi.advanceTimersByTime(10);
            expect(toastInstance.element.classList.add).toHaveBeenCalledWith('visible');

            // Class removed and destroyed after duration
            vi.advanceTimersByTime(duration);
            expect(toastInstance.element.classList.remove).toHaveBeenCalledWith('visible');
            expect(toastInstance.destroy).not.toHaveBeenCalled(); // Not yet, there's another timeout

            vi.advanceTimersByTime(300); // For destroy timeout
            expect(toastInstance.destroy).toHaveBeenCalled();
        });

        it.each([
            ['info', 'var(--header-bg)'],
            ['success', 'var(--success)'],
            ['warn', 'var(--warning)'],
            ['error', 'var(--danger)'],
            ['custom', 'var(--header-bg)'], // Test default case
        ])('should apply correct style for toast type %s', (type, expectedBg) => {
            uiController.showToast('A message', type);
            const toastInstance = Component.mock.results[Component.mock.calls.length -1].value;
            expect(toastInstance.element.style.background).toBe(expectedBg);
        });
    });

    describe('setLoading', () => {
        it('should add loading indicator to document.body when isLoading is true', () => {
            uiController.setLoading(true);
            // Note: direct DOM manipulation is harder to assert with mocks only.
            // We check if an element with the ID *would be* removed if it existed,
            // and then we rely on the actual implementation to add it.
            // A better test would be to spy on document.getElementById and document.body.insertAdjacentHTML
            // For now, we assume the implementation works if no error and it tries to remove previous.
            const existingIndicator = document.getElementById('loading-indicator');
            if (existingIndicator) existingIndicator.remove(); // ensure clean state

            uiController.setLoading(true);
            expect(document.getElementById('loading-indicator')).not.toBeNull();
            expect(document.getElementById('loading-indicator').textContent).toBe('⏳ Loading...');
        });

        it('should remove existing loading indicator when isLoading is true before adding new one', () => {
            // Add a dummy one
            const dummyIndicator = document.createElement('div');
            dummyIndicator.id = 'loading-indicator';
            document.body.appendChild(dummyIndicator);

            const spyRemove = vi.spyOn(dummyIndicator, 'remove');
            uiController.setLoading(true); // This should remove the dummy and add a new one
            expect(spyRemove).toHaveBeenCalled();
            expect(document.getElementById('loading-indicator')).not.toBeNull(); // New one is there
            expect(document.getElementById('loading-indicator').textContent).toBe('⏳ Loading...'); // Check new one's content
            expect(document.getElementById('loading-indicator')).not.toBe(dummyIndicator); // It's a new one
        });


        it('should remove loading indicator from document.body when isLoading is false and it exists', () => {
            const indicator = document.createElement('div');
            indicator.id = 'loading-indicator';
            document.body.appendChild(indicator);

            const spyRemove = vi.spyOn(indicator, 'remove');
            uiController.setLoading(false);
            expect(spyRemove).toHaveBeenCalled();
        });

        it('should not throw if removing loading indicator when it does not exist (isLoading is false)', () => {
            expect(document.getElementById('loading-indicator')).toBeNull(); // Ensure it's not there
            expect(() => uiController.setLoading(false)).not.toThrow();
        });
    });
});
