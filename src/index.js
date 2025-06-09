import { Logger } from "./logger.js";
// Initialize Logger Debug Mode (e.g., based on localStorage or a build flag)
// To enable debug mode via console: Logger.setDebugMode(true)
// Or: Logger.setDebugMode(localStorage.getItem('APP_DEBUG_MODE') === 'true');
Logger.setDebugMode(false);

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
import { UIController } from './ui-controller.js';
import { AppUIInitializer } from './app-ui-initializer.js';
import { RelayManagerService } from './relay-manager-service.js';
import { IdentityService } from './identity-service.js';
import { ThoughtManagerService } from './thought-manager-service.js';
import { NostrPublishService } from './nostr-publish-service.js';
import { ThoughtCreationService } from './thought-creation-service.js';

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
        this.relayManagerService = new RelayManagerService(this.dataStore, this.nostr, this.ui);
        this.identityService = new IdentityService(this.dataStore, this.ui, this);
        this.thoughtManagerService = new ThoughtManagerService(this.dataStore, this.ui, this.nostr, this);
        this.nostrPublishService = new NostrPublishService(this.dataStore, this.nostr, this.ui);
        this.thoughtCreationService = new ThoughtCreationService(this.dataStore, this.ui, this.nostr, this);
        this.init();
        window.addEventListener('unhandledrejection', e => {
            Logger.errorWithContext('App', 'Unhandled promise rejection:', e.reason);
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
            const uiInitializer = new AppUIInitializer(this, this.ui);
            uiInitializer.setupDOM();

            // Listen for Nostr connection status changes to update the UI
            this.nostr.on('connection:status', ({status, count}) => {
            const statusMessage = {connecting: "Connecting...", connected: "Connected", disconnected: "Disconnected"}[status];
            // Ensure statusBar is accessible, e.g., this.statusBar if set by AppUIInitializer
            if (this.statusBar) {
                this.statusBar.setContent(`<div class="relay-status-icon ${status}"></div><span>${count} Relays</span><span style="margin-left: auto;">${statusMessage}</span>`);
            }
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
            Logger.errorWithContext('App', 'Initialization failed:', e);
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
            Logger.errorWithContext('App', `Error selecting thought ${id}:`, e);
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
            'manage-identity': () => this.dataStore.state.identity.sk ? this.identityService.logout() : this.modalService.show('identity'),
            'show-modal': (modal) => this.modalService.show(modal),
            'select-thought': (id) => this.thoughtManagerService.selectThought(id),
            'leave-thought': () => this.thoughtManagerService.leaveThought(),
            'send-message': (content) => this.nostrPublishService.sendMessage(content),
            'update-profile': (formData) => this.nostrPublishService.updateProfile(formData),
            'create-dm': (formData) => this.createDmThought(formData.get('pubkey')),
            'create-group': (formData) => this.createGroupThought(formData.get('name')),
            'join-group': (formData) => this.joinGroupThought(formData.get('id'), formData.get('key'), formData.get('name')),
            'add-relay': (formData) => this.relayManagerService.addRelay(formData.get('url')),
            'remove-relay': (url) => this.relayManagerService.removeRelay(url),
            'create-note': () => this.createNoteThought(),
        };
        if (actions[action]) actions[action](data);
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
            Logger.errorWithContext('App', `Error leaving thought ${activeThoughtId}:`, e);
            this.ui.showToast(`Failed to remove thought: ${e.message || 'An unexpected error occurred while removing the thought.'}`, 'error');
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
            Logger.errorWithContext('App', 'Error creating group thought:', e);
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
            Logger.errorWithContext('App', 'Error joining group thought:', e);
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
            Logger.errorWithContext('App', 'Error creating note thought:', e);
            this.ui.showToast(`Failed to create note: ${e.message || 'An unexpected error occurred while creating the note.'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }

    async updateRelaysList(newRelays) {
        this.relayManagerService.updateRelaysList(newRelays);
    }

}

document.addEventListener('DOMContentLoaded', () => new App());
