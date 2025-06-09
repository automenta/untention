import { Logger, Utils } from "./utils.js";
import { Button, Component } from "./ui.js";
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
        this.init();
        window.addEventListener('unhandledrejection', e => {
            Logger.error('Unhandled promise rejection:', e.reason);
            this.ui.showToast(`Error: ${e.reason.message || 'Unknown error'}`, 'error');
        });

    }

    async init() {
        this.ui.setLoading(true);
        try {
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

        this.dataStore.on('state:updated', ({identity}) => {
            if (this.currentPk !== undefined && this.currentPk !== identity.pk) {
                this.currentPk = identity.pk;
                this.nostr.connect();
            }
        });

        await this.dataStore.load();
        if (!this.dataStore.state.identity.sk) {
            this._showIdentityModal();
        }
            this.currentPk = this.dataStore.state.identity.pk;
            this.nostr.connect();
            await this.nostr.fetchHistoricalMessages(this.dataStore.state.thoughts[this.dataStore.state.activeThoughtId]);
        } catch (e) {
            Logger.error('Initialization failed:', e);
            this.ui.showToast(`Initialization failed: ${e.message || 'Unknown error'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }

    async selectThought(id) {
        this.ui.setLoading(true);
        try {
            const {activeThoughtId, thoughts} = this.dataStore.state;
            const newActiveThoughtId = thoughts[id] ? id : 'public';

            if (activeThoughtId !== newActiveThoughtId) {
                this.dataStore.setState(s => {
                    s.activeThoughtId = newActiveThoughtId;
                    const t = s.thoughts[s.activeThoughtId];
                    if (t?.unread > 0) t.unread = 0;
                });
                await this.dataStore.saveActiveThoughtId();
                await this.dataStore.loadMessages(newActiveThoughtId);
                await this.nostr.fetchHistoricalMessages(this.dataStore.state.thoughts[newActiveThoughtId]);
            } else {
                this.dataStore.setState(s => {
                    const t = s.thoughts[s.activeThoughtId];
                    if (t?.unread > 0) t.unread = 0;
                });
                await this.dataStore.saveActiveThoughtId();
            }
        } catch (e) {
            Logger.error(`Error selecting thought ${id}:`, e);
            this.ui.showToast(`Failed to load thought: ${e.message || 'Unknown error'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }

    handleAction(action, data) {
        const actions = {
            'manage-identity': () => this.dataStore.state.identity.sk ? this.logout() : this._showIdentityModal(),
            'show-modal': (modal) => this.showModal(modal),
            'select-thought': (id) => this.selectThought(id),
            'leave-thought': () => this.leaveThought(),
            'send-message': (content) => this.sendMessage(content),
            'update-profile': (d) => this.updateProfile(d),
            'create-dm': (d) => this.createDmThought(d.get('pubkey')),
            'create-group': (d) => this.createGroupThought(d.get('name')),
            'join-group': (d) => this.joinGroupThought(d.get('id'), d.get('key'), d.get('name')),
            'add-relay': (d) => this.updateRelays([...this.dataStore.state.relays, d.get('url')]),
            'remove-relay': (url) => this.updateRelays(this.dataStore.state.relays.filter(u => u !== url)),
            'create-note': () => this.createNoteThought(),
        };
        if (actions[action]) actions[action](data);
    }

    async leaveThought() {
        const {activeThoughtId, thoughts} = this.dataStore.state;
        const t = thoughts[activeThoughtId];
        if (!t || !confirm(`Leave/hide ${t.type} "${t.name}"?`)) return;
        this.ui.setLoading(true);
        try {
            this.dataStore.setState(s => {
                delete s.thoughts[activeThoughtId];
                delete s.messages[activeThoughtId];
            });
            await Promise.all([localforage.removeItem(`messages_${activeThoughtId}`), this.dataStore.saveThoughts()]);
            this.selectThought('public');
            this.ui.showToast('Thought removed.', 'info');
        } catch (e) {
            Logger.error(`Error leaving thought ${activeThoughtId}:`, e);
            this.ui.showToast(`Failed to remove thought: ${e.message || 'Unknown error'}`, 'error');
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
            this.ui.showToast(`Logout failed: ${e.message || 'Unknown error'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
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
            await this.dataStore.load(); // Reloads data, which will trigger connect via state:updated
            this.ui.showToast('Identity loaded!', 'success');
        } catch (e) {
            this.ui.showToast(`Error: ${e.message || 'Unknown error'}`, 'error');
            // Attempt to clear identity again or ensure a clean state if primary load failed.
            // This is complex; current handling re-clears if sk processing fails.
            // If clearIdentity itself fails here, it's a deeper issue.
            if (!skInput) { // Only clear if it was a new key generation that failed partway
                await this.dataStore.clearIdentity();
            }
        } finally {
            this.ui.setLoading(false);
        }
    }

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
            } else if (t.type !== 'public') { // No specific handling for public, but error for other unknown types
                throw new Error("Cannot send message in this thought type.");
            }
            const signedEvent = await this.nostr.publish(eventTemplate);
            await this.nostr.processMessage({...signedEvent, content}, activeThoughtId);
            this.ui.showToast('Message sent!', 'success');
        } catch (e) {
            Logger.error("Send message error:", e);
            this.ui.showToast(`Failed to send message: ${e.message || 'Unknown error'}`, 'error');
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
            this.ui.showToast(`Profile update failed: ${e.message || 'Unknown error'}`, 'error');
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
            this.ui.showToast(`Error: ${e.message || 'Unknown error'}`, 'error');
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
            this.showModal('groupInfo');
        } catch (e) {
            Logger.error('Error creating group thought:', e);
            this.ui.showToast(`Failed to create group: ${e.message || 'Unknown error'}`, 'error');
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
            this.ui.showToast(`Failed to join group: ${e.message || 'Unknown error'}`, 'error');
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
            const newId = crypto.randomUUID();
            const newNote = {
                id: newId,
                name: 'New Note',
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
            this.ui.showToast(`Failed to create note: ${e.message || 'Unknown error'}`, 'error');
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
            this.ui.showToast(`Failed to update relays: ${e.message || 'Unknown error'}`, 'error');
        }
        // No finally setLoading(false) here as it's a quick op or error is shown,
        // and nostr.connect() will manage its own connection status updates.
    }

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
            new Component('input', {name: 'key', value: group.secretKey, readOnly: true, type: 'text'})
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
                e.target.reset();
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

    showModal(name) {
        const modalDispatch = {
            'profile': this._showProfileModal,
            'createGroup': this._showCreateGroupModal,
            'joinGroup': this._showJoinGroupModal,
            'createDm': this._showCreateDmModal,
            'groupInfo': this._showGroupInfoModal,
            'relays': this._showRelaysModal,
        };
        const handler = modalDispatch[name];
        if (handler) {
            handler.call(this);
        } else if (name !== 'identity') {
            Logger.warn(`Unknown modal type: ${name}`);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => new App());
