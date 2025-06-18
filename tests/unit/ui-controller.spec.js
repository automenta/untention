import { UIController } from '../../src/ui-controller.js';
import { vi } from 'vitest';

// Mock localforage
vi.mock('localforage', () => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}));

// Spy on document.getElementById
const getElementByIdSpy = vi.spyOn(document, 'getElementById');
const originalConsoleError = console.error; // Preserve original console.error

const EMOJI_INFO = 'ℹ️'; // For showToast test

// These will be assigned the mock constructors from the factory in beforeEach
let ComponentMock;
let ButtonMock;
// mockModalElementReal and mockModalContentElementReal are used by the vi.mock factory below.
// They need to be accessible within that factory's scope.
let mockModalElementReal, mockModalContentElementReal;


vi.mock('../../src/ui.js', async (importOriginal) => {
  const actualUi = await importOriginal();

  const createBaseMock = (elementTag = 'div', props = {}) => {
    const element = document.createElement(elementTag);

    if (props.id) element.id = props.id;
    if (props.className) element.className = props.className;
    if (props.textContent) element.textContent = props.textContent;
    // For button, ensure type is set if passed in props
    if (elementTag === 'button' && props.type) element.type = props.type;


    const originalMethods = {
      addEventListener: element.addEventListener.bind(element),
      removeEventListener: element.removeEventListener.bind(element),
      appendChild: element.appendChild.bind(element),
      removeChild: element.removeChild.bind(element),
      remove: element.remove.bind(element),
      querySelector: element.querySelector.bind(element),
      querySelectorAll: element.querySelectorAll.bind(element),
      classList_add: element.classList.add.bind(element.classList),
      classList_remove: element.classList.remove.bind(element.classList),
      classList_toggle: element.classList.toggle.bind(element.classList),
      classList_contains: element.classList.contains.bind(element.classList),
    };

    vi.spyOn(element, 'addEventListener').mockImplementation((type, listener, options) => originalMethods.addEventListener(type, listener, options));
    vi.spyOn(element, 'removeEventListener').mockImplementation((type, listener, options) => originalMethods.removeEventListener(type, listener, options));
    vi.spyOn(element, 'appendChild').mockImplementation(child => originalMethods.appendChild(child));
    vi.spyOn(element, 'removeChild').mockImplementation(child => originalMethods.removeChild(child));
    vi.spyOn(element, 'remove').mockImplementation(() => originalMethods.remove());
    vi.spyOn(element, 'querySelector').mockImplementation(selector => originalMethods.querySelector(selector));
    vi.spyOn(element, 'querySelectorAll').mockImplementation(selector => originalMethods.querySelectorAll(selector));

    vi.spyOn(element.classList, 'add').mockImplementation((...tokens) => originalMethods.classList_add(...tokens));
    vi.spyOn(element.classList, 'remove').mockImplementation((...tokens) => originalMethods.classList_remove(...tokens));
    vi.spyOn(element.classList, 'toggle').mockImplementation((token, force) => originalMethods.classList_toggle(token, force));
    vi.spyOn(element.classList, 'contains').mockImplementation(token => originalMethods.classList_contains(token));

    const instance = {
      element: element,
      props: props,
      add: vi.fn(function() { return this; }),
      mount: vi.fn(function(parentElement) {
        parentElement.appendChild(this.element);
        return this;
      }),
      show: vi.fn(function(isVisible) {
        if (isVisible) {
          originalMethods.classList_remove.call(this.element.classList, 'hidden');
        } else {
          originalMethods.classList_add.call(this.element.classList, 'hidden');
        }
        return this;
      }),
      hide: vi.fn(function() {
        originalMethods.classList_add.call(this.element.classList, 'hidden');
        return this;
      }),
      addEventListener: vi.fn(),
      destroy: vi.fn(function() {
        if (this.element.remove) { // Modern browsers all support this
           this.element.remove();
        } else if (this.element.parentElement) { // Fallback
           originalMethods.removeChild.call(this.element.parentElement, this.element);
        }
        // Make destroy chainable and clear props to mimic real destroy
        this.props = {};
        return this;
      }),
      append: vi.fn(function(...children) {
        for (const child of children) {
          this.element.appendChild(child.element || child);
        }
        return this;
      }),
      setText: vi.fn(function(text) {
        this.element.textContent = text;
        return this;
      }),
      querySelector: vi.fn(function(selector) {
         // Special handling for modal overlay's content area
         if ((this.props.className === 'modal-overlay' || this.element.className === 'modal-overlay') && selector === '.modal-content') {
            // If mockModalContentElementReal exists and is a child of this element, return it
            if (mockModalContentElementReal && this.element.contains(mockModalContentElementReal)) {
                return mockModalContentElementReal;
            }
         }
         return this.element.querySelector(selector); // Default delegation
      }),
      // Expose classList for direct manipulation in tests if needed, already spied on
      classList: element.classList,
    };
    return instance;
  };

  // Corrected MockComponentForExport to handle (tagOrProps, props) signature
  const MockComponentForExport = vi.fn((tagOrProps, componentProps) => {
    let tag = 'div';
    let props = {};
    if (typeof tagOrProps === 'string') {
      tag = tagOrProps;
      props = componentProps || {};
    } else { // First argument is props or undefined
      props = tagOrProps || {};
      // tag remains 'div' (default)
    }

    const newProps = {...props}; // Clone for safety
    const baseInstance = createBaseMock(tag, newProps);

    // Special handling for modal-overlay to create and attach its content area
    if (newProps.className === 'modal-overlay') {
        mockModalElementReal = baseInstance.element; // Assign the main overlay element

        // Create the modal content div
        mockModalContentElementReal = document.createElement('div');
        mockModalContentElementReal.className = 'modal-content';

        // Spy on its methods before appending, if needed for specific tests
        vi.spyOn(mockModalContentElementReal, 'append');
        vi.spyOn(mockModalContentElementReal, 'appendChild');
        mockModalContentElementReal.innerHTML = ''; // Clear it for tests

        // Append the content div to the overlay element
        baseInstance.element.appendChild(mockModalContentElementReal);
    }
    return baseInstance;
  });

  // Define the mock for Button that should be used.
  const EffectiveButtonMock = vi.fn((props = {}) => {
    // console.log("EffectiveButtonMock CALLED with props:", props); // Diagnostic log removed
    const buttonInstance = createBaseMock('button', props);
    buttonInstance.element.setAttribute('data-mocked-button', 'true'); // Keep for other tests where ButtonMock is new'd directly
    if (props && props.onClick && typeof props.onClick === 'function') {
      buttonInstance.element.addEventListener('click', props.onClick);
    }
    // Ensure mocked buttons also have setEnabled
    buttonInstance.setEnabled = vi.fn(function(enabled) { this.element.disabled = !enabled; return this; });
    return buttonInstance;
  });

  return {
    ...actualUi, // Spread actual exports first
    Component: MockComponentForExport, // Override Component
    Button: EffectiveButtonMock,       // Override Button with our mock
  };
});

