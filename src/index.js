import { Logger, Utils } from "./utils.js";
import { Button, Component } from "./ui.js";
import { ModalService } from "./modal-service.js"; // Import ModalService
import {Nostr} from "./nostr.js";
import { Data } from './store.js';
import { IdentityPanel, ThoughtList, MainView } from './components.js';
import { UIController } from './ui-controller.js';

const {generateSecretKey, nip19, nip04 } = NostrTools;

class App {
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
            // Determine the new active thought ID; defaults to 'public' if the given id is invalid
            const newActiveThoughtId = thoughts[id] ? id : 'public';

            const thoughtToUpdate = thoughts[newActiveThoughtId];
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
            'add-relay': (formData) => this.updateRelays([...this.dataStore.state.relays, formData.get('url')]),
            'remove-relay': (url) => {
                if (confirm(`Are you sure you want to remove the relay: ${url}?`)) {
                    this.updateRelays(this.dataStore.state.relays.filter(u => u !== url));
                }
            },
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
            // Select the public thought by default after leaving one
            await this.selectThought('public');
            this.ui.showToast('Thought removed.', 'info');
            this.ui.showToast('Switched to Public chat.', 'info');
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
            // Confirmation before potentially overwriting an existing identity.
            if (this.dataStore.state.identity.sk) {
                const message = skInput
                    ? 'Are you sure you want to overwrite your existing identity? This action cannot be undone.'
                    : 'Are you sure you want to generate a new identity? This will overwrite your existing identity and cannot be undone.';
                if (!confirm(message)) {
                    this.ui.setLoading(false); // Abort if user cancels.
                    return;
                }
            }

            let sk; // Variable to hold the processed secret key in byte format.
            // Decode nsec input, convert hex input, or generate a new key.
            if (skInput.startsWith('nsec')) sk = nip19.decode(skInput).data;
            else if (/^[0-9a-fA-F]{64}$/.test(skInput)) sk = Utils.hexToBytes(skInput);
            else if (!skInput) sk = generateSecretKey(); // Generate new if no input
            else throw new Error('Invalid secret key format.');

            // Clear previous identity data before saving the new one.
            await this.dataStore.clearIdentity();
            await this.dataStore.saveIdentity(sk);
            // Reload all data, which will also trigger Nostr reconnection via 'state:updated' event.
            await this.dataStore.load();
            this.ui.showToast('Identity loaded!', 'success');
        } catch (e) {
            this.ui.showToast(`Error saving identity: ${e.message || 'An unexpected error occurred while saving the identity.'}`, 'error');
            // If key generation failed partway (e.g., after clearIdentity but before saveIdentity),
            // and it was an attempt to generate a *new* key (no skInput),
            // try to clear identity again to prevent a corrupted state.
            if (!skInput) {
                await this.dataStore.clearIdentity();
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

            let eventTemplate = {kind: 1, created_at: Utils.now(), tags: [], content}; // Default for public thoughts

            // Customize event for DMs (kind 4)
            if (activeThought.type === 'dm') {
                eventTemplate.kind = 4;
                eventTemplate.tags.push(['p', activeThought.pubkey]);
                eventTemplate.content = await nip04.encrypt(identity.sk, activeThought.pubkey, content);
            }
            // Customize event for group chats (kind 41, custom provisional kind)
            else if (activeThought.type === 'group') {
                eventTemplate.kind = 41; // Using a custom kind for group messages
                eventTemplate.tags.push(['g', activeThought.id]); // Tag with group ID for filtering
                eventTemplate.content = await Utils.crypto.aesEncrypt(content, activeThought.secretKey);
            }
            // Disallow sending messages to other thought types if not public, DM, or group
            else if (activeThought.type !== 'public') {
                throw new Error("Cannot send message in this thought type.");
            }

            // Publish the event to Nostr relays
            const signedEvent = await this.nostr.publish(eventTemplate);
            // Process the sent message locally to update UI immediately
            await this.nostr.processMessage({...signedEvent, content}, activeThoughtId); // Pass original plain content for local display
            this.ui.showToast('Message sent!', 'success');
        } catch (e) {
            Logger.error("Send message error:", e);
            this.ui.showToast(`Failed to send message: ${e.message || 'An unexpected error occurred while sending the message.'}`, 'error');
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
                kind: 0,
                created_at: Utils.now(),
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
                    name: Utils.shortenPubkey(pk),
                    type: 'dm',
                    pubkey: pk,
                    unread: 0,
                    lastEventTimestamp: Utils.now()
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
            const key = await Utils.crypto.exportKeyAsBase64(await crypto.subtle.generateKey({
                name: "AES-GCM",
                length: 256
            }, true, ["encrypt", "decrypt"]));
            this.dataStore.setState(s => s.thoughts[id] = {
                id,
                name,
                type: 'group',
                secretKey: key,
                unread: 0,
                lastEventTimestamp: Utils.now()
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
                lastEventTimestamp: Utils.now()
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
                lastEventTimestamp: Utils.now(),
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
        this.ui.hideModal();
        // setLoading can be called after initial checks if preferred
        try {
            const validRelays = [...new Set(newRelays)].filter(Utils.validateRelayUrl);
            if (validRelays.length === 0) {
                this.ui.showToast('No valid relays provided. At least one wss:// relay is required.', 'error');
                return;
            }
            this.dataStore.setState(s => s.relays = validRelays);
            await this.dataStore.saveRelays();
            this.nostr.connect();
            this.ui.showToast('Relay list updated. Reconnecting...', 'info');
        } catch (e) {
            Logger.error('Error updating relays:', e);
            this.ui.showToast(`Failed to update relays: ${e.message || 'An unexpected error occurred while updating relays.'}`, 'error');
        }
        // No finally setLoading(false) here as it's a quick op or error is shown,
        // and nostr.connect() will manage its own connection status updates.
    }

}

document.addEventListener('DOMContentLoaded', () => new App());
