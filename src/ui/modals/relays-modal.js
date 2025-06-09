import { BaseModal } from './modal.js';
import { Component, Button } from '../ui.js';
import { Utils } from '../../utils.js'; // Import Utils

export class RelaysModal extends BaseModal {
    constructor(app, relaysList) {
        super('Manage Relays', app);
        this.relaysList = relaysList; // Array of relay URLs
        this._contentComponent = null;
        // No form component to cache for the entire modal in the same way,
        // as it has a list and a separate form.
    }

    getContent() {
        if (!this._contentComponent) {
            this._contentComponent = new Component('div', { className: 'relays-modal-content' });

            // List of current relays
            const list = new Component('ul', {
                className: 'relays-list', // For styling
                style: {
                    listStyle: 'none',
                    padding: 0,
                    maxHeight: '150px', // As before
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
                    textContent: Utils.escapeHtml(url), // Use Utils.escapeHtml
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
                    className: 'danger small', // Added 'small' for potentially smaller button
                    onClick: () => {
                        // Confirmation is handled in App.handleAction
                        this.app.handleAction('remove-relay', url);
                        // This modal might need to refresh its content if a relay is removed.
                        // For now, App.updateRelays re-renders UI which should close/reopen modal or update list.
                        // A more direct refresh would be:
                        // this.relaysList = this.app.dataStore.state.relays; this._contentComponent = null; this.show();
                        // However, the App's state management should ideally drive this.
                        // The current App.updateRelays calls nostr.connect() and shows a toast.
                        // ModalService.show() will be called again by App if needed.
                        // For simplicity here, removing a relay will require the modal to be re-opened to see the change,
                        // or rely on the main app to re-render UI that includes re-calling modalService.show('relays').
                        // The original _showRelaysModal in ModalService rebuilt itself each time.
                        // This is what will happen if ModalService.show('relays', newRelaysList) is called.
                    }
                }));
                list.add(listItem);
            });
            this._contentComponent.add(list);

            // Form for adding a new relay
            const form = new Component('form', {
                className: 'add-relay-form',
                onsubmit: (e) => {
                    e.preventDefault();
                    const formData = new FormData(e.target);
                    this.app.handleAction('add-relay', formData);
                    e.target.reset(); // Reset form after submission
                    // Similar to remove, modal might need to be refreshed/reopened to see change.
                }
            });
            form.add(
                new Component('label', { textContent: 'Add Relay:' }),
                new Component('input', { name: 'url', placeholder: 'wss://...', required: true }),
                new Button({ textContent: 'Add', type: 'submit', className: 'primary' }) // Added primary class
            );
            this._contentComponent.add(form);
        }
        return this._contentComponent;
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
