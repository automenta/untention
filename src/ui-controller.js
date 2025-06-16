import {Component} from './ui.js';
// Utils file is no longer directly used here after its disassembly.
// Specific utilities would be imported if needed. For now, none are.

// Constants for Toast display
const DEFAULT_TOAST_DURATION = 3000;
const EMOJI_INFO = 'ℹ️';
const EMOJI_SUCCESS = '✅';
const EMOJI_WARN = '⚠️';
const EMOJI_ERROR = '❌';

// Constant for Loading Indicator
const LOADING_EMOJI = '⏳';

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

    showToast(message, type = 'info', duration = DEFAULT_TOAST_DURATION) {
        const emojiMap = {
            info: EMOJI_INFO,
            success: EMOJI_SUCCESS,
            warn: EMOJI_WARN,
            error: EMOJI_ERROR,
        };
        const selectedEmoji = emojiMap[type] || EMOJI_INFO; // Default to info emoji
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
            document.body.insertAdjacentHTML('beforeend', `<div id="loading-indicator">${LOADING_EMOJI} Loading...</div>`);
        }
    }
}
