// --- CONSTANTS ---
import {EventEmitter, Logger, Utils} from "./utils.js";
import {Button, Component} from "./ui.js";
import {Nostr} from "./nostr.js";

const {generateSecretKey, getPublicKey, finalizeEvent, verifyEvent, nip19, nip04, SimplePool} = NostrTools;

const MESSAGE_LIMIT = 100; // Max messages to keep per thought

class Data extends EventEmitter {
    constructor() {
        super();
        this.state = {
            identity: {sk: null, pk: null, profile: null},
            relays: [
                'wss://relay.damus.io',
                'wss://nostr.wine',
                'wss://nos.lol',
                'wss://relay.snort.social',
                'wss://eden.nostr.land',
                'wss://purple.plus',
                'wss://atlas.nostr.land',
                'wss://relay.nostr.band'
            ],
            thoughts: {},
            messages: {},
            profiles: {},
            activeThoughtId: 'public',
            fetchingProfiles: new Set(),
        };
        this.debounceTimer = null; // NEW: For debouncing state updates
        this.DEBOUNCE_DELAY = 100; // NEW: Debounce delay in ms
    }

    async load() {
        try {
            const [i, t, p, a, r] = await Promise.all([
                localforage.getItem('identity_v2').catch(() => null),
                localforage.getItem('thoughts_v3').catch(() => null),
                localforage.getItem('profiles_v2').catch(() => null),
                localforage.getItem('activeThoughtId_v3').catch(() => null),
                localforage.getItem('relays_v2').catch(() => null)
            ]);
            if (i?.skHex) {
                try {
                    this.state.identity.sk = Utils.hexToBytes(i.skHex);
                    this.state.identity.pk = getPublicKey(this.state.identity.sk);
                } catch (e) {
                    Logger.error("Failed to load identity:", e);
                    await this.clearIdentity();
                }
            }
            this.state.thoughts = t && typeof t === 'object' ? t : {};
            // Ensure public feed "thought" always exists
            if (!this.state.thoughts.public) {
                this.state.thoughts.public = {
                    id: 'public',
                    name: 'Public Feed',
                    type: 'public',
                    unread: 0,
                    lastEventTimestamp: 0
                };
            }
            this.state.profiles = p && typeof p === 'object' ? p : {};
            this.state.activeThoughtId = a && typeof a === 'string' ? a : 'public';
            this.state.relays = r && Array.isArray(r) ? r.filter(Utils.validateRelayUrl) : this.state.relays;
            if (this.state.identity.pk && this.state.profiles[this.state.identity.pk]) {
                this.state.identity.profile = this.state.profiles[this.state.identity.pk];
            }
            Object.values(this.state.thoughts).forEach(th => th.lastEventTimestamp = th.lastEventTimestamp ?? 0);
            this.emitStateUpdated(); // Changed to debounced emitter
        } catch (e) {
            Logger.error('DataStore load failed:', e);
            await this.clearIdentity();
            this.emitStateUpdated(); // Changed to debounced emitter
        }
    }

    setState(updater) {
        updater(this.state);
        this.emitStateUpdated(); // Changed to debounced emitter
    }

    // NEW: Debounced state update emitter
    emitStateUpdated() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.emit('state:updated', this.state);
            this.debounceTimer = null;
        }, this.DEBOUNCE_DELAY);
    }

    async saveIdentity(sk) {
        await localforage.setItem('identity_v2', {skHex: Utils.bytesToHex(sk)});
    }

    async saveThoughts() {
        await localforage.setItem('thoughts_v3', this.state.thoughts);
    }

    async saveProfiles() {
        await localforage.setItem('profiles_v2', this.state.profiles);
    }

    async saveActiveThoughtId() {
        await localforage.setItem('activeThoughtId_v3', this.state.activeThoughtId);
    }

    async saveRelays() {
        await localforage.setItem('relays_v2', this.state.relays);
    }

    async saveMessages(tId) {
        if (tId && Array.isArray(this.state.messages[tId])) {
            await localforage.setItem(`messages_${tId}`, this.state.messages[tId]);
        }
    }

    async clearIdentity() {
        const k = await localforage.keys();
        await Promise.all([
            localforage.removeItem('identity_v2'),
            localforage.removeItem('thoughts_v3'),
            localforage.removeItem('profiles_v2'),
            localforage.removeItem('activeThoughtId_v3'),
            ...k.filter(key => key.startsWith('messages_')).map(key => localforage.removeItem(key))
        ]);
        this.setState(s => {
            s.identity = {sk: null, pk: null, profile: null};
            s.thoughts = {
                public: {
                    id: 'public',
                    name: 'Public Feed',
                    type: 'public',
                    unread: 0,
                    lastEventTimestamp: 0
                }
            };
            s.messages = {};
            s.profiles = {};
            s.activeThoughtId = 'public';
        });
    }

    async loadMessages(tId) {
        if (tId) {
            try {
                const messages = await localforage.getItem(`messages_${tId}`);
                this.state.messages[tId] = Array.isArray(messages) ? messages : [];
            } catch (e) {
                Logger.error(`Failed to load messages for ${tId}:`, e);
                this.state.messages[tId] = [];
            }
            this.emit(`messages:${tId}:updated`, this.state.messages[tId]);
        }
    }
}


