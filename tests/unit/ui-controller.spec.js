import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UIController } from '../../src/ui-controller';

const createMockElement = () => ({
    classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
    style: {},
    querySelector: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    innerHTML: '',
    id: '',
    className: '',
    textContent: '',
    appendChild: vi.fn(), // Keep for older tests if any use it
    remove: vi.fn(),
    append: vi.fn(), // Main method for appending children
    insertBefore: vi.fn(),
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    focus: vi.fn(),
});

const createMockComponentInstance = (element) => ({
    element,
    add: vi.fn().mockReturnThis(),
    mount: vi.fn().mockReturnThis(),
    setContent: vi.fn().mockReturnThis(),
    destroy: vi.fn(),
    show: vi.fn().mockReturnThis(),
});

let mockModalElement, mockModalContentElement, mockToastContainerElement;

vi.mock('../../src/ui', () => {
    const Component = vi.fn((tag, props) => {
        const newElement = createMockElement();
        newElement.className = props?.className || '';

        if (props?.className === 'modal-overlay') {
            mockModalElement = newElement;
            newElement.querySelector.mockImplementation(selector => {
                if (selector === '.modal-content') {
                    if (!mockModalContentElement) mockModalContentElement = createMockElement();
                    mockModalContentElement.className = 'modal-content';
                    return mockModalContentElement;
                }
                return null;
            });
        }

        const instance = createMockComponentInstance(newElement);
        instance.props = props;
        return instance;
    });

    const Button = vi.fn((props) => {
        const newElement = createMockElement();
        newElement.className = props?.className || 'button';
        newElement.textContent = props?.textContent || '';
        const instance = createMockComponentInstance(newElement);
        instance.setEnabled = vi.fn();
        instance.props = props;
        return instance;
    });
    return { Component, Button };
});


let Component, Button;

(async () => {
    const uiModule = await import('../../src/ui');
    Component = uiModule.Component;
    Button = uiModule.Button;
})();


