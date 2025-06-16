import { BaseModal } from './modal.js';
import { Component, Button } from '/ui/ui.js';

export class CreateGroupModal extends BaseModal {
    constructor(app) {
        super('Create Group', app);
        this._formComponent = null;
    }

    getContent() {
        if (!this._formComponent) {
            this._formComponent = new Component('form', {
                className: 'create-group-form',
                onsubmit: (e) => {
                    e.preventDefault();
                    const formData = new FormData(e.target);
                    this.app.handleAction('create-group', formData);
                    // App.createGroupThought is responsible for hiding the modal.
                }
            });

            this._formComponent.add(
                new Component('label', { textContent: 'Group Name:' }),
                new Component('input', { name: 'name', placeholder: 'Enter group name', required: true })
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
                textContent: 'Create',
                className: 'primary',
                onClick: () => {
                    if (!this._formComponent) {
                        this.getContent();
                    }
                    if (this._formComponent && this._formComponent.element) {
                        // Basic client-side validation for required field
                        const nameInput = this._formComponent.element.querySelector('input[name="name"]');
                        if (nameInput && !nameInput.value.trim()) {
                            this.app.ui.showToast('Group name is required.', 'error');
                            nameInput.focus();
                            return;
                        }
                        this._formComponent.element.requestSubmit();
                    } else {
                        console.error("CreateGroupModal: Form component not available for submission.");
                    }
                }
            })
        ];
    }
}
