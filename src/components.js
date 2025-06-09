import { Component, Button } from './ui.js';
import { Utils } from './utils.js';
// NostrTools will be available globally via script tag in index.html
// So, nip19 and nip04 (used in MainView) should be available.
const { nip19, nip04 } = NostrTools; // Assuming NostrTools is global

export class IdentityPanel extends Component {
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
            }),
            createNote: new Button({
                textContent: 'New Note',
                className: 'secondary',
                onClick: () => this.app.handleAction('create-note')
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

export class ThoughtList extends Component {
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

export class MainView extends Component {
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

        this.noteTitleInput = new Component('input', { id: 'note-title-input', type: 'text', placeholder: 'Note Title' });
        this.noteBodyTextarea = new Component('textarea', { id: 'note-body-textarea', placeholder: 'Your note...' });
        this.noteEditorContainer = new Component('div', { id: 'note-editor-container' });
        this.noteEditorContainer.add(this.noteTitleInput, this.noteBodyTextarea);
        this.noteEditorContainer.show(false);

        this.add(this.header, this.noteEditorContainer, this.messages, this.inputForm);

        this.noteTitleInput.element.addEventListener('input', (e) => this.handleNoteUpdate('title', e.target.value));
        this.noteBodyTextarea.element.addEventListener('input', (e) => this.handleNoteUpdate('body', e.target.value));

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
        this.messageRenderQueue = [];
        this.renderScheduled = false;
        this.handleMessagesUpdated = this.queueMessagesForRender.bind(this);
        this.renderedMessageIds = new Set();
        this.DISPLAY_MESSAGE_LIMIT = 50;

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

        if (thought.type === 'note') {
            this.messages.show(false);
            this.noteEditorContainer.show(true);
            this.noteTitleInput.element.value = thought.name || '';
            this.noteBodyTextarea.element.value = thought.body || '';

            this.messageRenderQueue = [];
            this.renderedMessageIds.clear();
            if (this.messages.element.firstChild && this.messages.element.firstChild.classList.contains('system')) {
                this.messages.setContent('');
            }
        } else {
            this.messages.show(true);
            this.noteEditorContainer.show(false);
            if (this.previousThoughtId !== activeThoughtId) {
                if (this.previousThoughtId) {
                    this.app.dataStore.off(`messages:${this.previousThoughtId}:updated`, this.handleMessagesUpdated);
                }
                this.app.dataStore.on(`messages:${activeThoughtId}:updated`, this.handleMessagesUpdated);

                this.messages.setContent('');
                this.messageRenderQueue = [];
                this.renderedMessageIds.clear();

                const currentMessages = this.app.dataStore.state.messages[activeThoughtId] || [];
                const initialMessagesToRender = currentMessages.slice(-this.DISPLAY_MESSAGE_LIMIT);
                this.messageRenderQueue.push(...initialMessagesToRender);
                initialMessagesToRender.forEach(msg => this.renderedMessageIds.add(msg.id));

                this.scheduleRender();
            }
        }

        this.previousThoughtId = activeThoughtId;
    }

    queueMessagesForRender(updatedMessagesArray) {
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

        if (thought.type === 'note') {
        } else if (thought.type === 'group') {
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

        if (msgsToRender.length === 0 && this.renderedMessageIds.size === 0) {
            this.messages.setContent('');
            this.messages.add(new Component('div', {
                className: 'message system',
                innerHTML: `<div class="message-content">${activeThoughtId === 'public' ? "Listening to Nostr's global feed..." : 'No messages yet.'}</div>`
            }));
            return;
        }

        const isScrolledToBottom = this.messages.element.scrollHeight - this.messages.element.clientHeight <= this.messages.element.scrollTop + 1;

        msgsToRender.sort((a, b) => a.created_at - b.created_at);

        const fragment = document.createDocumentFragment();

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
            msgEl.element.dataset.id = msg.id;
            fragment.appendChild(msgEl.element);
        });

        this.messages.element.appendChild(fragment);

        while (this.messages.element.children.length > this.DISPLAY_MESSAGE_LIMIT) {
            const oldestChild = this.messages.element.firstElementChild;
            if (oldestChild && oldestChild.dataset.id) {
                this.renderedMessageIds.delete(oldestChild.dataset.id);
            }
            oldestChild.remove();
        }

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

    handleNoteUpdate(field, value) {
        const { activeThoughtId, thoughts } = this.app.dataStore.state;
        const thought = thoughts[activeThoughtId];

        if (thought && thought.type === 'note') {
            if (field === 'title') {
                thought.name = value;
            } else if (field === 'body') {
                thought.body = value; // Use thought.body for notes
            }
            thought.lastEventTimestamp = Utils.now();
            this.app.dataStore.saveThoughts(); // Save changes
            this.app.dataStore.emitStateUpdated(); // Notify other components (like ThoughtList)
        }
    }
}
