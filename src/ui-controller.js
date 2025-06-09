import { Component, Button } from './ui.js';
import { Utils } from './utils.js';

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
        const modalContent = this.modal.element.querySelector('.modal-content');
        modalContent.innerHTML = '';

        const titleElement = new Component('h3', {textContent: title}).element;
        const bodyElement = body.element || body;
        const buttonsContainer = new Component('div', {className: 'modal-buttons'});
        buttons.forEach(button => buttonsContainer.add(button));

        modalContent.append(titleElement, bodyElement, buttonsContainer.element);
        this.modal.element.classList.add('visible');
    }

    hideModal() {
        this.modal.element.classList.remove('visible');
    }

    showToast(message, type = 'info', duration = 3000) {
        const emojiMap = {
            info: 'ℹ️',
            success: '✅',
            warn: '⚠️',
            error: '❌',
        };
        const selectedEmoji = emojiMap[type] || emojiMap.info;
        const fullMessage = `${selectedEmoji} ${message}`;

        const toast = new Component('div', {className: 'toast', textContent: fullMessage});
        const toastTypeClass = {error: 'danger', success: 'success', warn: 'warning'}[type] || 'info';
        toast.element.style.background = `var(--${toastTypeClass === 'info' ? 'header-bg' : toastTypeClass})`;
        this.toastContainer.add(toast);
        setTimeout(() => toast.element.classList.add('visible'), 10);
        setTimeout(() => {
            toast.element.classList.remove('visible');
            setTimeout(() => toast.destroy(), 300);
        }, duration);
    }

    setLoading(isLoading) {
        document.getElementById('loading-indicator')?.remove();
        if (isLoading) {
            const loadingEmoji = '⏳';
            document.body.insertAdjacentHTML('beforeend', `<div id="loading-indicator">${loadingEmoji} Loading...</div>`);
        }
    }
}
