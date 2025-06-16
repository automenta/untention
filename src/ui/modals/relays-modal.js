import {BaseModal} from './modal.js';
import {Button, Component} from '../../ui.js';
import {escapeHtml} from '/utils/ui-utils.js';
import {validateRelayUrl} from '/utils/nostr-utils.js';

export class RelaysModal extends BaseModal {
    constructor(app, relaysList) {
        super('Manage Relays', app);
        this.relaysList = relaysList;
        this._contentComponent = null;
    }

    getContent() {
        if (!this._contentComponent) {
            this._contentComponent = new Component('div', { className: 'relays-modal-content' });

            const list = new Component('ul', {
                className: 'relays-list',
                style: {
                    listStyle: 'none',
                    padding: 0,
                    maxHeight: '150px',
                    overflowY: 'auto',
                    borderBottom: '1px solid var(--border)',
                    paddingBottom: '10px',
                    marginBottom: '10px'
                }
            });

            (this.relaysList || []).forEach(url => {
                const listItem = new Component('li', {
                    style: {
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '6px 0'
                    }
                });
                listItem.add(new Component('span', {
                    textContent: escapeHtml(url),
                    style: {
                        flex: 1,
                        marginLeft: '8px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                    }
                }));
                listItem.add(new Button({
                    textContent: 'Remove',
                    className: 'danger small',
                    onClick: () => {
                        this.app.handleAction('remove-relay', url);
                    }
                }));
                list.add(listItem);
            });
            this._contentComponent.add(list);

            const form = new Component('form', {
                className: 'add-relay-form',
                onsubmit: (e) => {
                    e.preventDefault();
                    const formData = new FormData(e.target);
                    this.app.handleAction('add-relay', formData);
                    e.target.reset();
                }
            });
            const urlInputComponent = new Component('input', { name: 'url', placeholder: 'wss://relay.example.com', required: true });
            const addButtonComponent = new Button({ textContent: 'Add', type: 'submit', className: 'primary' });
            const errorSpan = new Component('span', { className: 'error-message', style: { color: 'var(--danger)', fontSize: '12px', display: 'block', minHeight: '1em', marginTop: '4px' } });
            errorSpan.element.textContent = ' ';

            const validateAndSetButton = () => {
                const urlValue = urlInputComponent.element.value.trim();
                if (!urlValue) {
                    urlInputComponent.element.classList.remove('invalid');
                    errorSpan.element.textContent = ' ';
                    addButtonComponent.element.disabled = true;
                    return;
                }
                const isValid = validateRelayUrl(urlValue);
                if (isValid) {
                    urlInputComponent.element.classList.remove('invalid');
                    errorSpan.element.textContent = ' ';
                    addButtonComponent.element.disabled = false;
                } else {
                    urlInputComponent.element.classList.add('invalid');
                    errorSpan.textContent = 'Invalid relay URL (must start with wss://)';
                    addButtonComponent.element.disabled = true;
                }
            };

            urlInputComponent.element.addEventListener('input', validateAndSetButton);

            validateAndSetButton();

            form.add(
                new Component('label', { textContent: 'Add Relay:' }),
                urlInputComponent,
                errorSpan,
                addButtonComponent
            );
            this._contentComponent.add(form);
            this.urlInputComponent = urlInputComponent;
        }
        return this._contentComponent;
    }

    onShow() {
        if (this.urlInputComponent && this.urlInputComponent.element) {
            this.urlInputComponent.element.focus();
        }
    }

    getFooterButtons() {
        return [
            new Button({
                textContent: 'Close',
                className: 'secondary',
                onClick: () => this.hide()
            })
        ];
    }
}
