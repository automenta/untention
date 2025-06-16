import { BaseModal } from './modal.js';
import { Component, Button } from '/ui/ui.js'; // Assuming Component and Button are in '../ui.js'

// Re-evaluating the submit button:
// The form component is created in getContent().
// The buttons are created in getFooterButtons().
// When BaseModal.show() calls ui.showModal, it passes the body (form) and buttons separately.
// The ui.showModal is responsible for rendering them.
// The most straightforward way for a submit button to work is if it's *within* the <form> tags
// or associated via the `form` attribute.
// If UIController.showModal renders buttons outside the form, `type="submit"` won't work automatically.

// Let's stick to `form.element.requestSubmit()`:
// The IdentityModal instance needs to hold onto the form component it creates.
// So, when getContent() is first called, its result should be stored in `this.formComponent`.
// Then getFooterButtons() can use `this.formComponent.element.requestSubmit()`.

// Final structure for IdentityModal:

class CleanIdentityModal extends BaseModal {
    constructor(app) {
        super('Manage Identity', app);
        this._formComponent = null; // Use a prefix to indicate internal use
    }

    getContent() {
        // Ensure content is created only once and cached.
        if (!this._formComponent) {
            this._formComponent = new Component('form', {
                // Add a unique class for easier selection if needed, though direct reference is better.
                className: 'identity-form',
                onsubmit: (e) => { // Arrow function for `this` context if needed, though not here.
                    e.preventDefault();
                    const formData = new FormData(e.target);
                    // Call the app's method to handle the logic.
                    // App.saveIdentity is responsible for hiding the modal on success/failure via app.ui.
                    this.app.identityService.saveIdentity(formData.get('privkey'));
                }
            });
            this._formComponent.add(
                new Component('label', { textContent: 'Secret Key (nsec/hex) or blank for new:' }),
                new Component('input', {
                    type: 'password',
                    name: 'privkey',
                    placeholder: 'nsec... or hex...',
                    // autofocus: true // Good UX
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
                onClick: () => this.hide() // BaseModal's hide method
            }),
            new Button({
                textContent: 'Load/Gen',
                className: 'primary', // Assuming a primary button style
                onClick: () => {
                    // Ensure content (and thus form) is created before trying to submit
                    if (!this._formComponent) {
                        this.getContent(); // Create it if not already
                    }
                    if (this._formComponent && this._formComponent.element) {
                        this._formComponent.element.requestSubmit();
                    } else {
                        // This should ideally not happen if getContent works correctly
                        console.error("IdentityModal: Form component not available for submission.");
                    }
                }
            })
        ];
    }
}

export { CleanIdentityModal as IdentityModal }; // Export with the desired name
