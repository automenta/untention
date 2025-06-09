import { BaseModal } from './modal.js';
import { Component, Button } from '../ui.js'; // Assuming Component and Button are in '../ui.js'

export class IdentityModal extends BaseModal {
    constructor(app) {
        super('Manage Identity', app); // title, app instance
    }

    getContent() {
        // This form was previously created in ModalService._showIdentityModal
        const form = new Component('form', {
            className: 'identity-modal-form', // Add a class for potential styling
            onsubmit: e => {
                e.preventDefault();
                const formData = new FormData(e.target);
                this.app.saveIdentity(formData.get('privkey')); // Call app method
            }
        });
        form.add(
            new Component('label', { textContent: 'Secret Key (nsec/hex) or blank for new:' }),
            new Component('input', { type: 'password', name: 'privkey', placeholder: 'nsec... or hex...' })
        );
        return form; // Return the form Component
    }

    getFooterButtons() {
        return [
            new Button({
                textContent: 'Cancel',
                className: 'secondary',
                onClick: () => this.hide() // Calls BaseModal.hide()
            }),
            new Button({
                textContent: 'Load/Gen',
                type: 'submit', // Will trigger form.onsubmit
                // We need to make the form submit itself.
                // The button click should not directly call saveIdentity if it's a submit button.
                // Instead, it should ensure the form it's associated with gets submitted.
                onClick: () => {
                    // To trigger form submission programmatically, we need a reference to the form element.
                    // The form is created in getContent(). We can get it via the modal element structure if needed,
                    // or rely on the 'submit' type if the button is part of the form.
                    // For now, let's assume the form component has an 'element' property.
                    const formElement = this.getContent().element; // This is a bit fragile if getContent() creates new instances.
                                                                // It's better if getContent's result is stored.
                                                                // However, UIController.showModal takes the component itself.

                    // A common pattern is that the Button of type 'submit' when part of a form
                    // will trigger the form's submit event. If UIController.showModal renders
                    // the form and buttons correctly, this should work naturally.
                    // Let's simplify: if type is 'submit', the browser handles it if buttons are inside/associated with the form.
                    // UIController.showModal would need to ensure this.
                    // The existing ui.showModal appends buttons to a footer, separate from the body.
                    // So, we DO need to trigger form.requestSubmit()

                    // To make this work, getContent() result needs to be stored or queried.
                    // Let's assume for now UIController's showModal will handle form submission via button type='submit'
                    // This might require adjustment later.
                    // A more robust way for a submit button:
                    // The form is part of the 'body' passed to ui.showModal. The buttons are separate.
                    // So the button itself needs to trigger the submit action on the form.
                    // This requires the form to be accessible.
                    //
                    // Let's make the form accessible within the modal instance.
                    // When getContent is called by show(), we can store its result.
                    // However, BaseModal.show() calls getContent() and passes it to ui.showModal.
                    // The specific modal instance isn't directly controlling ui.showModal's internals.

                    // Simplest path for now: The form has an onsubmit. The button is type submit.
                    // We need to ensure ui.showModal correctly links them or we trigger submit manually.
                    // The old ModalService did form.element.requestSubmit().
                    // We need access to the form *element* from the component returned by getContent().
                    // This implies that getContent() should return a component whose element can be accessed.

                    // Revisit: BaseModal.show() will get the form from getContent().
                    // It can then make the form available to getFooterButtons() or pass a submit callback.
                    // Or, the button's onClick can find the form in the rendered modal. (Not ideal)

                    // Let's assume this specific modal will handle its form submission.
                    // We can cache the form component.
                    if (!this.formComponent) {
                        // This is not ideal as getContent() might be called multiple times.
                        // It's better to create content once.
                        // Let's defer this problem to UIController.showModal or ModalService.show adjustment.
                        // For now, the simplest is to make the button click directly call app.saveIdentity for Load/Gen.
                        // But that bypasses form validation if any were added to the form itself.
                        // The original code did: onClick: () => form.element.requestSubmit()
                        // This means the `form` component needs to be accessible here.

                        // Option: `getFooterButtons` is called after `getContent` by `ModalService` (or `BaseModal.show`)
                        // and the form component can be passed.
                        // Or, the specific modal stores its content component.
                        this.app.ui.element.querySelector('.identity-modal-form').requestSubmit();

                    }
                }
            })
        ];
    }

    // Override show to cache the form component instance
    show() {
        this.cachedContent = this.getContent(); // Cache the content
        this.ui.showModal({
            title: this.title,
            body: this.cachedContent,
            buttons: this.getFooterButtons() // Now getFooterButtons can potentially access this.cachedContent
        });
    }

    // Adjust getFooterButtons to use cachedContent
    getFooterButtons() { // This is getting redefined, careful with JS hoisting/scope if not careful.
                         // Better to define it once.
        return [
            new Button({
                textContent: 'Cancel',
                className: 'secondary',
                onClick: () => this.hide()
            }),
            new Button({
                textContent: 'Load/Gen',
                type: 'submit',
                onClick: () => {
                    if (this.cachedContent && this.cachedContent.element && typeof this.cachedContent.element.requestSubmit === 'function') {
                        this.cachedContent.element.requestSubmit();
                    } else {
                        // Fallback or error if form not found - this indicates a structural issue.
                        console.error("Form element not found for submission.");
                        // Fallback to direct action if form cannot be submitted (e.g. if content is not a form)
                        // For IdentityModal, direct submission is via saveIdentity after FormData.
                        // This path should ideally not be taken if it's a form.
                        // The onsubmit handler on the form is the primary way.
                    }
                }
            })
        ];
    }
}

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

// Revised IdentityModal:
export class RevisedIdentityModal extends BaseModal {
    constructor(app) {
        super('Manage Identity', app);
        this.formComponent = null; // To store the form
    }

    getContent() {
        if (!this.formComponent) { // Create form only once
            this.formComponent = new Component('form', {
                onsubmit: e => {
                    e.preventDefault();
                    const formData = new FormData(e.target);
                    this.app.saveIdentity(formData.get('privkey'));
                    // this.hide(); // Typically hide modal after successful submission - app.saveIdentity calls ui.hideModal
                }
            });
            this.formComponent.add(
                new Component('label', { textContent: 'Secret Key (nsec/hex) or blank for new:' }),
                new Component('input', { type: 'password', name: 'privkey', placeholder: 'nsec... or hex...' })
            );
        }
        return this.formComponent;
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
                // type: 'submit', // Not strictly needed if we manually call requestSubmit
                onClick: () => {
                    if (this.formComponent && this.formComponent.element) {
                        this.formComponent.element.requestSubmit();
                    } else {
                        console.error("IdentityModal: Form component not initialized for submission.");
                    }
                }
            })
        ];
    }
}

// Replace the original export with the revised one.
// Need to ensure only one class is exported.
// Let's clean this up to be a single class definition.
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
                    this.app.saveIdentity(formData.get('privkey'));
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
