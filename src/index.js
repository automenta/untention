// --- CONSTANTS ---
import {Utils, Logger, EventEmitter } from "./utils.js";

const MESSAGE_LIMIT = 100; // Max messages to keep per thought

// --- UTILS & CORE SERVICES ---
const {generateSecretKey, getPublicKey, finalizeEvent, verifyEvent, nip19, nip04, SimplePool} = NostrTools;


class DataStore extends EventEmitter {
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
            this.emit('state:updated', this.state);
        } catch (e) {
            Logger.error('DataStore load failed:', e);
            await this.clearIdentity();
            this.emit('state:updated', this.state);
        }
    }

    setState(updater) {
        updater(this.state);
        this.emit('state:updated', this.state);
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

class NostrService extends EventEmitter {
    constructor(dataStore) {
        super();
        this.dataStore = dataStore;
        this.pool = new SimplePool();
        this.subs = new Map();
        this.seenEventIds = new Set();
        this.connectionStatus = 'disconnected';
        this.appController = null; // Will be set by AppController
    }

    connect() {
        this.disconnect(); // Clear previous state
        const relays = this.dataStore.state.relays;
        if (relays.length === 0) {
            this.updateConnectionStatus('disconnected');
            this.ui?.showToast('No relays configured. Please add relays.', 'warn');
            return;
        }

        this.pool = new SimplePool(); // Create a new pool for a new connection attempt
        this.updateConnectionStatus('connecting');
        this.subscribeToCoreEvents();
        this.updateConnectionStatus('connected'); // Immediately show connected, actual events will flow
        this.ui?.showToast(`Subscriptions sent to ${relays.length} relays.`, 'success');
    }

    disconnect() {
        // Unsubscribe all active subscriptions first
        this.subs.forEach(sub => {
            if (sub && typeof sub.unsub === 'function') {
                sub.unsub();
            } else {
                Logger.warn('Attempted to unsub an invalid subscription object:', sub);
            }
        });
        this.subs.clear(); // Clear the map after unsubscribing

        // Then close the pool connections
        if (this.pool) {
            this.pool.close(this.dataStore.state.relays); // This closes WebSocket connections
        }

        this.updateConnectionStatus('disconnected');
    }

    updateConnectionStatus(status) {
        if (this.connectionStatus === status) return;
        this.connectionStatus = status;
        Logger.log(`Relay status: ${status}`);
        this.emit('connection:status', {
            status,
            count: this.dataStore.state.relays.length
        });
    }

    subscribe(id, filters) {
        this.subs.get(id)?.unsub(); // Unsubscribe from previous subscription with the same ID

        const currentRelays = this.dataStore.state.relays;
        if (currentRelays.length === 0) {
            Logger.warn(`Not subscribing to ${id}: No relays available.`);
            return;
        }

        const sub = this.pool.subscribe(currentRelays, filters, {
            onevent: (event) => {
                if (this.seenEventIds.has(event.id)) return;
                this.seenEventIds.add(event.id);
                if (this.seenEventIds.size > 2000) {
                    // Keep the seenEventIds set from growing indefinitely
                    // Simple approach: convert to array, slice, convert back to Set
                    const tempArray = Array.from(this.seenEventIds);
                    this.seenEventIds = new Set(tempArray.slice(tempArray.length - 1500)); // Keep last 1500
                }
                this.emit('event', {event, subId: id});
            },
            oneose: () => Logger.log(`[EOSE] for sub '${id}'`),
            onclose: (reason) => Logger.warn(`Subscription ${id} closed: ${reason}`),
        });
        this.subs.set(id, sub);
    }

    async publish(eventTemplate) {
        const {sk} = this.dataStore.state.identity;
        if (!sk) throw new Error('Not logged in.');

        const signedEvent = finalizeEvent(eventTemplate, sk);
        const currentRelays = this.dataStore.state.relays;
        if (currentRelays.length === 0) throw new Error('No relays available for publishing.');

        try {
            await Promise.any(this.pool.publish(currentRelays, signedEvent));
            return signedEvent;
        } catch (e) {
            Logger.error('Publish failed on all relays:', e);
            throw new Error('Failed to publish event to any relay.');
        }
    }

    subscribeToCoreEvents() {
        const currentRelays = this.dataStore.state.relays;
        if (currentRelays.length === 0) {
            Logger.warn('Not subscribing to core events: No relays available.');
            return;
        }
        // These subscriptions are for real-time streaming of new events.
        // Historical fetching is handled by fetchHistoricalMessages.
        // Removed 'since' filter for public feed to align with working snippet's behavior
        // and receive all new incoming messages regardless of age.
        this.subscribe('public', [{kinds: [1]}]); // No limit or since here, just stream
        const {identity} = this.dataStore.state;
        if (identity.pk) {
            const sevenDaysAgo = Utils.now() - (7 * 24 * 60 * 60); // Events from the last 7 days for live stream
            this.subscribe('dms', [{kinds: [4], '#p': [identity.pk], since: sevenDaysAgo}]);
            this.subscribe('profile', [{kinds: [0], authors: [identity.pk], limit: 1}]);
            this.resubscribeToGroups();
        }
    }

    resubscribeToGroups() {
        const gids = Object.values(this.dataStore.state.thoughts).filter(c => c.type === 'group').map(c => c.id);
        const currentRelays = this.dataStore.state.relays;
        if (gids.length > 0 && currentRelays.length > 0) {
            const sevenDaysAgo = Utils.now() - (7 * 24 * 60 * 60); // Events from the last 7 days for live stream
            this.subscribe('groups', [{
                kinds: [41],
                '#g': gids,
                since: sevenDaysAgo
            }]);
        } else {
            this.subs.get('groups')?.unsub();
        }
    }

    /**
     * Fetches historical messages for a specific thought using querySync.
     * These events will then be processed by AppController.processNostrEvent.
     */
    async fetchHistoricalMessages(thought) {
        const {identity, relays} = this.dataStore.state;
        if (relays.length === 0 || !thought || !this.appController) {
            Logger.warn('Cannot fetch historical messages: Missing relays, thought, or appController reference.');
            return;
        }

        let filters = [];
        // Align public feed historical fetch with working feed.html's more conservative query.
        const publicHistoricalPeriod = Utils.now() - (60 * 60); // Last 1 hour for public feed
        const publicHistoricalLimit = 20; // Limit to 20 events for public feed
        const dmGroupHistoricalPeriod = Utils.now() - (7 * 24 * 60 * 60); // Last 7 days for DMs/Groups

        if (thought.type === 'public') {
            filters.push({kinds: [1], limit: publicHistoricalLimit, since: publicHistoricalPeriod});
        } else if (thought.type === 'dm' && identity.pk) {
            filters.push({
                kinds: [4],
                '#p': [thought.pubkey],
                authors: [identity.pk, thought.pubkey],
                limit: MESSAGE_LIMIT,
                since: dmGroupHistoricalPeriod
            });
        } else if (thought.type === 'group') {
            filters.push({kinds: [41], '#g': [thought.id], limit: MESSAGE_LIMIT, since: dmGroupHistoricalPeriod});
        } else {
            Logger.log(`Skipping historical fetch for unsupported thought type: ${thought.type}`);
            return;
        }

        Logger.log(`Attempting to fetch historical messages for thought ${thought.id} (${thought.type}) with filters:`, filters, 'from relays:', relays);
        try {
            const events = await this.pool.querySync(relays, filters);
            Logger.log(`Fetched ${events.length} historical events for ${thought.id}`);
            for (const event of events) {
                await this.appController.processNostrEvent(event, `historical-${thought.id}`);
            }
        } catch (e) {
            Logger.error(`Failed to fetch historical messages for ${thought.id}:`, e);
        }
    }

    async fetchProfile(pubkey) {
        const {profiles, fetchingProfiles, relays} = this.dataStore.state;
        if (!pubkey || profiles[pubkey]?.lastUpdatedAt || fetchingProfiles.has(pubkey) || relays.length === 0) return;

        fetchingProfiles.add(pubkey);
        this.emit('state:updated', this.dataStore.state);

        try {
            const event = await this.pool.get(relays, {kinds: [0], authors: [pubkey]});
            if (event) {
                this.emit('event', {event}); // Process the fetched profile event
            }
        } catch (e) {
            Logger.warn(`Profile fetch failed for ${pubkey}:`, e);
        } finally {
            fetchingProfiles.delete(pubkey);
            this.emit('state:updated', this.dataStore.state);
        }
    }
}

// --- DYNAMIC UI COMPONENT LIBRARY ---
class Component extends EventEmitter {
    constructor(tag, {id, className, ...props} = {}) {
        super();
        this.element = document.createElement(tag);
        if (id) this.element.id = id;
        if (className) this.element.className = className;
        Object.entries(props).forEach(([key, value]) => this.element[key] = value);
    }

    add(...children) {
        children.forEach(child => this.element.appendChild(child.element || child));
        return this;
    }

    setContent(content) {
        this.element.innerHTML = '';
        if (content) {
            if (typeof content === 'string') this.element.innerHTML = content;
            else this.add(content);
        }
        return this;
    }

    mount(parent) {
        (parent.element || parent).appendChild(this.element);
        return this;
    }

    show(visible = true) {
        this.element.classList.toggle('hidden', !visible);
        return this;
    }

    destroy() {
        this.element.remove();
    }
}

class Button extends Component {
    constructor(props) {
        super('button', props);
        if (props.onClick) this.element.addEventListener('click', props.onClick);
    }

    setEnabled(enabled) {
        this.element.disabled = !enabled;
    }
}

// --- APPLICATION-SPECIFIC UI COMPONENTS ---
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
        this.app.dataStore.on('state:updated', s => this.update(s));
    }

    update({activeThoughtId, thoughts, profiles, identity} = {}) {
        const thought = thoughts?.[activeThoughtId];
        if (!thought) {
            this.headerName.setContent('No Thought Selected');
            this.messages.setContent('<div class="message system"><div class="message-content">Select a thought to view messages.</div></div>');
            this.inputForm.show(false);
            return;
        }
        if (this.previousThoughtId !== activeThoughtId) {
            if (this.previousThoughtId) {
                this.app.dataStore.off(`messages:${this.previousThoughtId}:updated`);
            }
            this.app.dataStore.on(`messages:${activeThoughtId}:updated`, () => this.renderMessages(this.app.dataStore.state));
            // Messages are now loaded/fetched by AppController.selectThought
        }
        this.previousThoughtId = activeThoughtId;
        this.renderHeader(thought, profiles || {});
        this.renderMessages(this.app.dataStore.state);
        this.inputForm.show(!!identity.sk && thought.type !== 'note');
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

    renderMessages({activeThoughtId, messages, identity, profiles} = {}) {
        const msgs = messages?.[activeThoughtId] ?? [];
        this.messages.setContent('');
        if (!activeThoughtId || !messages) {
            this.messages.add(new Component('div', {
                className: 'message system',
                innerHTML: `<div class="message-content">Error loading messages.</div>`
            }));
            return;
        }
        if (msgs.length === 0) {
            this.messages.add(new Component('div', {
                className: 'message system',
                innerHTML: `<div class="message-content">${activeThoughtId === 'public' ? "Listening to Nostr's global feed..." : 'No messages yet.'}</div>`
            }));
            return;
        }
        msgs.forEach(msg => {
            if (!msg?.pubkey || !msg.created_at) return;
            const isSelf = msg.pubkey === identity?.pk;
            const p = profiles?.[msg.pubkey] ?? {name: Utils.shortenPubkey(msg.pubkey)};
            const senderName = isSelf ? 'You' : p.name;
            const avatarSrc = p.picture ?? Utils.createAvatarSvg(senderName, msg.pubkey);
            const msgEl = new Component('div', {
                className: `message ${isSelf ? 'self' : ''}`,
                innerHTML: `<div class="message-avatar"><img class="avatar" src="${avatarSrc}" onerror="this.src='${Utils.createAvatarSvg(senderName, msg.pubkey)}'"></div><div class="message-content"><div class="message-header"><div class="message-sender" style="color: ${Utils.getUserColor(msg.pubkey)}">${Utils.escapeHtml(senderName)}</div><div class="message-time">${Utils.formatTime(msg.created_at)}</div></div><div class="message-text">${Utils.escapeHtml(msg.content || '')}</div></div>`
            });
            this.messages.add(msgEl);
        });
        this.messages.element.scrollTop = this.messages.element.scrollHeight;
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
class UIManager {
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

class AppController {
    constructor() {
        this.dataStore = new DataStore();
        this.ui = new UIManager();
        this.nostr = new NostrService(this.dataStore);
        this.nostr.ui = this.ui;
        this.nostr.appController = this; // Pass reference to AppController for historical fetches
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

            // Ensure messages array exists for the thought, if not, initialize it.
            let msgs = messages[tId];
            if (!msgs) {
                msgs = [];
                this.dataStore.state.messages[tId] = msgs; // Update state directly for efficiency before setState
            }

            // Check for duplicate messages by ID
            if (msgs.some(m => m.id === msg.id)) return;

            // Add new message
            msgs.push(msg);

            // Implement circular buffer: remove oldest message if limit exceeded
            if (msgs.length > MESSAGE_LIMIT) {
                msgs.shift();
            }

            // Sort messages by creation time (necessary as events might arrive out of order)
            msgs.sort((a, b) => a.created_at - b.created_at);

            this.dataStore.setState(s => {
                // Update the thought's last event timestamp and unread count
                const t = s.thoughts[tId];
                if (t) {
                    t.lastEventTimestamp = Math.max(t.lastEventTimestamp || 0, msg.created_at);
                    if (tId !== activeThoughtId && msg.pubkey !== identity.pk) {
                        t.unread = (t.unread || 0) + 1;
                    }
                }
            });

            // Persist messages for DMs and groups, but not for the public feed
            if (tId !== 'public') {
                await this.dataStore.saveMessages(tId);
            }

            // Fetch profile of the sender if not already known
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

document.addEventListener('DOMContentLoaded', () => new AppController());
