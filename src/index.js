// --- CONSTANTS ---
import { Logger, Utils } from "./utils.js"; // EventEmitter removed
import { Button, Component } from "./ui.js";
import {Nostr} from "./nostr.js";
import { Data } from './store.js';
import { IdentityPanel, ThoughtList, MainView } from './components.js';
import { UIController } from './ui-controller.js';

// verifyEvent and finalizeEvent might not be needed directly here anymore.
// getPublicKey is used by Data class, but that's in store.js now.
// SimplePool is used by Nostr class, in nostr.js.
const {generateSecretKey, nip19, nip04 } = NostrTools; // Removed getPublicKey, finalizeEvent, verifyEvent, SimplePool

// --- UI & APP CONTROLLER ---
class App {
    constructor() {
        this.dataStore = new Data();
        this.ui = new UIController();
        // Pass ui controller to Nostr constructor
        this.nostr = new Nostr(this.dataStore, this.ui);
        // this.nostr.ui = this.ui; // This is now set in Nostr's constructor
        // Removed: this.nostr.appController = this;
        this.init();
        window.addEventListener('unhandledrejection', e => {
            Logger.error('Unhandled promise rejection:', e.reason);
            this.ui.showToast(`Error: ${e.reason.message || 'Unknown error'}`, 'error');
        });

    }

    async init() {
        this.ui.setLoading(true);
        const shell = new Component('div', {id: 'app-shell'});
        const sidebar = new Component('div', {id: 'sidebar'});
        const statusBar = new Component('div', {id: 'status-bar'});
        this.mainView = new MainView(this);
        sidebar.add(new IdentityPanel(this), new ThoughtList(this), statusBar);
        shell.add(sidebar, this.mainView).mount(document.body);

        this.nostr.on('connection:status', ({status, count}) => {
            const s = {connecting: "Connecting...", connected: "Connected", disconnected: "Disconnected"}[status];
            statusBar.setContent(`<div class="relay-status-icon ${status}"></div><span>${count} Relays</span><span style="margin-left: auto;">${s}</span>`);
        });

        // Removed: this.nostr.on('event', ({event, subId}) => this.processNostrEvent(event, subId));
        // Event processing is now internal to Nostr class

        this.dataStore.on('state:updated', ({identity}) => {
            if (this.currentPk !== undefined && this.currentPk !== identity.pk) {
                this.currentPk = identity.pk;
                this.nostr.connect(); // This will re-subscribe core events
            }
        });

        await this.dataStore.load();
        if (!this.dataStore.state.identity.sk) {
            // If no secret key is loaded, immediately show the identity modal.
            this._showIdentityModal();
        }
        this.currentPk = this.dataStore.state.identity.pk;
        this.nostr.connect(); // This sets up the continuous subscriptions

        // After initial load and connection, fetch historical messages for the active thought
        // This ensures the initial view is populated even if localforage is empty
        await this.nostr.fetchHistoricalMessages(this.dataStore.state.thoughts[this.dataStore.state.activeThoughtId]);

        this.ui.setLoading(false);
    }

    async selectThought(id) {
        const {activeThoughtId, thoughts} = this.dataStore.state;
        const newActiveThoughtId = thoughts[id] ? id : 'public';

        // Only re-fetch and update if the thought actually changes
        if (activeThoughtId !== newActiveThoughtId) {
            this.dataStore.setState(s => {
                s.activeThoughtId = newActiveThoughtId;
                const t = s.thoughts[s.activeThoughtId];
                if (t?.unread > 0) t.unread = 0;
            });
            await this.dataStore.saveActiveThoughtId();

            // Load messages from localforage first
            await this.dataStore.loadMessages(newActiveThoughtId);
            // Then fetch recent historical messages from relays
            await this.nostr.fetchHistoricalMessages(this.dataStore.state.thoughts[newActiveThoughtId]);
        } else {
            // If the same thought is selected, just ensure unread is cleared
            this.dataStore.setState(s => {
                const t = s.thoughts[s.activeThoughtId];
                if (t?.unread > 0) t.unread = 0;
            });
            await this.dataStore.saveActiveThoughtId();
        }
    }