class IdentityPanel extends Component {
    constructor(app) {
        super('div', {id: 'identity-panel'});
        this.app = app;
        this.avatar = new Component('img', {className: 'avatar'});
        this.userName = new Component('div', {className: 'user-name'});
        this.userPubkey = new Component('div', {className: 'pubkey'});
        this.actionButtons = {
            identity: new Button({onClick: () => this.app.handleAction('manage-identity')}),
            profile: new Button({
                textContent: 'Profile',
                className: 'secondary',
                onClick: () => this.app.handleAction('show-modal', 'profile')
            }),
            createGroup: new Button({
                textContent: 'New Group',
                className: 'secondary',
                onClick: () => this.app.handleAction('show-modal', 'createGroup')
            }),
            joinGroup: new Button({
                textContent: 'Join Group',
                className: 'secondary',
                onClick: () => this.app.handleAction('show-modal', 'joinGroup')
            }),
            createDm: new Button({
                textContent: 'New DM',
                className: 'secondary',
                onClick: () => this.app.handleAction('show-modal', 'createDm')
            }),
            relays: new Button({
                textContent: 'Relays',
                className: 'secondary',
                onClick: () => this.app.handleAction('show-modal', 'relays')
            })
        };
        const userInfo = new Component('div', {className: 'user-info'}).add(this.avatar, new Component('div', {className: 'user-details'}).add(this.userName, this.userPubkey));
        const buttonsContainer = new Component('div', {className: 'action-buttons'}).add(...Object.values(this.actionButtons).map(b => b.element));
        this.add(userInfo, buttonsContainer);
        this.app.dataStore.on('state:updated', ({identity}) => this.update(identity));
    }

    update(identity) {
        const {pk, profile} = identity || {};
        const isLoggedIn = !!pk;
        const displayName = isLoggedIn ? (profile?.name || Utils.shortenPubkey(pk)) : 'Anonymous';
        const pubkeyText = isLoggedIn ? nip19.npubEncode(pk) : 'No identity loaded';
        const avatarSrc = isLoggedIn ? (profile?.picture || Utils.createAvatarSvg(displayName, pk)) : Utils.createAvatarSvg('?', '#ccc');
        this.avatar.element.src = avatarSrc;
        this.avatar.element.onerror = () => this.avatar.element.src = Utils.createAvatarSvg(displayName, pk);
        this.userName.setContent(Utils.escapeHtml(displayName));
        this.userPubkey.setContent(Utils.escapeHtml(pubkeyText));
        this.actionButtons.identity.setContent(isLoggedIn ? 'Logout' : 'Load/Create');
        Object.values(this.actionButtons).forEach(btn => {
            if (btn !== this.actionButtons.identity && btn !== this.actionButtons.relays) btn.setEnabled(isLoggedIn);
        });
    }
}

class ThoughtList extends Component {
    constructor(app) {
        super('div', {id: 'thoughts-list'});
        this.app = app;
        this.app.dataStore.on('state:updated', s => this.render(s));
        this.element.addEventListener('click', e => {
            const t = e.target.closest('.thought-item');
            if (t?.dataset.id) this.app.handleAction('select-thought', t.dataset.id);
        });
    }

