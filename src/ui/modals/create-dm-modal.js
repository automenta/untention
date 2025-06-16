import Quill from 'quill';
import {BaseModal} from './modal.js';
import {Button, Component} from '/ui/ui.js';

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
                    const messageContent = this._quillEditor ? this._quillEditor.root.innerHTML : '';
                    formData.append('message', messageContent);
                    this.app.handleAction('create-dm', formData);
                }
            });

            const pubkeyInputComponent = new Component('input', { name: 'pubkey', placeholder: 'npub... or hex...', required: true });
            const errorSpan = new Component('span', { className: 'error-message', style: { color: 'var(--danger)', fontSize: '12px', display: 'block', minHeight: '1em', marginTop: '4px' } });
            errorSpan.element.textContent = ' ';

            this._formComponent.add(
                new Component('label', { textContent: "Recipient's Public Key (npub or hex):" }),
                pubkeyInputComponent,
                errorSpan,
                new Component('label', { textContent: 'Message:' }),
                new Component('div', { id: 'message-editor' })
            );

            this.pubkeyInputComponent = pubkeyInputComponent;
            this.pubkeyErrorSpan = errorSpan;

            this.pubkeyInputComponent.element.addEventListener('input', () => this.validatePubkeyInput());
            this.validatePubkeyInput();
        }
        return this._formComponent;
    }

    onShow() {
        if (!this._quillEditor && this._formComponent && this._formComponent.element) {
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
        if (this.pubkeyInputComponent && this.pubkeyInputComponent.element) {
            this.pubkeyInputComponent.element.focus();
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
                textContent: 'Start DM',
                className: 'primary',
                onClick: () => {
                    if (this.validatePubkeyInput()) {
                        const messageContent = this._quillEditor ? this._quillEditor.getText().trim() : '';
                        if (!messageContent) {
                            this.app.ui.showToast("Message content cannot be empty.", 'error');
                            if (this._quillEditor) this._quillEditor.focus();
                            return;
                        }

                        if (this._formComponent && this._formComponent.element) {
                            this._formComponent.element.requestSubmit();
                        } else {
                            console.error("CreateDmModal: Form component not available for submission.");
                        }
                    } else {
                        if (this.pubkeyInputComponent && this.pubkeyInputComponent.element) {
                            this.pubkeyInputComponent.element.focus();
                        }
                    }
                }
            })
        ];
    }

    validatePubkeyInput() {
        if (!this.pubkeyInputComponent || !this.pubkeyErrorSpan) {
            return false;
        }

        const inputElement = this.pubkeyInputComponent.element;
        const errorElement = this.pubkeyErrorSpan.element;
        const value = inputElement.value.trim();

        if (!value) {
            inputElement.classList.remove('invalid');
            errorElement.textContent = ' ';
            return false;
        }

        let isValid = false;
        let decodedNpub = null;
        if (value.startsWith('npub1')) {
            try {
                decodedNpub = NostrTools.nip19.decode(value);
                if (decodedNpub && decodedNpub.type === 'npub') {
                    isValid = true;
                }
            } catch (e) {
            }
        }

        if (!isValid) {
            if (/^[0-9a-fA-F]{64}$/.test(value)) {
                isValid = true;
            }
        }

        if (isValid) {
            inputElement.classList.remove('invalid');
            errorElement.textContent = ' ';
        } else {
            inputElement.classList.add('invalid');
            errorElement.textContent = 'Invalid pubkey (must be npub or 64-char hex).';
        }
        return isValid;
    }
}