    handleAction(action, data) {
        const actions = {
            'manage-identity': () => this.dataStore.state.identity.sk ? this.logout() : this._showIdentityModal(),
            'show-modal': (modal) => this.showModal(modal), // This will dispatch to specific modal methods
            'select-thought': (id) => this.selectThought(id),
            'leave-thought': () => this.leaveThought(),
            'send-message': (content) => this.sendMessage(content),
            'update-profile': (d) => this.updateProfile(d),
            'create-dm': (d) => this.createDmThought(d.get('pubkey')),
            'create-group': (d) => this.createGroupThought(d.get('name')),
            'join-group': (d) => this.joinGroupThought(d.get('id'), d.get('key'), d.get('name')),
            'add-relay': (d) => this.updateRelays([...this.dataStore.state.relays, d.get('url')]),
            'remove-relay': (url) => this.updateRelays(this.dataStore.state.relays.filter(u => u !== url)),
            'create-note': () => this.createNoteThought(), // New action for creating notes
        };
        if (actions[action]) actions[action](data);
    }

    async leaveThought() {
        const {activeThoughtId, thoughts} = this.dataStore.state;
        const t = thoughts[activeThoughtId];
        if (!t || !confirm(`Leave/hide ${t.type} "${t.name}"?`)) return;
        this.dataStore.setState(s => {
            delete s.thoughts[activeThoughtId];
            delete s.messages[activeThoughtId];
        });
        await Promise.all([localforage.removeItem(`messages_${activeThoughtId}`), this.dataStore.saveThoughts()]);
        this.selectThought('public');
        this.ui.showToast('Thought removed.', 'info');
    }

    async logout() {
        if (!confirm('Are you sure? This will delete all local data.')) return;
        await this.dataStore.clearIdentity();
        this.ui.showToast('Logged out.', 'info');
    }

    async saveIdentity(skInput) {
        this.ui.hideModal();
        this.ui.setLoading(true);
        try {
            let sk;
            if (skInput.startsWith('nsec')) sk = nip19.decode(skInput).data;
            else if (/^[0-9a-fA-F]{64}$/.test(skInput)) sk = Utils.hexToBytes(skInput);
            else if (!skInput) sk = generateSecretKey();
            else throw new Error('Invalid secret key format.');
            await this.dataStore.clearIdentity();
            await this.dataStore.saveIdentity(sk);
            await this.dataStore.load();
            this.ui.showToast('Identity loaded!', 'success');
        } catch (e) {
            this.ui.showToast(`Error: ${e.message}`, 'error');
            await this.dataStore.clearIdentity();
        } finally {
            this.ui.setLoading(false);
        }
    }

    // processNostrEvent, processMessage, processKind0 MOVED to Nostr class

