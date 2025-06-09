import { Logger } from "./logger.js";
// Specific crypto utils used in this file:
import { hexToBytes, aesEncrypt, exportKeyAsBase64 } from "./utils/crypto-utils.js";
// Specific time utils used in this file:
import { now } from "./utils/time-utils.js";
// Specific nostr utils used in this file:
import { shortenPubkey } from "./utils/nostr-utils.js";
// Other utils like validateRelayUrl, findTag, ui-utils are not directly used in App class methods here,
// but might be used in other modules that App interacts with.

import { Button, Component } from "./ui.js";
import { ModalService } from "./modal-service.js"; // Import ModalService
import {Nostr} from "./nostr.js";
import { Data } from './store.js';
import { IdentityPanel, ThoughtList, MainView } from './components.js';
import { UIController } from './ui-controller.js';

const {generateSecretKey, nip19, nip04 } = NostrTools;

// Define Nostr event kinds as constants for clarity and maintainability
const TEXT_NOTE_KIND = 1;
const ENCRYPTED_DM_KIND = 4;
const PROFILE_KIND = 0;
const GROUP_CHAT_KIND = 41; // Custom kind for encrypted group chat

const DEFAULT_THOUGHT_ID = 'public'; // Default thought to select

export class App {
    constructor() {
        this.dataStore = new Data();
        this.ui = new UIController();
        this.nostr = new Nostr(this.dataStore, this.ui);
        this.modalService = new ModalService(this, this.ui, this.dataStore); // Instantiate ModalService
        this.init();
        window.addEventListener('unhandledrejection', e => {
            Logger.error('Unhandled promise rejection:', e.reason);
            this.ui.showToast(`Error: ${e.reason.message || 'Unknown error'}`, 'error');
        });

    }

