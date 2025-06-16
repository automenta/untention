import {BaseModal} from './modal.js';
import {Button, Component} from '../../ui.js';
import {Logger} from '@/logger.js';

export class ProfileModal extends BaseModal {
    constructor(app, profileData = {}) {
        super('Edit Profile', app);
        this.profileData = profileData;
        this._formComponent = null;
    }

    getContent() {
        if (!this._formComponent) {
            this._formComponent = new Component('form', {
                className: 'profile-form',
                onsubmit: (e) => {
                    e.preventDefault();
                    const formData = new FormData(e.target);
                    this.app.handleAction('update-profile', formData);
                }
            });

            this._formComponent.add(
                new Component('label', { textContent: 'Name:' }),
                new Component('input', { name: 'name', value: this.profileData.name ?? '' }),
                new Component('label', { textContent: 'Picture URL:' }),
                new Component('input', { name: 'picture', value: this.profileData.picture ?? '', placeholder: 'https://...' }),
                new Component('label', { textContent: 'NIP-05 Identifier:' }),
                new Component('input', { name: 'nip05', value: this.profileData.nip05 ?? '', placeholder: 'name@domain.com' })
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
                textContent: 'Save',
                className: 'primary',
                onClick: () => {
                    if (!this._formComponent) {
                        this.getContent();
                    }
                    if (this._formComponent && this._formComponent.element) {
                        this._formComponent.element.requestSubmit();
                    } else {
                        Logger.error("ProfileModal: Form component not available for submission.");
                    }
                }
            })
        ];
    }
}
