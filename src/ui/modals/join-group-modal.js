import {BaseModal} from './modal.js';
import {Button, Component} from '../../ui.js';
import {Logger} from '@/logger.js';

export class JoinGroupModal extends BaseModal {
    constructor(app) {
        super('Join Group', app);
        this._formComponent = null;
    }

    getContent() {
        if (!this._formComponent) {
            this._formComponent = new Component('form', {
                className: 'join-group-form',
                onsubmit: (e) => {
                    e.preventDefault();
                    const formData = new FormData(e.target);
                    this.app.handleAction('join-group', formData);
                }
            });

            this._formComponent.add(
                new Component('label', { textContent: 'Group ID:' }),
                new Component('input', { name: 'id', placeholder: 'Enter group ID', required: true }),
                new Component('label', { textContent: 'Secret Key (Base64):' }),
                new Component('input', { name: 'key', placeholder: 'Enter secret key', required: true }),
                new Component('label', { textContent: 'Group Name (Optional, for display):' }),
                new Component('input', { name: 'name', placeholder: 'Enter group name' })
            );
        }
        return this._formComponent;
    }

    onShow() {
        const idInput = this._formComponent?.element.querySelector('input[name="id"]');
        if (idInput) {
            idInput.focus();
        }
    }

    getFooterButtons() {
        return [
            new Button({
                textContent: 'Cancel',
                className: 'secondary',
                onClick: () => this.hide()
            }),
            new Button({
                textContent: 'Join',
                className: 'primary',
                onClick: () => {
                    if (!this._formComponent) {
                        this.getContent();
                    }
                    if (this._formComponent && this._formComponent.element) {
                        const idInput = this._formComponent.element.querySelector('input[name="id"]');
                        const keyInput = this._formComponent.element.querySelector('input[name="key"]');
                        if (idInput && !idInput.value.trim()) {
                            this.app.ui.showToast('Group ID is required.', 'error');
                            idInput.focus();
                            return;
                        }
                        if (keyInput && !keyInput.value.trim()) {
                            this.app.ui.showToast('Secret Key is required.', 'error');
                            keyInput.focus();
                            return;
                        }
                        this._formComponent.element.requestSubmit();
                    } else {
                        Logger.error("JoinGroupModal: Form component not available for submission.");
                    }
                }
            })
        ];
    }
}
