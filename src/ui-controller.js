import { Component, Button } from './ui.js'; // Added Button based on usage in _showRelaysModal and App's modal methods
import { Utils } from './utils.js'; // Utils is used by _showRelaysModal

export class UIController {
    constructor() {
        this.modal = this.createModal();
        this.toastContainer = new Component('div', {className: 'toast-container'}).mount(document.body);
    }

    createModal() {
        const modal = new Component('div', {className: 'modal-overlay'});
        modal.add(new Component('div', {className: 'modal-content'})).mount(document.body);
        modal.element.addEventListener('click', e => {
            if (e.target === modal.element) this.hideModal();
        });
        return modal;
    }

    showModal({title, body, buttons}) {
        const content = this.modal.element.querySelector('.modal-content');
        content.innerHTML = '';
        content.append(new Component('h3', {textContent: title}).element, body.element || body, new Component('div', {className: 'modal-buttons'}).add(...buttons.map(b => b.element)).element);
        this.modal.element.classList.add('visible');
    }

    hideModal() {
        this.modal.element.classList.remove('visible');
    }

    showToast(message, type = 'info', duration = 3000) {
        const t = new Component('div', {className: 'toast', textContent: message});
        t.element.style.background = `var(--${{
            error: 'danger',
            success: 'success',
            warn: 'warning'
        }[type] ?? 'header-bg'})`;
        this.toastContainer.add(t);
        setTimeout(() => t.element.classList.add('visible'), 10);
        setTimeout(() => {
            t.element.classList.remove('visible');
            setTimeout(() => t.destroy(), 300);
        }, duration);
    }

    setLoading(isLoading) {
        document.getElementById('loading-indicator')?.remove();
        if (isLoading) document.body.insertAdjacentHTML('beforeend', '<div id="loading-indicator">Loading...</div>');
    }
}
