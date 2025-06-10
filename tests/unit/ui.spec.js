import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Component, Button } from '../../src/ui'; // Adjust path as necessary

describe('Component', () => {
    let parentElement;

    beforeEach(() => {
        parentElement = document.createElement('div');
        document.body.appendChild(parentElement);
    });

    afterEach(() => {
        document.body.removeChild(parentElement);
        parentElement = null;
    });

    describe('constructor', () => {
        it('should create an element with the correct tag', () => {
            const component = new Component('div');
            expect(component.element.tagName).toBe('DIV');
        });

        it('should assign an ID if provided', () => {
            const component = new Component('p', { id: 'test-id' });
            expect(component.element.id).toBe('test-id');
        });

        it('should assign a className if provided', () => {
            const component = new Component('span', { className: 'test-class' });
            expect(component.element.className).toBe('test-class');
        });

        it('should set other properties', () => {
            const component = new Component('h1', { textContent: 'Hello World' });
            expect(component.element.textContent).toBe('Hello World');
        });
    });

    describe('add() method', () => {
        it('should append child Components correctly', () => {
            const parentComp = new Component('div');
            const childComp1 = new Component('p');
            const childComp2 = new Component('span');
            parentComp.add(childComp1, childComp2);
            expect(parentComp.element.children.length).toBe(2);
            expect(parentComp.element.children[0]).toBe(childComp1.element);
            expect(parentComp.element.children[1]).toBe(childComp2.element);
        });

        it('should append native DOM elements correctly', () => {
            const parentComp = new Component('div');
            const childEl1 = document.createElement('p');
            const childEl2 = document.createElement('span');
            parentComp.add(childEl1, childEl2);
            expect(parentComp.element.children.length).toBe(2);
            expect(parentComp.element.children[0]).toBe(childEl1);
            expect(parentComp.element.children[1]).toBe(childEl2);
        });
    });

    describe('setContent() method', () => {
        it('should clear previous content', () => {
            const component = new Component('div', { textContent: 'Initial' });
            component.setContent('New');
            expect(component.element.textContent).toBe('New');
        });

        it('should set HTML string content', () => {
            const component = new Component('div');
            component.setContent('<span>Test</span>');
            expect(component.element.innerHTML).toBe('<span>Test</span>');
        });

        it('should append a child Component', () => {
            const component = new Component('div');
            const childComp = new Component('p', { textContent: 'Child' });
            component.setContent(childComp);
            expect(component.element.children.length).toBe(1);
            expect(component.element.children[0]).toBe(childComp.element);
            expect(component.element.textContent).toBe('Child');
        });

        it('should clear content if null or undefined is passed', () => {
            const component = new Component('div', { textContent: 'Initial' });
            component.setContent(null);
            expect(component.element.innerHTML).toBe('');
            component.element.textContent = 'Initial Again';
            component.setContent(undefined);
            expect(component.element.innerHTML).toBe('');
        });
    });

    describe('mount() method', () => {
        it('should append the component element to a parent DOM element', () => {
            const component = new Component('div');
            component.mount(parentElement);
            expect(parentElement.children.length).toBe(1);
            expect(parentElement.children[0]).toBe(component.element);
        });

        it('should append to a parent Component element', () => {
            const parentComp = new Component('div');
            parentComp.mount(parentElement); // Mount parent to ensure it's in the DOM for some checks
            const childComp = new Component('p');
            childComp.mount(parentComp);
            expect(parentComp.element.children.length).toBe(1);
            expect(parentComp.element.children[0]).toBe(childComp.element);
        });
    });

    describe('show() method', () => {
        it('should add "hidden" class when visible is false', () => {
            const component = new Component('div');
            component.show(false);
            expect(component.element.classList.contains('hidden')).toBe(true);
        });

        it('should remove "hidden" class when visible is true', () => {
            const component = new Component('div');
            component.element.classList.add('hidden');
            component.show(true);
            expect(component.element.classList.contains('hidden')).toBe(false);
        });

        it('should remove "hidden" class by default', () => {
            const component = new Component('div');
            component.element.classList.add('hidden');
            component.show();
            expect(component.element.classList.contains('hidden')).toBe(false);
        });
    });

    describe('destroy() method', () => {
        it('should remove the element from its parent', () => {
            const component = new Component('div');
            component.mount(parentElement);
            expect(parentElement.contains(component.element)).toBe(true);
            component.destroy();
            expect(parentElement.contains(component.element)).toBe(false);
        });
    });
});

describe('Button', () => {
    let parentElement;

    beforeEach(() => {
        parentElement = document.createElement('div');
        document.body.appendChild(parentElement);
    });

    afterEach(() => {
        document.body.removeChild(parentElement);
        parentElement = null;
    });

    describe('constructor', () => {
        it('should create a "button" element', () => {
            const button = new Button({});
            expect(button.element.tagName).toBe('BUTTON');
        });

        it('should assign properties like Component', () => {
            const button = new Button({ id: 'my-button', className: 'btn', textContent: 'Click Me' });
            expect(button.element.id).toBe('my-button');
            expect(button.element.className).toBe('btn');
            expect(button.element.textContent).toBe('Click Me');
        });

        it('should attach "click" event listener if onClick is provided', () => {
            const handleClick = vi.fn();
            const button = new Button({ onClick: handleClick });
            button.mount(parentElement); // Element must be in DOM for events to be dispatched by some test utils
            button.element.click();
            expect(handleClick).toHaveBeenCalledTimes(1);
        });
    });

    describe('setEnabled() method', () => {
        it('should set the "disabled" attribute when false', () => {
            const button = new Button({});
            button.setEnabled(false);
            expect(button.element.disabled).toBe(true);
        });

        it('should remove the "disabled" attribute when true', () => {
            const button = new Button({});
            button.element.disabled = true;
            button.setEnabled(true);
            expect(button.element.disabled).toBe(false);
        });
    });
});
