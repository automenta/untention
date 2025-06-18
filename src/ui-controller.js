import {Component} from './ui.js';

const DEFAULT_TOAST_DURATION = 3000;
const EMOJI_INFO = 'ℹ️';
const EMOJI_SUCCESS = '✅';
const EMOJI_WARN = '⚠️';
const EMOJI_ERROR = '❌';

const LOADING_EMOJI = '⏳';

export class UIController {
    constructor() {
        this.modal = this.createModal();
        this.toastContainer = new Component('div', {className: 'toast-container'}).mount(document.body);
        this.statusBarElement = null;
        this.loadingIndicator = null;
    }

    setStatusBarElement(element) {
        this.statusBarElement = element;
    }

    updateStatusBar(status, count, message) {
        if (!this.statusBarElement) return;

        const statusMessage = message;
        const statusClass = status;

        this.statusBarElement.innerHTML = `<div class="relay-status-icon ${statusClass}"></div><span>${count} Relays</span><span style="margin-left: auto;">${statusMessage}</span>`;
    }

    createModal() {
        const modal = new Component('div', {className: 'modal-overlay'});
        modal.add(new Component('div', {className: 'modal-content'})).mount(document.body);
        modal.element.addEventListener('click', e => {
            if (e.target === modal.element) this.hideModal();
        });
        return modal;
    }

    showModal({title, body, buttons, onMounted}) {
        const modalContent = this.modal.querySelector('.modal-content'); // Use instance method
        if (!modalContent) {
             console.error("UIController: modal.querySelector('.modal-content') returned null!");
             return;
        }
        modalContent.innerHTML = '';

        const titleElement = new Component('h3', {textContent: title}).element;
        const bodyToAppend = body.element || body; // Handle native DOM element or Component instance
        const buttonsContainer = new Component('div', {className: 'modal-buttons'});

        if (buttons && buttons.length > 0) {
            buttons.forEach(button => buttonsContainer.add(button));
        } else {
            // Add a default "Okay" or "Close" button if none are provided
            const defaultButton = new Component('button', { // Using Component directly as Button mock is for tests
                textContent: 'Okay',
                className: 'modal-close-button secondary' // Added secondary for styling
            });
            defaultButton.element.addEventListener('click', () => this.hideModal());
            buttonsContainer.add(defaultButton);
        }

        modalContent.append(titleElement, bodyToAppend, buttonsContainer.element);
        this.modal.element.classList.add('visible');

        if (onMounted && typeof onMounted === 'function') {
            requestAnimationFrame(() => onMounted());
        }
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
        const selectedEmoji = emojiMap[type] || EMOJI_INFO;
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
        if (isLoading) {
            if (!this.loadingIndicator) {
                this.loadingIndicator = new Component('div', {
                    id: 'loading-indicator',
                    textContent: `${LOADING_EMOJI} Loading...`
                    // Consider adding a specific class for styling if needed, e.g., 'loading-overlay'
                });
                // Mount should happen only once when created, or if it was explicitly unmounted
                this.loadingIndicator.mount(document.body);
            }
            this.loadingIndicator.show(true);
            // Ensure it's mounted if it was somehow unmounted (though destroy should handle removal)
            // However, typically mount is only called once. If show(true) also re-appends, this might be redundant.
            // For now, assuming show() doesn't re-mount and it was mounted on creation.
        } else {
            if (this.loadingIndicator) {
                this.loadingIndicator.show(false); // Ensure it's hidden before destroying
                this.loadingIndicator.destroy();   // Use component's destroy method
                this.loadingIndicator = null;      // Release the reference
            }
        }
    }
}
