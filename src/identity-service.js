import {Logger} from '/logger.js';
import {hexToBytes} from '/utils/crypto-utils.js';

const { nip19, generateSecretKey } = NostrTools;

export class IdentityService {
    constructor(dataStore, ui, app) {
        this.dataStore = dataStore;
        this.ui = ui;
        this.app = app;
    }

    async saveIdentity(skInput) {
        this.ui.hideModal();
        this.ui.setLoading(true);
        try {
            if (this.dataStore.state.identity.sk) {
                const message = skInput
                    ? 'Are you sure you want to overwrite your existing identity? This action cannot be undone.'
                    : 'Are you sure you want to generate a new identity? This will overwrite your existing identity and cannot be undone.';
                if (!confirm(message)) {
                    this.ui.setLoading(false);
                    return;
                }
            }

            let sk;
            if (skInput.startsWith('nsec')) sk = nip19.decode(skInput).data;
            else if (/^[0-9a-fA-F]{64}$/.test(skInput)) sk = hexToBytes(skInput);
            else if (!skInput) sk = generateSecretKey();
            else throw new Error('Invalid secret key format.');

            await this.dataStore.clearIdentity();
            await this.dataStore.saveIdentity(sk);
            await this.dataStore.load();

            this.ui.showToast('Identity successfully saved and loaded!', 'success');
        } catch (e) {
            Logger.errorWithContext('IdentityService', 'Save identity error:', e);
            let userMessage = 'An unexpected error occurred while saving your identity.';
            if (e.message.includes('Invalid secret key format')) {
                userMessage = 'Error: Invalid secret key format provided.';
            } else if (e.message.includes('decode')) {
                userMessage = 'Error: Could not decode the provided secret key.';
            } else {
                userMessage = `Error saving identity: ${e.message || 'Please try again.'}`;
            }
            this.ui.showToast(userMessage, 'error');

            if (!skInput) {
                try {
                    Logger.infoWithContext('IdentityService', 'Attempting to clear potentially corrupted identity state after new key generation failure.');
                    await this.dataStore.clearIdentity();
                    this.ui.showToast('Previous identity cleared due to error. Please try creating a new one again.', 'warn');
                } catch (clearError) {
                    Logger.errorWithContext('IdentityService', 'Failed to clear identity after an error during new key generation:', clearError);
                    this.ui.showToast('Critical Error: Failed to manage identity state. Please reload the application.', 'error');
                }
            }
        } finally {
            this.ui.setLoading(false);
        }
    }

    async logout() {
        if (!confirm('Are you sure? This will delete all local data.')) return;
        this.ui.setLoading(true);
        try {
            await this.dataStore.clearIdentity();
            this.ui.showToast('Logged out.', 'info');
        } catch (e) {
            Logger.errorWithContext('IdentityService', 'Error during logout:', e);
            this.ui.showToast(`Logout failed: ${e.message || 'An unexpected error occurred during logout.'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }
}
