import { Logger } from './logger.js';
import { now } from './utils/time-utils.js';
import { aesEncrypt } from './utils/crypto-utils.js';
// NostrTools is expected to be available globally
const { nip04 } = NostrTools;

// Define Nostr event kinds as constants locally for now
const TEXT_NOTE_KIND = 1;
const ENCRYPTED_DM_KIND = 4;
const PROFILE_KIND = 0;
const GROUP_CHAT_KIND = 41; // Custom kind for encrypted group chat
const DEFAULT_THOUGHT_ID = 'public'; // Used in sendMessage logic

export class NostrPublishService {
    constructor(dataStore, nostr, ui) {
        this.dataStore = dataStore;
        this.nostr = nostr;
        this.ui = ui;
    }

    async sendMessage(content) {
        this.ui.setLoading(true);
        try {
            const {activeThoughtId, thoughts, identity} = this.dataStore.state;
            const activeThought = thoughts[activeThoughtId];
            if (!activeThought) throw new Error('No active thought selected');
            if (!identity.sk) throw new Error('No identity loaded. Please load or create one to send messages.');

            let eventTemplate = {kind: TEXT_NOTE_KIND, created_at: now(), tags: [], content};

            if (activeThought.type === 'dm') {
                eventTemplate.kind = ENCRYPTED_DM_KIND;
                eventTemplate.tags.push(['p', activeThought.pubkey]);
                eventTemplate.content = await nip04.encrypt(identity.sk, activeThought.pubkey, content);
            } else if (activeThought.type === 'group') {
                eventTemplate.kind = GROUP_CHAT_KIND;
                eventTemplate.tags.push(['g', activeThought.id]);
                eventTemplate.content = await aesEncrypt(content, activeThought.secretKey);
            } else if (activeThought.type !== DEFAULT_THOUGHT_ID) {
                // Allow sending to public, but throw error for other non-DM/non-Group types (e.g. 'note')
                throw new Error("Sending messages in this thought type is not supported.");
            }
            // If activeThought.type IS DEFAULT_THOUGHT_ID (public), it remains a TEXT_NOTE_KIND

            const signedEvent = await this.nostr.publish(eventTemplate);
            // processMessage might need to be called from App or a different service if it updates broad app state
            // For now, keeping it here as it was in App.sendMessage
            await this.nostr.processMessage({...signedEvent, content}, activeThoughtId);
            this.ui.showToast('Message sent!', 'success');
        } catch (e) {
            Logger.error('Send message error:', e);
            let userMessage = 'An unexpected error occurred while sending the message.';
            if (e.message.includes('No identity loaded')) {
                userMessage = 'Error: Cannot send message. No identity loaded. Please manage your identity.';
            } else if (e.message.includes('No active thought selected')) {
                userMessage = 'Error: No active chat selected to send the message to.';
            } else if (e.message.includes('not supported')) {
                userMessage = `Error: ${e.message}`;
            } else if (e.message.includes('Failed to publish event')) {
                userMessage = 'Error: Message could not be sent to any relay. Please check your relay connections.';
            } else {
                userMessage = `Failed to send message: ${e.message || 'Please try again.'}`;
            }
            this.ui.showToast(userMessage, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }

    async updateProfile(formData) { // formData is expected to be a FormData instance
        this.ui.hideModal();
        this.ui.setLoading(true);
        try {
            if (!this.dataStore.state.identity.sk) throw new Error('Not logged in. Cannot update profile.');

            const newContent = {
                name: formData.get('name'),
                picture: formData.get('picture'),
                nip05: formData.get('nip05')
            };

            const event = await this.nostr.publish({
                kind: PROFILE_KIND,
                created_at: now(),
                tags: [],
                content: JSON.stringify(newContent)
            });
            // processKind0 might also be a candidate for moving if it broadly affects app state
            // For now, keeping it here as it was in App.updateProfile
            await this.nostr.processKind0(event);
            this.ui.showToast('Profile updated!', 'success');
        } catch (e) {
            Logger.error('Update profile error:', e); // Log full error
            this.ui.showToast(`Profile update failed: ${e.message || 'An unexpected error occurred while updating the profile.'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }
}
