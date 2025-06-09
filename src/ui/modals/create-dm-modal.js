import { BaseModal } from './modal.js';
import { Component, Button } from '../ui.js';

export class CreateDmModal extends BaseModal {
    constructor(app) {
        super('New Direct Message', app);
        this._formComponent = null;
    }

    getContent() {
        if (!this._formComponent) {
            this._formComponent = new Component('form', {
                className: 'create-dm-form',
                onsubmit: (e) => {
                    e.preventDefault();
                    const formData = new FormData(e.target);
                    this.app.handleAction('create-dm', formData);
                    // App.createDmThought is responsible for hiding the modal.
                }
            });

            this._formComponent.add(
                new Component('label', { textContent: "Recipient's Public Key (npub or hex):" }),
                new Component('input', { name: 'pubkey', placeholder: 'npub... or hex...', required: true })
            );
        }
        return this._formComponent;
    }

    getFooterButtons() {
        return [
            new Button({
                textContent: 'Cancel',
                className: 'secondary',
                onClick: () => this.hide()
            }),
            new Button({
                textContent: 'Start DM',
                className: 'primary',
                onClick: () => {
                    if (!this._formComponent) {
                        this.getContent();
                    }
                    if (this._formComponent && this._formComponent.element) {
                        const pubkeyInput = this._formComponent.element.querySelector('input[name="pubkey"]');
                        if (pubkeyInput && !pubkeyInput.value.trim()) {
                            this.app.ui.showToast("Recipient's Public Key is required.", 'error');
                            pubkeyInput.focus();
                            return;
                        }
                        this._formComponent.element.requestSubmit();
                    } else {
                        console.error("CreateDmModal: Form component not available for submission.");
                    }
                }
            })
        ];
    }
}
