import Quill from 'quill';
import { BaseModal } from './modal.js';
import { Component, Button } from '../ui.js';

export class CreateDmModal extends BaseModal {
    constructor(app) {
        super('New Direct Message', app);
        this._formComponent = null;
        this._quillEditor = null;
    }

    getContent() {
        if (!this._formComponent) {
            this._formComponent = new Component('form', {
                className: 'create-dm-form',
                onsubmit: (e) => {
                    e.preventDefault();
                    const formData = new FormData(e.target);
                    // We'll get the message content from Quill separately
                    const messageContent = this._quillEditor ? this._quillEditor.root.innerHTML : '';
                    formData.append('message', messageContent);
                    this.app.handleAction('create-dm', formData);
                    // App.createDmThought is responsible for hiding the modal.
                }
            });

            this._formComponent.add(
                new Component('label', { textContent: "Recipient's Public Key (npub or hex):" }),
                new Component('input', { name: 'pubkey', placeholder: 'npub... or hex...', required: true }),
                new Component('label', { textContent: 'Message:' }),
                new Component('div', { id: 'message-editor' }) // This will be our Quill editor container
            );

            // Initialize Quill after the component is added to the DOM (or at least after element is created)
            // We need to ensure the element exists before initializing Quill.
            // A slight delay or a more robust lifecycle hook might be needed if issues arise.
            // For now, let's assume the element is available after `add`.
            const editorElement = this._formComponent.element.querySelector('#message-editor');
            if (editorElement) {
                this._quillEditor = new Quill(editorElement, {
                    theme: 'snow',
                    modules: {
                        toolbar: [['bold', 'italic', 'code-block']]
                    }
                });
            } else {
                console.error("CreateDmModal: Could not find #message-editor element to initialize Quill.");
            }
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

                        // Check if Quill editor has content
                        const messageContent = this._quillEditor ? this._quillEditor.getText().trim() : '';
                        if (!messageContent) {
                            this.app.ui.showToast("Message content cannot be empty.", 'error');
                            // Optionally, focus the editor
                            if (this._quillEditor) {
                                this._quillEditor.focus();
                            }
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