    render({thoughts, profiles, activeThoughtId, identity} = {}) {
        this.setContent('');
        if (!thoughts || !profiles) {
            this.setContent('<div style="padding: 16px; color: var(--text-secondary);">No thoughts available.</div>');
            return;
        }
        const sorted = Object.values(thoughts).sort((a, b) => (b.lastEventTimestamp ?? 0) - (a.lastEventTimestamp ?? 0));
        sorted.forEach(t => {
            if (!t?.id || ((t.type === 'dm' || t.type === 'group') && !identity.sk)) return;
            const p = profiles[t.pubkey] || {}, name = t.type === 'dm' && p.name ? p.name : t.name;
            const icons = {public: '🌐', dm: '👤', group: '👥', note: '📝'}, metas = {
                public: 'Public Feed',
                dm: 'Direct Message',
                group: 'Encrypted Group',
                note: 'Private Note'
            };
            const item = new Component('div', {
                className: `thought-item ${t.id === activeThoughtId ? 'active' : ''}`,
                innerHTML: `<div class="thought-icon">${icons[t.type] ?? '❓'}</div> <div class="thought-details"> <div class="thought-name"><span>${Utils.escapeHtml(name || 'Unknown')}</span>${t.unread > 0 ? `<span class="thought-unread">${t.unread}</span>` : ''}</div> <div class="thought-meta">${Utils.escapeHtml(metas[t.type] ?? '')}</div></div>`
            });
            item.element.dataset.id = t.id;
            this.add(item);
        });
        if (sorted.length === 0) {
            this.setContent('<div style="padding: 16px; color: var(--text-secondary);">No thoughts available.</div>');
        }
    }
}

class MainView extends Component {
    constructor(app) {
        super('div', {id: 'main-view'});
        this.app = app;
        this.headerName = new Component('div', {className: 'thought-header-name'});
        this.headerActions = new Component('div', {id: 'thought-header-actions'});
        this.header = new Component('div', {id: 'thought-header'}).add(this.headerName, this.headerActions);
        this.messages = new Component('div', {id: 'message-list'});
        this.inputForm = new Component('form', {id: 'message-input-form', autocomplete: 'off'});
        this.input = new Component('textarea', {id: 'message-input', placeholder: 'Type your message...'});
        this.sendButton = new Button({textContent: 'Send', type: 'submit'});
        this.inputForm.add(this.input, this.sendButton);
        this.add(this.header, this.messages, this.inputForm);
        this.inputForm.element.addEventListener('submit', e => {
            e.preventDefault();
            this.sendMessage();
        });
        this.input.element.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        this.previousThoughtId = null;
        this.messageRenderQueue = []; // Queue for messages to be rendered incrementally
        this.renderScheduled = false; // Flag to prevent multiple requestAnimationFrame calls
        this.handleMessagesUpdated = this.queueMessagesForRender.bind(this); // Bind once for consistent listener
        this.renderedMessageIds = new Set(); // Keep track of IDs of messages currently in DOM
        this.DISPLAY_MESSAGE_LIMIT = 50; // NEW: Limit for messages displayed in UI

        this.app.dataStore.on('state:updated', s => this.update(s));
    }

    update({activeThoughtId, thoughts, profiles, identity} = {}) {
        const thought = thoughts?.[activeThoughtId];
        if (!thought) {
            this.headerName.setContent('No Thought Selected');
            this.messages.setContent('<div class="message system"><div class="message-content">Select a thought to view messages.</div></div>');
            this.inputForm.show(false);
            this.previousThoughtId = null;
            // Ensure message tracking is reset if no thought is selected
            this.messageRenderQueue = [];
            this.renderedMessageIds.clear();
            this.renderScheduled = false; // Cancel any pending render
            return;
        }

        this.renderHeader(thought, profiles || {});
        this.inputForm.show(!!identity.sk && thought.type !== 'note');

        // If active thought changes, re-subscribe to messages and trigger a full render
        if (this.previousThoughtId !== activeThoughtId) {
            if (this.previousThoughtId) {
                this.app.dataStore.off(`messages:${this.previousThoughtId}:updated`, this.handleMessagesUpdated);
            }
            this.app.dataStore.on(`messages:${activeThoughtId}:updated`, this.handleMessagesUpdated);

            // Clear existing messages in DOM and reset tracking for a full re-render
            this.messages.setContent(''); // Clear DOM
            this.messageRenderQueue = []; // Clear any pending messages from previous thought
            this.renderedMessageIds.clear(); // Reset the set of rendered IDs

            // Manually queue only the latest DISPLAY_MESSAGE_LIMIT messages for the new thought for the initial render
            const currentMessages = this.app.dataStore.state.messages[activeThoughtId] || [];
            const initialMessagesToRender = currentMessages.slice(-this.DISPLAY_MESSAGE_LIMIT);
            this.messageRenderQueue.push(...initialMessagesToRender);
            initialMessagesToRender.forEach(msg => this.renderedMessageIds.add(msg.id)); // Populate rendered IDs for initial batch

            this.scheduleRender(); // Schedule the full render
        }
        // If the thought is the same, `queueMessagesForRender` will handle new messages
        // and `App.selectThought` already clears unread.

        this.previousThoughtId = activeThoughtId;
    }

