import {BaseModal} from './modal.js';
import {Button, Component} from '../../ui.js';

export class GroupInfoModal extends BaseModal {
    constructor(app, groupData) {
        super('Group Info', app);
        this.groupData = groupData; // { name, id, secretKey }
        this._contentComponent = null;
    }

    getContent() {
        if (!this._contentComponent) {
            this._contentComponent = new Component('div', { className: 'group-info-content' });

            if (!this.groupData || !this.groupData.id) {
                this._contentComponent.add(new Component('p', { textContent: 'Group data is not available.' }));
                return this.contentComponent;
            }

            // Using a "form" for consistent layout, but all fields are read-only.
            const formLayout = new Component('form');

            formLayout.add(
                new Component('label', { textContent: 'Group Name:' }),
                new Component('input', { name: 'name', value: this.groupData.name, readOnly: true }),
                new Component('label', { textContent: 'Group ID:' }),
                new Component('input', { name: 'id', value: this.groupData.id, readOnly: true }),
                new Component('label', { textContent: 'Secret Key (Base64):' }),
                new Component('input', { name: 'key', value: this.groupData.secretKey, readOnly: true, type: 'text' })
            );
            this._contentComponent.add(formLayout);
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
