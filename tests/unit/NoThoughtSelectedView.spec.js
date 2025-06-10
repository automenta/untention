import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NoThoughtSelectedView } from '../../src/components.js';
// Component might not be needed if we are not testing Component base class functionality here
// import { Component } from '../../src/ui.js';

describe('NoThoughtSelectedView', () => {
    let view;

    beforeEach(() => {
        view = new NoThoughtSelectedView();
        document.body.appendChild(view.element);
    });

    afterEach(() => {
        view.destroy(); // Assumes Component has a destroy method that removes the element
        // Or manually: document.body.removeChild(view.element);
    });

    it('should render the welcome message and structure', () => {
        const content = view.element.querySelector('.no-thought-content');
        expect(content).not.toBeNull();

        const h2 = content.querySelector('h2');
        expect(h2).not.toBeNull();
        expect(h2.textContent).toContain('Welcome to Notention!');

        const paragraphs = content.querySelectorAll('p');
        expect(paragraphs.length).toBe(2);
        expect(paragraphs[0].textContent).toContain('Select an item from the sidebar to view it here.');
        expect(paragraphs[1].textContent).toContain('New? Try creating a Note, starting a DM, or making a Group');
    });

    it('should have the correct wrapper class', () => {
        expect(view.element.classList.contains('no-thought-content-wrapper')).toBe(true);
    });
});