    queueMessagesForRender(updatedMessagesArray) {
        // This function is called when `messages:tId:updated` is emitted.
        // It receives the *entire* updated message array for the active thought.
        // We need to determine which messages are new and add them to the queue.

        const messagesToAdd = [];
        for (const msg of updatedMessagesArray) {
            if (!this.renderedMessageIds.has(msg.id)) {
                messagesToAdd.push(msg);
                this.renderedMessageIds.add(msg.id); // Add to tracking set as we queue it
            }
        }

        if (messagesToAdd.length > 0) {
            this.messageRenderQueue.push(...messagesToAdd);
            this.scheduleRender();
        }
    }

    scheduleRender() {
        if (!this.renderScheduled) {
            this.renderScheduled = true;
            requestAnimationFrame(() => {
                this.renderMessages();
                this.renderScheduled = false;
            });
        }
    }

    renderHeader(thought, profiles) {
        const name = thought.type === 'dm' ? (profiles[thought.pubkey]?.name ?? thought.name) : thought.name;
        this.headerName.setContent(Utils.escapeHtml(name || 'Unknown'));
        this.headerActions.setContent('');
        if (thought.type === 'group') {
            this.headerActions.add(
                new Button({
                    textContent: 'Info',
                    className: 'secondary',
                    onClick: () => this.app.handleAction('show-modal', 'groupInfo')
                }),
                new Button({
                    textContent: 'Leave',
                    className: 'danger',
                    onClick: () => this.app.handleAction('leave-thought')
                })
            );
        } else if (thought.type !== 'public') {
            this.headerActions.add(
                new Button({
                    textContent: 'Hide',
                    className: 'danger',
                    onClick: () => this.app.handleAction('leave-thought')
                })
            );
        }
    }

    renderMessages() {
        const {activeThoughtId, identity, profiles} = this.app.dataStore.state;
        const msgsToRender = [...this.messageRenderQueue]; // Take a snapshot of the queue
        this.messageRenderQueue = []; // Clear the queue immediately

        // If there are no messages to render and no messages currently displayed, show initial empty state.
        // This implies that `update` has already cleared the DOM and `renderedMessageIds` if a thought switch occurred.
        if (msgsToRender.length === 0 && this.renderedMessageIds.size === 0) {
            this.messages.setContent(''); // Ensure it's truly empty before adding system message
            this.messages.add(new Component('div', {
                className: 'message system',
                innerHTML: `<div class="message-content">${activeThoughtId === 'public' ? "Listening to Nostr's global feed..." : 'No messages yet.'}</div>`
            }));
            return;
        }

        // Capture scroll state *before* rendering
        const isScrolledToBottom = this.messages.element.scrollHeight - this.messages.element.clientHeight <= this.messages.element.scrollTop + 1; // Small buffer

        // Sort messages in the current batch before rendering to ensure correct order
        msgsToRender.sort((a, b) => a.created_at - b.created_at);

        const fragment = document.createDocumentFragment(); // Use a document fragment for efficient DOM updates

        msgsToRender.forEach(msg => {
            if (!msg?.pubkey || !msg.created_at) return;

            const isSelf = msg.pubkey === identity?.pk;
            const p = profiles?.[msg.pubkey] ?? {name: Utils.shortenPubkey(msg.pubkey)};
            const senderName = isSelf ? 'You' : p.name;
            const avatarSrc = p.picture ?? Utils.createAvatarSvg(senderName, msg.pubkey);
            const msgEl = new Component('div', {
                className: `message ${isSelf ? 'self' : ''}`,
                innerHTML: `<div class="message-avatar"><img class="avatar" src="${avatarSrc}" onerror="this.src='${Utils.createAvatarSvg(senderName, msg.pubkey)}'"></div><div class="message-content"><div class="message-header"><div class="message-sender" style="color: ${Utils.getUserColor(msg.pubkey)}">${Utils.escapeHtml(senderName)}</div><div class="message-time">${Utils.formatTime(msg.created_at)}</div></div><div class="message-text">${Utils.escapeHtml(msg.content || '')}</div></div>`
            });
            msgEl.element.dataset.id = msg.id; // Store event ID on the element for tracking
            fragment.appendChild(msgEl.element); // Append to fragment
        });

        this.messages.element.appendChild(fragment); // Append fragment to DOM once

        // NEW: Prune old messages if exceeding display limit
        while (this.messages.element.children.length > this.DISPLAY_MESSAGE_LIMIT) {
            const oldestChild = this.messages.element.firstElementChild;
            if (oldestChild && oldestChild.dataset.id) {
                this.renderedMessageIds.delete(oldestChild.dataset.id);
            }
            oldestChild.remove();
        }

        // After rendering, ensure the scroll position is at the bottom if new messages were added
        // ONLY if the user was already at the bottom or if it's the initial load.
        if (msgsToRender.length > 0 && isScrolledToBottom) {
            this.messages.element.scrollTop = this.messages.element.scrollHeight;
        }
    }

