import {BaseModal} from './modal.js';
import {Button, Component} from '../../ui.js';
import {Logger} from '@/logger.js';

export class IdentityModal extends BaseModal {
    constructor(app) {
        super('Manage Identity', app);
        this._formComponent = null;
    }

    getContent() {
        if (!this._formComponent) {
            this._formComponent = new Component('form', {
                className: 'identity-form',
                onsubmit: (e) => {
                    e.preventDefault();
                    const formData = new FormData(e.target);
                    this.app.identityService.saveIdentity(formData.get('privkey'));
                }
            });
            this._formComponent.add(
                new Component('label', { textContent: 'Secret Key (nsec/hex) or blank for new:' }),
                new Component('input', {
                    type: 'password',
                    name: 'privkey',
                    placeholder: 'nsec... or hex...',
                    autofocus: true
                })
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
                textContent: 'Load/Gen',
                className: 'primary',
                onClick: () => {
                    if (!this._formComponent) {
                        this.getContent();
                    }
                    if (this._formComponent && this._formComponent.element) {
                        this._formComponent.element.requestSubmit();
                    } else {
                        Logger.error("IdentityModal: Form component not available for submission.");
                    }
                }
            })
        ];
    }
}