// --- IMPORTANT ---
// The rest of the file (describe('UIController', () => { ... }) and all its tests)
// must be KEPT AS IS below this vi.mock block.
// This overwrite only targets the vi.mock(...) part.
// --- END IMPORTANT ---

// The original `describe` block starts here...
// describe('UIController', () => { ... });
describe('UIController', () => {
  let uiController;
  let mockApp;
  let mockModalElementFromGetElementById;
  let mockModalTitleElement;
  let mockModalContentElementFromGetElementById;
  let mockModalActionsElement;
  let mockLoadingIndicatorElement;

  let ComponentMock;
  let ButtonMock;

  beforeEach(async () => {
    const uiMockModule = await import('../../src/ui.js');
    ComponentMock = uiMockModule.Component; // This should be MockComponentForExport
    ButtonMock = uiMockModule.Button;       // This should now be ButtonMockSpy

    // Clear all mocks, including the new ButtonMockSpy if it was called during UIController construction
    vi.clearAllMocks();

    console.error = originalConsoleError;


    mockModalElementFromGetElementById = document.createElement('div');
    mockModalTitleElement = document.createElement('h3');
    mockModalContentElementFromGetElementById = document.createElement('div');
    mockModalActionsElement = document.createElement('div');
    mockLoadingIndicatorElement = document.createElement('div');

    mockModalElementFromGetElementById.id = 'modal';
    mockModalTitleElement.id = 'modal-title';
    mockModalContentElementFromGetElementById.id = 'modal-content';
    mockModalActionsElement.id = 'modal-actions';
    mockLoadingIndicatorElement.id = 'loading-indicator';

    document.body.innerHTML = '';
    document.body.appendChild(mockModalElementFromGetElementById);
    document.body.appendChild(mockModalTitleElement);
    document.body.appendChild(mockModalContentElementFromGetElementById);
    document.body.appendChild(mockModalActionsElement);

    getElementByIdSpy.mockImplementation((id) => {
      switch (id) {
        case 'modal': return mockModalElementFromGetElementById;
        case 'modal-title': return mockModalTitleElement;
        case 'modal-content': return mockModalContentElementFromGetElementById;
        case 'modal-actions': return mockModalActionsElement;
        case 'loading-indicator':
          return uiController?.loadingIndicator?.element || document.querySelector('#loading-indicator');
        default: return null;
      }
    });

    mockApp = {
      handleAction: vi.fn(),
    };
    uiController = new UIController(mockApp);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create and mount a modal overlay', () => {
        expect(ComponentMock).toHaveBeenCalledWith('div', { className: 'modal-overlay' });
        const modalInstance = uiController.modal;
        expect(modalInstance.add).toHaveBeenCalled();
        expect(modalInstance.mount).toHaveBeenCalledWith(document.body);
        expect(modalInstance.element.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
    });

    it('should create and mount a toast container', () => {
        expect(ComponentMock).toHaveBeenCalledWith('div', { className: 'toast-container' });
        const toastContainerInstance = uiController.toastContainer;
        expect(toastContainerInstance.mount).toHaveBeenCalledWith(document.body);
    });
  });

  describe('createModal (called by constructor)', () => {
    it('should attach a click listener to the overlay to hide modal', () => {
        const modalInstance = uiController.modal;
        const clickListenerCall = modalInstance.element.addEventListener.mock.calls.find(call => call[0] === 'click');
        expect(clickListenerCall).toBeDefined();
        const clickListener = clickListenerCall[1];

        const mockEvent = { target: modalInstance.element };
        clickListener(mockEvent);
        expect(modalInstance.element.classList.remove).toHaveBeenCalledWith('visible');
    });

    it('should not hide modal if click is on modal content (event bubbling)', () => {
        const modalInstance = uiController.modal;
        const clickListenerCall = modalInstance.element.addEventListener.mock.calls.find(call => call[0] === 'click');
        expect(clickListenerCall).toBeDefined();
        const clickListener = clickListenerCall[1];

        const mockEvent = { target: mockModalContentElementReal };
        clickListener(mockEvent);
        expect(modalInstance.element.classList.remove).not.toHaveBeenCalledWith('visible');
    });
  });


  describe('showModal', () => {
    it('should clear previous content and append new content and buttons', () => {
      const testTitle = 'Test Modal';
      const contentComponent = new ComponentMock('p', { textContent: 'Modal body text' });
      const button1 = new ButtonMock({ textContent: 'OK' });
      const button2 = new ButtonMock({ textContent: 'Cancel' });
      const buttons = [button1, button2];

      const modalInstance = uiController.modal;
      const modalContentElement = mockModalContentElementReal;
      expect(modalContentElement).not.toBeNull();

      uiController.showModal({title: testTitle, body: contentComponent, buttons });

      const titleElementInDOM = modalContentElement.querySelector('h3');
      expect(titleElementInDOM).not.toBeNull();
      if(titleElementInDOM) expect(titleElementInDOM.textContent).toBe(testTitle);

      // This assertion is problematic: innerHTML is checked AFTER new content is supposed to be added.
      // expect(modalContentElement.innerHTML).toBe('');

      const titleInstanceArgs = ComponentMock.mock.calls.find(call => call[0] === 'h3' && call[1]?.textContent === testTitle);
      expect(titleInstanceArgs).toBeDefined();
      const titleInstance = ComponentMock.mock.results[ComponentMock.mock.calls.indexOf(titleInstanceArgs)].value;

      const buttonsContainerArgs = ComponentMock.mock.calls.find(call => call[0] === 'div' && call[1]?.className === 'modal-buttons');
      expect(buttonsContainerArgs).toBeDefined();
      const buttonsContainerInstance = ComponentMock.mock.results[ComponentMock.mock.calls.indexOf(buttonsContainerArgs)].value;


      expect(modalContentElement.append).toHaveBeenCalledTimes(1);
      expect(modalContentElement.append).toHaveBeenCalledWith(
          titleInstance.element,
          contentComponent.element,
          buttonsContainerInstance.element
      );

      expect(buttonsContainerInstance.add).toHaveBeenCalledWith(button1);
      expect(buttonsContainerInstance.add).toHaveBeenCalledWith(button2);
      expect(modalInstance.element.classList.add).toHaveBeenCalledWith('visible');
    });

    it('should only show a close button if no other buttons are provided', () => {
        const testTitle = 'Test Modal No Buttons';
        const contentComponent = new ComponentMock();

        const modalInstance = uiController.modal;
        const modalContentElement = mockModalContentElementReal;
        expect(modalContentElement).not.toBeNull();

        uiController.showModal({title: testTitle, body: contentComponent, buttons: [] });

        // Find the buttons container instance
        const buttonsContainerCall = ComponentMock.mock.calls.find(call => call[0] === 'div' && call[1]?.className === 'modal-buttons');
        expect(buttonsContainerCall).toBeDefined();
        const buttonsContainerInstance = ComponentMock.mock.results[ComponentMock.mock.calls.indexOf(buttonsContainerCall)].value;

        // Check that 'add' was called on the buttons container
        expect(buttonsContainerInstance.add).toHaveBeenCalledTimes(1);
        const addedDefaultButton = buttonsContainerInstance.add.mock.calls[0][0];

        // Verify the properties of the added button's element
        // This button is created by `new Button()` in ui-controller.js, so it won't have 'data-mocked-button'
        // if the mock isn't being used by ui-controller.js (which seems to be the case).
        expect(addedDefaultButton.element.textContent).toBe('Okay');
        expect(addedDefaultButton.element.className).toContain('modal-close-button');
        expect(addedDefaultButton.element.className).toContain('secondary');

        // Verify the onClick behavior
        const hideModalSpy = vi.spyOn(uiController, 'hideModal');
        // Simulate the click (assuming the onClick from props was attached to the element)
        // The actual Button class would attach props.onClick if provided.
        // Our createBaseMock for button does this:
        // if (props && props.onClick && typeof props.onClick === 'function') {
        //   buttonInstance.element.addEventListener('click', props.onClick);
        // }
        // So, if the real Button class does something similar, this should work.
        // If not, we might need to directly invoke addedDefaultButton.props.onClick() if it exists.

        // Check if onClick prop exists and is a function
        // expect(addedDefaultButton.props.onClick).toEqual(expect.any(Function)); // This fails as real Button might not store onClick on .props
        // Simulate a DOM click on the button's element instead
        addedDefaultButton.element.click();
        expect(hideModalSpy).toHaveBeenCalledTimes(1);

        expect(modalInstance.element.classList.add).toHaveBeenCalledWith('visible');
        hideModalSpy.mockRestore();
    });
     it('should handle body as a native DOM element', () => {
            const title = 'Test Native Element';
            const nativeBodyElement = document.createElement('div');
            nativeBodyElement.textContent = 'Native content';
            const buttons = [new ButtonMock({ textContent: 'Close' })];

            const modalInstance = uiController.modal;
            const modalContentElementRef = mockModalContentElementReal;
            expect(modalContentElementRef).not.toBeNull();

            uiController.showModal({ title, body: nativeBodyElement, buttons });

            const titleInstanceArgs = ComponentMock.mock.calls.find(call => call[0] === 'h3' && call[1]?.textContent === title);
            expect(titleInstanceArgs).toBeDefined();
            const titleInstance = ComponentMock.mock.results[ComponentMock.mock.calls.indexOf(titleInstanceArgs)].value;

            const buttonsContainerArgs = ComponentMock.mock.calls.find(call => call[0] === 'div' && call[1]?.className === 'modal-buttons');
            expect(buttonsContainerArgs).toBeDefined();
            const buttonsContainerInstance = ComponentMock.mock.results[ComponentMock.mock.calls.indexOf(buttonsContainerArgs)].value;


            expect(modalContentElementRef.append).toHaveBeenCalledWith(titleInstance.element, nativeBodyElement, buttonsContainerInstance.element);
            expect(modalInstance.element.classList.add).toHaveBeenCalledWith('visible');
        });
  });

  describe('hideModal', () => {
    it('should remove active class from modal element', () => {
      const modalElement = uiController.modal.element;
      modalElement.classList.add('visible');

      uiController.hideModal();

      expect(modalElement.classList.contains('visible')).toBe(false);
    });
  });

  describe('setLoading', () => {
    it('should show loading indicator when isLoading is true', () => {
        uiController.setLoading(true);
        expect(uiController.loadingIndicator.show).toHaveBeenCalledWith(true);
        expect(uiController.loadingIndicator.mount).toHaveBeenCalledWith(document.body);
        const newIndicator = document.getElementById('loading-indicator');
        expect(newIndicator).not.toBeNull();
        if (newIndicator) {
          expect(newIndicator.textContent).toBe('⏳ Loading...');
        }
    });

    it('should re-show existing loading indicator and not destroy it if called again with true', () => {
        uiController.setLoading(true);
        const firstIndicatorInstance = uiController.loadingIndicator;
        expect(firstIndicatorInstance).not.toBeNull();

        // Spy on methods of the first instance
        const destroySpy = vi.spyOn(firstIndicatorInstance, 'destroy');
        const showSpy = vi.spyOn(firstIndicatorInstance, 'show');

        uiController.setLoading(true); // Call setLoading(true) again

        expect(destroySpy).not.toHaveBeenCalled(); // Destroy should NOT be called
        expect(showSpy).toHaveBeenCalledWith(true);   // Show should be called again with true
        expect(uiController.loadingIndicator).toBe(firstIndicatorInstance); // Should be the same instance

        // Ensure the element is still the same and visible
        const indicatorElement = document.getElementById('loading-indicator');
        expect(indicatorElement).toBe(firstIndicatorInstance.element);
        expect(indicatorElement.classList.contains('hidden')).toBe(false); // Assuming show(true) removes 'hidden'
    });


    it('should hide and attempt to remove loading indicator when isLoading is false and indicator exists', () => {
        uiController.setLoading(true);
        const createdIndicator = uiController.loadingIndicator;
        expect(createdIndicator).not.toBeNull();

        createdIndicator.show.mockClear();
        createdIndicator.destroy.mockClear();

        uiController.setLoading(false);

        expect(createdIndicator.show).toHaveBeenCalledWith(false);
        expect(createdIndicator.destroy).toHaveBeenCalled();
        expect(uiController.loadingIndicator).toBeNull();
    });

    it('should not error if setLoading(false) is called and indicator is already null', () => {
        uiController.loadingIndicator = null;
        expect(() => uiController.setLoading(false)).not.toThrow();
    });
  });


  describe('showToast', () => {
    it('should create a toast component, mount it, and set a timeout to destroy it', () => {
      vi.useFakeTimers();
      const message = 'Test toast message';
      uiController.showToast(message, 'info', 3000);

      expect(ComponentMock).toHaveBeenCalledWith('div', expect.objectContaining({className: 'toast', textContent: `${EMOJI_INFO} ${message}`}));
      const toastInstanceCallArgs = ComponentMock.mock.calls.find(call => call[0] === 'div' && call[1]?.className === 'toast');
      expect(toastInstanceCallArgs).toBeDefined();
      const toastInstance = ComponentMock.mock.results[ComponentMock.mock.calls.indexOf(toastInstanceCallArgs)].value;

      expect(toastInstance.element.textContent).toBe(`${EMOJI_INFO} ${message}`);

      expect(uiController.toastContainer.add).toHaveBeenCalledWith(toastInstance);

      expect(toastInstance.element.classList.add).not.toHaveBeenCalledWith('visible');
      vi.advanceTimersByTime(10);
      expect(toastInstance.element.classList.add).toHaveBeenCalledWith('visible');

      vi.advanceTimersByTime(3000);
      expect(toastInstance.element.classList.remove).toHaveBeenCalledWith('visible');

      vi.advanceTimersByTime(300);
      expect(toastInstance.destroy).toHaveBeenCalled();
      vi.useRealTimers();
    });
     it.each([
            ['info', `var(--header-bg)`],
            ['success', `var(--success)`],
            ['warn', `var(--warning)`],
            ['error', `var(--danger)`],
            ['custom', `var(--header-bg)`],
        ])('should apply correct style for toast type %s', (type, expectedBg) => {
            uiController.showToast('A message', type);
            const toastCallArgs = ComponentMock.mock.calls.find(call => {
                return call[0] === 'div' &&
                       call[1]?.className === 'toast' &&
                       call[1]?.textContent?.includes('A message');
            });
            expect(toastCallArgs).toBeDefined();
            const toastInstance = ComponentMock.mock.results[ComponentMock.mock.calls.indexOf(toastCallArgs)].value;
            expect(toastInstance.element.style.background).toBe(expectedBg);
        });
  });
});