    async sendMessage(content) {
        this.ui.setLoading(true);
        try {
            const {activeThoughtId, thoughts, identity} = this.dataStore.state;
            const t = thoughts[activeThoughtId];
            if (!t) throw new Error('No active thought selected');
            if (!identity.sk) throw new Error('No identity loaded. Please load or create one to send messages.');

            let eventTemplate = {kind: 1, created_at: Utils.now(), tags: [], content};
            if (t.type === 'dm') {
                eventTemplate.kind = 4;
                eventTemplate.tags.push(['p', t.pubkey]);
                eventTemplate.content = await nip04.encrypt(identity.sk, t.pubkey, content);
            } else if (t.type === 'group') {
                eventTemplate.kind = 41;
                eventTemplate.tags.push(['g', t.id]);
                eventTemplate.content = await Utils.crypto.aesEncrypt(content, t.secretKey);
            } else if (t.type === 'public') {
                // It's a kind 1, public note. No changes needed.
            } else {
                throw new Error("Cannot send message in this thought type.");
            }
            const signedEvent = await this.nostr.publish(eventTemplate);
            // Process the *sent* message immediately so it appears in UI, now calling Nostr's method
            await this.nostr.processMessage({...signedEvent, content}, activeThoughtId);
            this.ui.showToast('Message sent!', 'success');
        } catch (e) {
            Logger.error("Send message error:", e);
            this.ui.showToast(`Failed to send message: ${e.message}`, 'error');
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
            await this.nostr.processKind0(event); // Call Nostr's method
            this.ui.showToast('Profile updated!', 'success');
        } catch (e) {
            this.ui.showToast(`Profile update failed: ${e.message}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }

    async createDmThought(pubkeyInput) {
        this.ui.hideModal();
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
                await this.nostr.fetchProfile(pk); // Fetch profile for new DM contact
            }
            this.selectThought(pk);
            this.ui.showToast(`DM started.`, 'success');
        } catch (e) {
            this.ui.showToast(`Error: ${e.message}`, 'error');
        }
    }

    async createGroupThought(name) {
        this.ui.hideModal();
        if (!this.dataStore.state.identity.sk) return this.ui.showToast('Login to create groups.', 'error');
        if (!name) return this.ui.showToast('Group name is required.', 'error');
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
        this.showModal('groupInfo'); // Show info with ID and key
    }

    async joinGroupThought(id, key, name) {
        this.ui.hideModal();
        if (!this.dataStore.state.identity.sk) return this.ui.showToast('Login to join groups.', 'error');
        if (this.dataStore.state.thoughts[id]) return this.ui.showToast(`Already in group.`, 'warn');
        if (!id || !key || !name) return this.ui.showToast('All fields are required.', 'error');
        try {
            atob(key); // Check if base64 encoded
        } catch (e) {
            return this.ui.showToast('Invalid secret key. Must be Base64.', 'error');
        }
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
    }

    async createNoteThought() {
        if (!this.dataStore.state.identity.sk) {
            this.ui.showToast('Login to create notes.', 'error');
            return;
        }
        const newId = crypto.randomUUID();
        const newNote = {
            id: newId,
            name: 'New Note',
            type: 'note',
            body: '', // Initialize with an empty body
            lastEventTimestamp: Utils.now(),
            unread: 0
        };
        this.dataStore.setState(s => {
            s.thoughts[newId] = newNote;
        });
        await this.dataStore.saveThoughts();
        this.selectThought(newId);
        this.ui.showToast('Note created.', 'success');
    }

    async updateRelays(newRelays) {
        this.ui.hideModal();
        const validRelays = [...new Set(newRelays)].filter(Utils.validateRelayUrl); // Filter out duplicates and invalid URLs
        if (validRelays.length === 0) {
            this.ui.showToast('No valid relays provided. At least one wss:// relay is required.', 'error');
            return; // Prevent setting an empty relay list
        }
        this.dataStore.setState(s => s.relays = validRelays);
        await this.dataStore.saveRelays();
        this.nostr.connect(); // Reconnect to updated relays
        this.ui.showToast('Relay list updated. Reconnecting...', 'info');
    }

    // Refactored modal display methods
    _showIdentityModal() {
        const form = new Component('form', {
            onsubmit: e => {
                e.preventDefault();
                this.saveIdentity(new FormData(e.target).get('privkey'));
            }
        });
        form.add(new Component('label', {textContent: 'Secret Key (nsec/hex) or blank for new:'}), new Component('input', {
            type: 'password',
            name: 'privkey'
        }));
        this.ui.showModal({
            title: 'Manage Identity',
            body: form,
            buttons: [
                new Button({textContent: 'Cancel', className: 'secondary', onClick: () => this.ui.hideModal()}),
                new Button({textContent: 'Load/Gen', type: 'submit', onClick: () => form.element.requestSubmit()})
            ]
        });
    }

    _showProfileModal() {
        const {identity} = this.dataStore.state;
        const p = identity.profile ?? {};
        const form = new Component('form', {
            onsubmit: e => {
                e.preventDefault();
                this.handleAction('update-profile', new FormData(e.target));
            }
        });
        form.add(
            new Component('label', {textContent: 'Name:'}),
            new Component('input', {name: 'name', value: p.name ?? ''}),
            new Component('label', {textContent: 'Picture URL:'}),
            new Component('input', {name: 'picture', value: p.picture ?? ''}),
            new Component('label', {textContent: 'NIP-05 Identifier:'}),
            new Component('input', {name: 'nip05', value: p.nip05 ?? ''})
        );
        this.ui.showModal({
            title: 'Edit Profile',
            body: form,
            buttons: [
                new Button({textContent: 'Cancel', className: 'secondary', onClick: () => this.ui.hideModal()}),
                new Button({textContent: 'Save', type: 'submit', onClick: () => form.element.requestSubmit()})
            ]
        });
    }

    _showCreateGroupModal() {
        const form = new Component('form', {
            onsubmit: e => {
                e.preventDefault();
                this.handleAction('create-group', new FormData(e.target));
            }
        });
        form.add(
            new Component('label', {textContent: 'Group Name:'}),
            new Component('input', {name: 'name', placeholder: 'Group Name'})
        );
        this.ui.showModal({
            title: 'Create Group',
            body: form,
            buttons: [
                new Button({textContent: 'Cancel', className: 'secondary', onClick: () => this.ui.hideModal()}),
                new Button({textContent: 'Create', type: 'submit', onClick: () => form.element.requestSubmit()})
            ]
        });
    }

    _showJoinGroupModal() {
        const form = new Component('form', {
            onsubmit: e => {
                e.preventDefault();
                this.handleAction('join-group', new FormData(e.target));
            }
        });
        form.add(
            new Component('label', {textContent: 'Group ID:'}),
            new Component('input', {name: 'id', placeholder: 'Group ID'}),
            new Component('label', {textContent: 'Secret Key (Base64):'}),
            new Component('input', {name: 'key', placeholder: 'Secret Key'}),
            new Component('label', {textContent: 'Group Name (Optional, for display):'}),
            new Component('input', {name: 'name', placeholder: 'Group Name'})
        );
        this.ui.showModal({
            title: 'Join Group',
            body: form,
            buttons: [
                new Button({textContent: 'Cancel', className: 'secondary', onClick: () => this.ui.hideModal()}),
                new Button({textContent: 'Join', type: 'submit', onClick: () => form.element.requestSubmit()})
            ]
        });
    }

    _showCreateDmModal() {
        const form = new Component('form', {
            onsubmit: e => {
                e.preventDefault();
                this.handleAction('create-dm', new FormData(e.target));
            }
        });
        form.add(
            new Component('label', {textContent: "Recipient's Public Key (npub or hex):"}),
            new Component('input', {name: 'pubkey', placeholder: "npub..."})
        );
        this.ui.showModal({
            title: 'New Direct Message',
            body: form,
            buttons: [
                new Button({textContent: 'Cancel', className: 'secondary', onClick: () => this.ui.hideModal()}),
                new Button({textContent: 'Start DM', type: 'submit', onClick: () => form.element.requestSubmit()})
            ]
        });
    }

    _showGroupInfoModal() {
        const {activeThoughtId, thoughts} = this.dataStore.state;
        const group = thoughts[activeThoughtId];
        if (!group || group.type !== 'group') {
            this.ui.showToast('Not a group thought.', 'error');
            return;
        }
        const form = new Component('form');
        form.add(
            new Component('label', {textContent: 'Group ID:'}),
            new Component('input', {name: 'id', value: group.id, readOnly: true}),
            new Component('label', {textContent: 'Secret Key (Base64):'}),
            new Component('input', {name: 'key', value: group.secretKey, readOnly: true, type: 'text'}) // Keep visible for copy
        );
        this.ui.showModal({
            title: 'Group Info',
            body: form,
            buttons: [
                new Button({textContent: 'Close', className: 'secondary', onClick: () => this.ui.hideModal()})
            ]
        });
    }

    _showRelaysModal() {
        const {relays} = this.dataStore.state;
        const body = new Component('div');
        const list = new Component('ul', {
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
        relays.forEach(url => {
            const listItem = new Component('li', {
                style: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 0'
                }
            });
            listItem.add(new Component('span', {
                textContent: Utils.escapeHtml(url),
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
                className: 'danger',
                onClick: () => this.handleAction('remove-relay', url)
            }));
            list.add(listItem);
        });
        const form = new Component('form', {
            onsubmit: e => {
                e.preventDefault();
                this.handleAction('add-relay', new FormData(e.target));
                e.target.reset(); // Clear input after adding
            }
        });
        form.add(new Component('label', {textContent: 'Add Relay:'}), new Component('input', {
            name: 'url',
            placeholder: 'wss://...'
        }), new Button({textContent: 'Add', type: 'submit'}));
        body.add(list, form);
        this.ui.showModal({
            title: 'Manage Relays',
            body,
            buttons: [new Button({
                textContent: 'Close',
                className: 'secondary',
                onClick: () => this.ui.hideModal()
            })]
        });
    }

    // Dispatcher for modal types
    showModal(name) {
        const modalDispatch = {
            'profile': this._showProfileModal,
            'createGroup': this._showCreateGroupModal,
            'joinGroup': this._showJoinGroupModal,
            'createDm': this._showCreateDmModal,
            'groupInfo': this._showGroupInfoModal,
            'relays': this._showRelaysModal,
            // 'identity' is handled directly by handleAction 'manage-identity'
        };
        const handler = modalDispatch[name];
        if (handler) {
            handler.call(this); // Call the specific modal handler
        } else {
            Logger.warn(`Unknown modal type: ${name}`);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => new App());