describe('UIController', () => {
    let uiController;

    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';

        mockModalContentElement = createMockElement();
        mockModalContentElement.className = 'modal-content';

        uiController = new UIController();

        // Ensure uiController.modal and uiController.toastContainer are the mocked instances
        const modalCall = Component.mock.calls.find(call => call[1]?.className === 'modal-overlay');
        if (modalCall) {
            uiController.modal = Component.mock.results[Component.mock.calls.indexOf(modalCall)].value;
        }

        const toastContainerCall = Component.mock.calls.find(call => call[1]?.className === 'toast-container');
        if (toastContainerCall) {
            uiController.toastContainer = Component.mock.results[Component.mock.calls.indexOf(toastContainerCall)].value;
        } else { // Fallback if not found (e.g. if constructor changes)
            uiController.toastContainer = createMockComponentInstance(createMockElement());
        }
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.useRealTimers();
    });

    describe('constructor', () => {
        it('should create and mount a modal overlay', () => {
            expect(Component).toHaveBeenCalledWith('div', { className: 'modal-overlay' });
            const modalInstance = uiController.modal;
            expect(modalInstance.add).toHaveBeenCalled();
            expect(modalInstance.mount).toHaveBeenCalledWith(document.body);
            expect(modalInstance.element.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
        });

        it('should create and mount a toast container', () => {
            expect(Component).toHaveBeenCalledWith('div', { className: 'toast-container' });
            const toastContainerInstance = uiController.toastContainer;
            expect(toastContainerInstance.mount).toHaveBeenCalledWith(document.body);
        });
    });

    describe('createModal (called by constructor)', () => {
        it('should attach a click listener to the overlay to hide modal', () => {
            const modalInstance = uiController.modal;
            const clickListener = modalInstance.element.addEventListener.mock.calls[0][1];
            const mockEvent = { target: modalInstance.element };
            clickListener(mockEvent);
            expect(modalInstance.element.classList.remove).toHaveBeenCalledWith('visible');
        });

        it('should not hide modal if click is on modal content (event bubbling)', () => {
            const modalInstance = uiController.modal;
            const clickListener = modalInstance.element.addEventListener.mock.calls[0][1];
            // Ensure modalContentElement is set up for the modal instance's querySelector
            modalInstance.element.querySelector.mockReturnValueOnce(mockModalContentElement);
            const mockEvent = { target: mockModalContentElement };
            clickListener(mockEvent);
            expect(modalInstance.element.classList.remove).not.toHaveBeenCalledWith('visible');
        });
    });


    describe('showModal', () => {
        it('should clear modal content, create and append title, body (Component), and buttons', () => {
            const title = 'Test Modal';
            const bodyComponent = new Component('p', { textContent: 'Modal body text' });
            const mockButtonOk = new Button({ textContent: 'OK' });
            const buttons = [mockButtonOk];

            // Call showModal
            uiController.showModal({ title, body: bodyComponent, buttons });

            const modalInstance = uiController.modal;
            // Get the reference to the modalContentElement that was queried by showModal
            const modalContentElementRef = modalInstance.element.querySelector('.modal-content');

            expect(modalContentElementRef.innerHTML).toBe('');

            // Find the mock instances created for title and buttons container
            const titleInstance = Component.mock.results[Component.mock.calls.findIndex(call => call[0] === 'h3' && call[1]?.textContent === title)].value;
            const buttonsContainerInstance = Component.mock.results[Component.mock.calls.findIndex(call => call[1]?.className === 'modal-buttons')].value;

            // Assert that append was called once with all three elements
            expect(modalContentElementRef.append).toHaveBeenCalledTimes(1);
            expect(modalContentElementRef.append).toHaveBeenCalledWith(
                titleInstance.element,
                bodyComponent.element,
                buttonsContainerInstance.element
            );

            expect(buttonsContainerInstance.add).toHaveBeenCalledWith(mockButtonOk);
            expect(modalInstance.element.classList.add).toHaveBeenCalledWith('visible');
        });

        it('should handle body as a native DOM element', () => {
            const title = 'Test Native Element';
            const nativeBodyElement = document.createElement('div');
            nativeBodyElement.textContent = 'Native content';
            const buttons = [new Button({ textContent: 'Close' })];

            uiController.showModal({ title, body: nativeBodyElement, buttons });

            const modalInstance = uiController.modal;
            const modalContentElementRef = modalInstance.element.querySelector('.modal-content');
            const titleInstance = Component.mock.results[Component.mock.calls.findIndex(call => call[0] === 'h3' && call[1]?.textContent === title)].value;
            const buttonsContainerInstance = Component.mock.results[Component.mock.calls.findIndex(call => call[1]?.className === 'modal-buttons')].value;

            expect(modalContentElementRef.append).toHaveBeenCalledWith(titleInstance.element, nativeBodyElement, buttonsContainerInstance.element);
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

            const toastCallIndex = Component.mock.calls.findIndex(call => call[1]?.className === 'toast');
            expect(toastCallIndex).toBeGreaterThan(-1);
            const toastInstance = Component.mock.results[toastCallIndex].value;

            expect(uiController.toastContainer.add).toHaveBeenCalledWith(toastInstance);

            expect(toastInstance.element.classList.add).not.toHaveBeenCalledWith('visible');
            vi.advanceTimersByTime(10);
            expect(toastInstance.element.classList.add).toHaveBeenCalledWith('visible');

            vi.advanceTimersByTime(duration);
            expect(toastInstance.element.classList.remove).toHaveBeenCalledWith('visible');

            vi.advanceTimersByTime(300);
            expect(toastInstance.destroy).toHaveBeenCalled();
        });

        it.each([
            ['info', 'var(--header-bg)'],
            ['success', 'var(--success)'],
            ['warn', 'var(--warning)'],
            ['error', 'var(--danger)'],
            ['custom', 'var(--header-bg)'],
        ])('should apply correct style for toast type %s', (type, expectedBg) => {
            uiController.showToast('A message', type);
            const toastCallIndex = Component.mock.calls.findIndex(call => call[1]?.className === 'toast');
            const toastInstance = Component.mock.results[toastCallIndex].value;
            expect(toastInstance.element.style.background).toBe(expectedBg);
        });
    });

    describe('setLoading', () => {
        it('should add loading indicator to document.body when isLoading is true', () => {
            const existingIndicator = document.getElementById('loading-indicator');
            if (existingIndicator) existingIndicator.remove();

            uiController.setLoading(true);
            expect(document.getElementById('loading-indicator')).not.toBeNull();
            expect(document.getElementById('loading-indicator').textContent).toBe('⏳ Loading...');
        });

        it('should remove existing loading indicator when isLoading is true before adding new one', () => {
            const dummyIndicator = document.createElement('div');
            dummyIndicator.id = 'loading-indicator';
            document.body.appendChild(dummyIndicator);

            const spyRemove = vi.spyOn(dummyIndicator, 'remove');
            uiController.setLoading(true);
            expect(spyRemove).toHaveBeenCalled();
            expect(document.getElementById('loading-indicator')).not.toBeNull();
            expect(document.getElementById('loading-indicator').textContent).toBe('⏳ Loading...');
            expect(document.getElementById('loading-indicator')).not.toBe(dummyIndicator);
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
            expect(document.getElementById('loading-indicator')).toBeNull();
            expect(() => uiController.setLoading(false)).not.toThrow();
        });
    });
});