    sendMessage() {
        const content = this.input.element.value.trim();
        if (!content) return;
        this.app.handleAction('send-message', content);
        this.input.element.value = '';
        this.input.element.style.height = '44px';
    }
}

// --- UI & APP CONTROLLER ---
class UI {
    constructor() {
        this.modal = this.createModal();
        this.toastContainer = new Component('div', {className: 'toast-container'}).mount(document.body);
    }

    createModal() {
        const modal = new Component('div', {className: 'modal-overlay'});
        modal.add(new Component('div', {className: 'modal-content'})).mount(document.body);
        modal.element.addEventListener('click', e => {
            if (e.target === modal.element) this.hideModal();
        });
        return modal;
    }

    showModal({title, body, buttons}) {
        const content = this.modal.element.querySelector('.modal-content');
        content.innerHTML = '';
        content.append(new Component('h3', {textContent: title}).element, body.element || body, new Component('div', {className: 'modal-buttons'}).add(...buttons.map(b => b.element)).element);
        this.modal.element.classList.add('visible');
    }

    hideModal() {
        this.modal.element.classList.remove('visible');
    }

    showToast(message, type = 'info', duration = 3000) {
        const t = new Component('div', {className: 'toast', textContent: message});
        t.element.style.background = `var(--${{
            error: 'danger',
            success: 'success',
            warn: 'warning'
        }[type] ?? 'header-bg'})`;
        this.toastContainer.add(t);
        setTimeout(() => t.element.classList.add('visible'), 10);
        setTimeout(() => {
            t.element.classList.remove('visible');
            setTimeout(() => t.destroy(), 300);
        }, duration);
    }

    setLoading(isLoading) {
        document.getElementById('loading-indicator')?.remove();
        if (isLoading) document.body.insertAdjacentHTML('beforeend', '<div id="loading-indicator">Loading...</div>');
    }
}