    /**
     * Initializes the application.
     * Sets up the main UI components, registers event listeners,
     * loads initial data, and connects to Nostr relays.
     */
    async init() {
        this.ui.setLoading(true);
        try {
            // Setup main application shell and layout
            const shell = new Component('div', {id: 'app-shell'});
            const sidebar = new Component('div', {id: 'sidebar'});
            const statusBar = new Component('div', {id: 'status-bar'});
            this.mainView = new MainView(this);
            sidebar.add(new IdentityPanel(this), new ThoughtList(this), statusBar);
            shell.add(sidebar, this.mainView).mount(document.body);

            // Listen for Nostr connection status changes to update the UI
            this.nostr.on('connection:status', ({status, count}) => {
            const statusMessage = {connecting: "Connecting...", connected: "Connected", disconnected: "Disconnected"}[status];
            statusBar.setContent(`<div class="relay-status-icon ${status}"></div><span>${count} Relays</span><span style="margin-left: auto;">${statusMessage}</span>`);
        });

        // Listen for changes in the data store, particularly identity changes, to trigger Nostr reconnections
        this.dataStore.on('state:updated', ({identity}) => {
            // If the public key has changed, update currentPk and reconnect to Nostr
            if (this.currentPk !== undefined && this.currentPk !== identity.pk) {
                this.currentPk = identity.pk;
                this.nostr.connect(); // Reconnect with the new identity
            }
        });

        // Load existing data from storage
        await this.dataStore.load();
        // If no secret key is found, prompt the user to manage their identity (load or generate one)
        if (!this.dataStore.state.identity.sk) {
            this.modalService.show('identity'); // Use ModalService
        }
            this.currentPk = this.dataStore.state.identity.pk; // Set current public key
            this.nostr.connect(); // Initial connection to Nostr relays
            // Fetch historical messages for the currently active thought (e.g., 'public' or last selected)
            await this.nostr.fetchHistoricalMessages(this.dataStore.state.thoughts[this.dataStore.state.activeThoughtId]);
        } catch (e) {
            Logger.error('Initialization failed:', e);
            this.ui.showToast(`Initialization failed: ${e.message || 'An unexpected error occurred during app initialization.'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }

    /**
     * Handles selecting a new thought (e.g., a chat, DM, or note).
     * Updates the application state to reflect the new active thought,
     * marks messages as read, saves changes, and fetches relevant messages.
     * @param {string} id - The ID of the thought to select.
     */
    async selectThought(id) {
        this.ui.setLoading(true);
        try {
            const currentActiveThoughtId = this.dataStore.state.activeThoughtId;
            const thoughts = this.dataStore.state.thoughts;
            // Determine the new active thought ID; defaults to DEFAULT_THOUGHT_ID if the given id is invalid
            const newActiveThoughtId = thoughts[id] ? id : DEFAULT_THOUGHT_ID;

            const thoughtToUpdate = thoughts[newActiveThoughtId];
            // Flag to check if the unread count actually changes to avoid unnecessary save operations.
            let unreadActuallyChanged = false;

            // Check if the thought's unread status actually needs to change to avoid unnecessary saves
            if (thoughtToUpdate && thoughtToUpdate.unread > 0) {
                unreadActuallyChanged = true;
            }

            // Update the state: set the new active thought ID and reset its unread count
            this.dataStore.setState(s => {
                s.activeThoughtId = newActiveThoughtId;
                if (s.thoughts[newActiveThoughtId]) {
                    s.thoughts[newActiveThoughtId].unread = 0;
                }
            });

            // If the active thought has genuinely changed, save this preference
            if (currentActiveThoughtId !== newActiveThoughtId) {
                await this.dataStore.saveActiveThoughtId();
            }
            // If the unread count was reset, save the updated thoughts data
            if (unreadActuallyChanged) {
                await this.dataStore.saveThoughts();
            }

            // If the active thought changed, load its messages and fetch historical ones
            if (currentActiveThoughtId !== newActiveThoughtId) {
                await this.dataStore.loadMessages(newActiveThoughtId);
                await this.nostr.fetchHistoricalMessages(this.dataStore.state.thoughts[newActiveThoughtId]);
            }
        } catch (e) {
            Logger.error(`Error selecting thought ${id}:`, e);
            this.ui.showToast(`Failed to load thought: ${e.message || 'An unexpected error occurred while selecting the thought.'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }

    /**
     * Centralized handler for dispatching actions triggered by UI components or other parts of the application.
     * @param {string} action - The name of the action to perform.
     * @param {any} data - Optional data associated with the action.
     */
    handleAction(action, data) {
        const actions = {
            'manage-identity': () => this.dataStore.state.identity.sk ? this.logout() : this.modalService.show('identity'),
            'show-modal': (modal) => this.modalService.show(modal),
            'select-thought': (id) => this.selectThought(id),
            'leave-thought': () => this.leaveThought(),
            'send-message': (content) => this.sendMessage(content),
            'update-profile': (formData) => this.updateProfile(formData),
            'create-dm': (formData) => this.createDmThought(formData.get('pubkey')),
            'create-group': (formData) => this.createGroupThought(formData.get('name')),
            'join-group': (formData) => this.joinGroupThought(formData.get('id'), formData.get('key'), formData.get('name')),
            'add-relay': (formData) => this._appHandleAddRelay(formData.get('url')),
            'remove-relay': (url) => this._appHandleRemoveRelay(url),
            'create-note': () => this.createNoteThought(),
        };
        if (actions[action]) actions[action](data);
    }

    async _appHandleAddRelay(url) {
        this.ui.hideModal(); // Assuming called from a modal context
        try {
            await this.dataStore.addRelay(url); // New method in DataStore
            this.nostr.connect();
            this.ui.showToast('Relay added. Reconnecting...', 'info');
        } catch (e) {
            Logger.error('Error adding relay:', e);
            this.ui.showToast(`Failed to add relay: ${e.message || 'An unexpected error occurred.'}`, 'error');
        }
    }

    async _appHandleRemoveRelay(url) {
        if (confirm(`Are you sure you want to remove the relay: ${url}?`)) {
            this.ui.hideModal(); // Assuming called from a modal context, if applicable
            try {
                await this.dataStore.removeRelay(url); // New method in DataStore
                this.nostr.connect();
                this.ui.showToast('Relay removed. Reconnecting...', 'info');
            } catch (e) {
                Logger.error('Error removing relay:', e);
                this.ui.showToast(`Failed to remove relay: ${e.message || 'An unexpected error occurred.'}`, 'error');
            }
        }
    }

    async leaveThought() {
        const {activeThoughtId, thoughts} = this.dataStore.state;
        const thoughtToLeave = thoughts[activeThoughtId]; // Renamed 't' to 'thoughtToLeave'
        if (!thoughtToLeave || !confirm(`Leave/hide ${thoughtToLeave.type} "${thoughtToLeave.name}"?`)) return;
        this.ui.setLoading(true);
        try {
            // Remove the thought and its messages from the state
            this.dataStore.setState(s => {
                delete s.thoughts[activeThoughtId];
                delete s.messages[activeThoughtId];
            });
            // Persist changes: remove messages from localforage and save updated thoughts list
            await Promise.all([localforage.removeItem(`messages_${activeThoughtId}`), this.dataStore.saveThoughts()]);
            // Select the default public thought after leaving one
            await this.selectThought(DEFAULT_THOUGHT_ID);
            this.ui.showToast('Thought removed.', 'info');
            this.ui.showToast(`Switched to ${DEFAULT_THOUGHT_ID} chat.`, 'info'); // Use constant
        } catch (e) {
            Logger.error(`Error leaving thought ${activeThoughtId}:`, e);
            this.ui.showToast(`Failed to remove thought: ${e.message || 'An unexpected error occurred while removing the thought.'}`, 'error');
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
            Logger.error('Error during logout:', e);
            this.ui.showToast(`Logout failed: ${e.message || 'An unexpected error occurred during logout.'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }

    /**
     * Saves the user's identity (secret key).
     * Can either use a provided secret key or generate a new one if input is empty.
     * Handles confirmation for overwriting an existing identity.
     * @param {string} skInput - The secret key input (nsec, hex, or empty for new).
     */
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
            else if (/^[0-9a-fA-F]{64}$/.test(skInput)) sk = hexToBytes(skInput); // Changed from Utils.hexToBytes
            else if (!skInput) sk = generateSecretKey();
            else throw new Error('Invalid secret key format.');

            await this.dataStore.clearIdentity(); // Clear previous identity
            await this.dataStore.saveIdentity(sk); // Save the new one
            await this.dataStore.load(); // Reload data with new identity

            this.ui.showToast('Identity successfully saved and loaded!', 'success');
        } catch (e) {
            Logger.error('Save identity error:', e); // Log the full error object
            let userMessage = 'An unexpected error occurred while saving your identity.';
            if (e.message.includes('Invalid secret key format')) {
                userMessage = 'Error: Invalid secret key format provided.';
            } else if (e.message.includes('decode')) { // Example: from nip19.decode
                userMessage = 'Error: Could not decode the provided secret key.';
            } else {
                userMessage = `Error saving identity: ${e.message || 'Please try again.'}`;
            }
            this.ui.showToast(userMessage, 'error');

            // Attempt to clear identity again only if it was a new key generation that failed,
            // to prevent a state where old identity is cleared but new one isn't saved.
            if (!skInput) {
                try {
                    Logger.info('Attempting to clear potentially corrupted identity state after new key generation failure.');
                    await this.dataStore.clearIdentity();
                    this.ui.showToast('Previous identity cleared due to error. Please try creating a new one again.', 'warn');
                } catch (clearError) {
                    Logger.error('Failed to clear identity after an error during new key generation:', clearError);
                    this.ui.showToast('Critical Error: Failed to manage identity state. Please reload the application.', 'error');
                }
            }
        } finally {
            this.ui.setLoading(false);
        }
    }

    /**
     * Sends a message to the active thought.
     * The message is encrypted if the thought is a DM or a group chat.
     * @param {string} content - The plain text content of the message.
     */
    async sendMessage(content) {
        this.ui.setLoading(true);
        try {
            const {activeThoughtId, thoughts, identity} = this.dataStore.state;
            const activeThought = thoughts[activeThoughtId]; // Renamed 't' to 'activeThought'
            if (!activeThought) throw new Error('No active thought selected');
            if (!identity.sk) throw new Error('No identity loaded. Please load or create one to send messages.');

            let eventTemplate = {kind: TEXT_NOTE_KIND, created_at: now(), tags: [], content}; // Use constant

            if (activeThought.type === 'dm') {
                eventTemplate.kind = ENCRYPTED_DM_KIND; // Use constant
                eventTemplate.tags.push(['p', activeThought.pubkey]);
                eventTemplate.content = await nip04.encrypt(identity.sk, activeThought.pubkey, content);
            } else if (activeThought.type === 'group') {
                eventTemplate.kind = GROUP_CHAT_KIND; // Use constant
                eventTemplate.tags.push(['g', activeThought.id]);
                eventTemplate.content = await aesEncrypt(content, activeThought.secretKey); // Changed from Utils.crypto.aesEncrypt
            } else if (activeThought.type !== DEFAULT_THOUGHT_ID) { // Check against 'public'
                throw new Error("Sending messages in this thought type is not supported.");
            }

            const signedEvent = await this.nostr.publish(eventTemplate);
            await this.nostr.processMessage({...signedEvent, content}, activeThoughtId);
            this.ui.showToast('Message sent!', 'success');
        } catch (e) {
            Logger.error('Send message error:', e); // Log full error object
            let userMessage = 'An unexpected error occurred while sending the message.';
            if (e.message.includes('No identity loaded')) {
                userMessage = 'Error: Cannot send message. No identity loaded. Please manage your identity.';
            } else if (e.message.includes('No active thought selected')) {
                userMessage = 'Error: No active chat selected to send the message to.';
            } else if (e.message.includes('not supported')) {
                userMessage = `Error: ${e.message}`;
            } else if (e.message.includes('Failed to publish event')) { // From Nostr.publish
                userMessage = 'Error: Message could not be sent to any relay. Please check your relay connections.';
            } else {
                userMessage = `Failed to send message: ${e.message || 'Please try again.'}`;
            }
            this.ui.showToast(userMessage, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }

    async updateProfile(data) {
        this.ui.hideModal();
        this.ui.setLoading(true);
        try {
            if (!this.dataStore.state.identity.sk) throw new Error('Not logged in. Cannot update profile.');
            const newContent = {name: data.get('name'), picture: data.get('picture'), nip05: data.get('nip05')};
            const event = await this.nostr.publish({
                kind: PROFILE_KIND, // Use constant
                created_at: now(), // Changed from Utils.now()
                tags: [],
                content: JSON.stringify(newContent)
            });
            await this.nostr.processKind0(event);
            this.ui.showToast('Profile updated!', 'success');
        } catch (e) {
            this.ui.showToast(`Profile update failed: ${e.message || 'An unexpected error occurred while updating the profile.'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }

    async createDmThought(pubkeyInput) {
        this.ui.hideModal();
        // setLoading can be called after initial checks if preferred
        try {
            if (!this.dataStore.state.identity.sk) throw new Error('Login to create DMs.');
            let pk = pubkeyInput.startsWith('npub') ? nip19.decode(pubkeyInput).data : pubkeyInput;
            if (!/^[0-9a-fA-F]{64}$/.test(pk)) throw new Error('Invalid public key.');
            if (pk === this.dataStore.state.identity.pk) throw new Error("Cannot DM yourself.");
            if (!this.dataStore.state.thoughts[pk]) {
                this.dataStore.setState(s => s.thoughts[pk] = {
                    id: pk,
                    name: shortenPubkey(pk), // Changed from Utils.shortenPubkey
                    type: 'dm',
                    pubkey: pk,
                    unread: 0,
                    lastEventTimestamp: now() // Changed from Utils.now()
                });
                await this.dataStore.saveThoughts();
                await this.nostr.fetchProfile(pk);
            }
            this.selectThought(pk);
            this.ui.showToast(`DM started.`, 'success');
        } catch (e) {
            this.ui.showToast(`Error creating DM: ${e.message || 'An unexpected error occurred while creating the DM.'}`, 'error');
        }
        // No finally setLoading(false) here as it's a quick op or error is shown
    }

    async createGroupThought(name) {
        this.ui.hideModal();
        if (!this.dataStore.state.identity.sk) return this.ui.showToast('Login to create groups.', 'error');
        if (!name) return this.ui.showToast('Group name is required.', 'error');
        this.ui.setLoading(true);
        try {
            const id = crypto.randomUUID();
            const key = await exportKeyAsBase64(await crypto.subtle.generateKey({ // Changed from Utils.crypto.exportKeyAsBase64
                name: "AES-GCM",
                length: 256
            }, true, ["encrypt", "decrypt"]));
            this.dataStore.setState(s => s.thoughts[id] = {
                id,
                name,
                type: 'group',
                secretKey: key,
                unread: 0,
                lastEventTimestamp: now() // Changed from Utils.now()
            });
            await this.dataStore.saveThoughts();
            this.selectThought(id);
            this.ui.showToast(`Group "${name}" created.`, 'success');
            this.modalService.show('groupInfo'); // Use ModalService
        } catch (e) {
            Logger.error('Error creating group thought:', e);
            this.ui.showToast(`Failed to create group: ${e.message || 'An unexpected error occurred while creating the group.'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }

    async joinGroupThought(id, key, name) {
        this.ui.hideModal();
        if (!this.dataStore.state.identity.sk) return this.ui.showToast('Login to join groups.', 'error');
        if (this.dataStore.state.thoughts[id]) return this.ui.showToast(`Already in group.`, 'warn');
        if (!id || !key || !name) return this.ui.showToast('All fields are required.', 'error');
        this.ui.setLoading(true);
        try {
            atob(key); // Basic check for Base64
            this.dataStore.setState(s => s.thoughts[id] = {
                id,
                name,
                type: 'group',
                secretKey: key,
                unread: 0,
                lastEventTimestamp: now() // Changed from Utils.now()
            });
            await this.dataStore.saveThoughts();
            this.selectThought(id);
            this.ui.showToast(`Joined group "${name}".`, 'success');
        } catch (e) {
            Logger.error('Error joining group thought:', e);
            this.ui.showToast(`Failed to join group: ${e.message || 'An unexpected error occurred while joining the group.'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }

    async createNoteThought() {
        if (!this.dataStore.state.identity.sk) {
            this.ui.showToast('Login to create notes.', 'error');
            return;
        }
        this.ui.setLoading(true);
        try {
            const newId = crypto.randomUUID(); // Generate a unique ID for the new note.
            let noteName = 'New Note';
            // Ensure the note name is unique by appending a number if "New Note" or "New Note X" already exists.
            const existingNames = new Set(Object.values(this.dataStore.state.thoughts)
                                            .filter(t => t.type === 'note')
                                            .map(t => t.name));
            if (existingNames.has(noteName)) {
                let i = 1;
                while (existingNames.has(`New Note ${i}`)) {
                    i++;
                }
                noteName = `New Note ${i}`; // Found a unique name like "New Note 1", "New Note 2", etc.
            }

            const newNote = {
                id: newId,
                name: noteName,
                type: 'note',
                body: '',
                lastEventTimestamp: now(), // Changed from Utils.now()
                unread: 0
            };
            this.dataStore.setState(s => {
                s.thoughts[newId] = newNote;
            });
            await this.dataStore.saveThoughts();
            this.selectThought(newId);
            this.ui.showToast('Note created.', 'success');
        } catch (e) {
            Logger.error('Error creating note thought:', e);
            this.ui.showToast(`Failed to create note: ${e.message || 'An unexpected error occurred while creating the note.'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }

    async updateRelays(newRelays) {
        // This method is now intended for broader updates, possibly still used by settings.
        // Specific add/remove actions are handled by _appHandleAddRelay and _appHandleRemoveRelay
        // which delegate to DataStore more directly for single operations.
        this.ui.hideModal();
        try {
            // The core logic of updating relays in DataStore might be centralized.
            // For this refactor, we assume DataStore.updateRelaysList (or similar) would be called.
            // Or, this method could be refactored to call DataStore.setRelays(newRelaysList).
            // For now, let's assume this method might still be used for bulk updates from a settings page.
            // It should primarily delegate to DataStore for validation and saving.

            await this.dataStore.updateRelaysList(newRelays); // This new DataStore method would handle validation and saving
            this.nostr.connect();
            this.ui.showToast('Relay list updated. Reconnecting...', 'info');
        } catch (e) {
            Logger.error('Error updating relays:', e);
            this.ui.showToast(`Failed to update relays: ${e.message || 'An unexpected error occurred while updating relays.'}`, 'error');
        }
    }

}

document.addEventListener('DOMContentLoaded', () => new App());
