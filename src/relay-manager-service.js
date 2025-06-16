import { Logger } from '/logger.js';

export class RelayManagerService {
    constructor(dataStore, nostr, ui) {
        this.dataStore = dataStore;
        this.nostr = nostr;
        this.ui = ui;
    }

    async addRelay(url) {
        // Logic from App._appHandleAddRelay
        this.ui.hideModal();
        try {
            await this.dataStore.addRelay(url);
            this.nostr.connect();
            this.ui.showToast('Relay added. Reconnecting...', 'info');
        } catch (e) {
            Logger.errorWithContext('RelayManagerService', 'Error adding relay:', e);
            this.ui.showToast(`Failed to add relay: ${e.message || 'An unexpected error occurred.'}`, 'error');
        }
    }

    async removeRelay(url) {
        // Logic from App._appHandleRemoveRelay
        if (confirm(`Are you sure you want to remove the relay: ${url}?`)) {
            this.ui.hideModal();
            try {
                await this.dataStore.removeRelay(url);
                this.nostr.connect();
                this.ui.showToast('Relay removed. Reconnecting...', 'info');
            } catch (e) {
                Logger.error('Error removing relay:', e);
                this.ui.showToast(`Failed to remove relay: ${e.message || 'An unexpected error occurred.'}`, 'error');
            }
        }
    }

    async updateRelaysList(newRelays) {
        // Logic from App.updateRelays
        this.ui.hideModal();
        try {
            await this.dataStore.updateRelaysList(newRelays);
            this.nostr.connect();
            this.ui.showToast('Relay list updated. Reconnecting...', 'info');
        } catch (e) {
            Logger.errorWithContext('RelayManagerService', 'Error updating relays list:', e);
            this.ui.showToast(`Failed to update relays: ${e.message || 'An unexpected error occurred while updating relays.'}`, 'error');
        }
    }
}