class App {
    constructor() {
        this.dataStore = new Data();
        this.ui = new UI();
        this.nostr = new Nostr(this.dataStore);
        this.nostr.ui = this.ui;
        this.nostr.appController = this; // Pass reference to AppController for historical fetches
        this.init();
        window.addEventListener('unhandledrejection', e => {
            Logger.error('Unhandled promise rejection:', e.reason);
            this.ui.showToast(`Error: ${e.reason.message || 'Unknown error'}`, 'error');
        });

        // Removed diagnostic log: Logger.log('NostrTools object:', NostrTools);
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

        this.nostr.on('event', ({event, subId}) => this.processNostrEvent(event, subId));

        this.dataStore.on('state:updated', ({identity}) => {
            if (this.currentPk !== undefined && this.currentPk !== identity.pk) {
                this.currentPk = identity.pk;
                this.nostr.connect(); // This will re-subscribe core events
            }
        });

        await this.dataStore.load();
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

    async processNostrEvent(event, subId) {
        try {
            //Logger.log(`[App] Processing Nostr event: kind=${event.kind}, subId=${subId}, id=${event.id}`);
            if (!verifyEvent(event)) {
                Logger.warn('Invalid event signature:', event);
                return;
            }

            let thoughtId, content = event.content;

            switch (event.kind) {
                case 0: // Profile metadata
                    return await this.processKind0(event);

                case 1: // Public text note
                    if (subId === 'public' || subId.startsWith('historical-public')) { // Ensure it's from the public feed subscription or historical fetch
                        thoughtId = 'public';
                    } else {
                        return; // Ignore other kind 1s (e.g., replies fetched for other reasons)
                    }
                    break;

                case 4: // Encrypted Direct Message
                    const other = event.pubkey === this.dataStore.state.identity.pk ? Utils.findTag(event, 'p') : event.pubkey;
                    if (!other) return;
                    thoughtId = other;
                    try {
                        if (!this.dataStore.state.identity.sk) {
                            Logger.warn(`Cannot decrypt DM, identity not loaded. Event ID: ${event.id}`);
                            return;
                        }
                        content = await nip04.decrypt(this.dataStore.state.identity.sk, other, event.content);
                        if (!this.dataStore.state.thoughts[thoughtId]) {
                            this.dataStore.setState(s => s.thoughts[thoughtId] = {
                                id: thoughtId, name: Utils.shortenPubkey(thoughtId), type: 'dm',
                                pubkey: thoughtId, unread: 0, lastEventTimestamp: Utils.now()
                            });
                            await this.dataStore.saveThoughts();
                            this.nostr.fetchProfile(thoughtId);
                        }
                    } catch (e) {
                        Logger.warn(`Failed to decrypt DM for ${thoughtId}:`, e);
                        return;
                    }
                    break;

                case 41: // Encrypted Group Message
                    const gTag = Utils.findTag(event, 'g');
                    if (!gTag) return;
                    thoughtId = gTag;
                    const group = this.dataStore.state.thoughts[thoughtId];
                    if (!group?.secretKey) return; // Group not found or no secret key
                    try {
                        content = await Utils.crypto.aesDecrypt(event.content, group.secretKey);
                    } catch (e) {
                        Logger.warn(`Failed to decrypt group message for ${thoughtId}:`, e);
                        return;
                    }
                    break;

                default:
                    return; // Ignore all other event kinds
            }

            if (thoughtId) {
                await this.processMessage({...event, content}, thoughtId);
            }
        } catch (e) {
            Logger.error('Error processing Nostr event:', e);
        }
    }

    async processMessage(msg, tId) {
        try {
            const {messages, activeThoughtId, identity} = this.dataStore.state;

            let msgs = messages[tId];
            if (!msgs) {
                msgs = [];
                messages[tId] = msgs; // Update state directly
            }

            if (msgs.some(m => m.id === msg.id)) {
                return;
            }

            msgs.push(msg);

            if (msgs.length > MESSAGE_LIMIT) {
                msgs.shift();
            }

            msgs.sort((a, b) => a.created_at - b.created_at);

            // Update the thought's last event timestamp and unread count directly
            const t = this.dataStore.state.thoughts[tId];
            if (t) {
                t.lastEventTimestamp = Math.max(t.lastEventTimestamp || 0, msg.created_at);
                if (tId !== activeThoughtId && msg.pubkey !== identity.pk) {
                    t.unread = (t.unread || 0) + 1;
                }
            }

            if (tId !== 'public') {
                await this.dataStore.saveMessages(tId);
            }

            // Emit message update event for the specific thought
            this.dataStore.emit(`messages:${tId}:updated`, msgs);

            // Emit general state update for ThoughtList and IdentityPanel (now debounced)
            this.dataStore.emitStateUpdated(); // Changed to debounced emitter

            this.nostr.fetchProfile(msg.pubkey);
        } catch (e) {
            Logger.error(`Error processing message for ${tId}:`, e);
        }
    }

    async processKind0(event) {
        try {
            const p = JSON.parse(event.content);
            const n = {
                name: p.name || p.display_name || Utils.shortenPubkey(event.pubkey),
                picture: p.picture,
                nip05: p.nip05,
                pubkey: event.pubkey,
                lastUpdatedAt: event.created_at
            };
            const existingProfile = this.dataStore.state.profiles[event.pubkey];
            // Only update if newer or if no existing profile
            if (!existingProfile || n.lastUpdatedAt > (existingProfile.lastUpdatedAt ?? 0)) {
                this.dataStore.setState(s => {
                    s.profiles[event.pubkey] = n;
                    if (n.pubkey === s.identity.pk) s.identity.profile = n; // Update user's own profile
                });
                await this.dataStore.saveProfiles();
            }
        } catch (e) {
            Logger.warn('Error parsing profile event:', e);
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
            } else if (t.type === 'public') {
                // It's a kind 1, public note. No changes needed.
            } else {
                throw new Error("Cannot send message in this thought type.");
            }
            const event = await this.nostr.publish(eventTemplate);
            // Process the *sent* message immediately so it appears in UI
            await this.processMessage({...event, content}, activeThoughtId);
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
            await this.processKind0(event); // Process the published profile event
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
