import DOMPurify from 'dompurify';
import {Button, Component} from '/ui/ui.js';
import {createAvatarSvg, escapeHtml, getUserColor} from '/utils/ui-utils.js';
import {formatTime, now} from '/utils/time-utils.js';
import {shortenPubkey} from '/utils/nostr-utils.js';

const { nip19, nip04 } = NostrTools;

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
        this.unsubscribeDataStore = this.app.dataStore.on('state:updated', ({identity}) => this.update(identity));
    }

    destroy() {
        if (this.unsubscribeDataStore) {
            this.unsubscribeDataStore();
            this.unsubscribeDataStore = null;
        }
        super.destroy();
    }

    update(identity) {
        const {pk, profile} = identity || {};
        const isLoggedIn = !!pk;
        const displayName = isLoggedIn ? (profile?.name || shortenPubkey(pk)) : 'Anonymous';
        const pubkeyText = isLoggedIn ? nip19.npubEncode(pk) : 'No identity loaded';
        const avatarSrc = isLoggedIn ? (profile?.picture || createAvatarSvg(displayName, pk)) : createAvatarSvg('?', '#ccc');
        this.avatar.element.src = avatarSrc;
        this.avatar.element.onerror = () => this.avatar.element.src = createAvatarSvg(displayName, pk);
        this.userName.setContent(escapeHtml(displayName));
        this.userPubkey.setContent(escapeHtml(pubkeyText));
        this.actionButtons.identity.setContent(isLoggedIn ? 'Logout' : 'Manage Identity');
        for (const key in this.actionButtons) {
            if (key !== 'identity' && key !== 'relays') {
                this.actionButtons[key].setEnabled(isLoggedIn);
            }
        }
    }
}

class NoThoughtSelectedView extends Component {
    constructor() {
        super('div', { id: 'no-thought-selected-view', className: 'no-thought-content-wrapper' });
        this.setContent(`
            <div class="no-thought-content">
              <h2>👋 Welcome to Notention!</h2>
              <p>Select an item from the sidebar to view it here.</p>
              <p>New? Try creating a Note, starting a DM, or making a Group using the buttons in the top-left panel.</p>
            </div>
        `);
    }

    update(app, dataStore, activeThoughtId, thoughts, profiles, identity) {
    }
}

class NoteEditorView extends Component {
    constructor(app, dataStore) {
        super('div', { id: 'note-editor-container' });
        this.app = app;
        this.dataStore = dataStore;

        this.titleInput = new Component('input', { id: 'note-title-input', type: 'text', placeholder: 'Note Title' });
        this.bodyTextarea = new Component('textarea', { id: 'note-body-textarea', placeholder: 'Your note...' });
        this.add(this.titleInput, this.bodyTextarea);

        this.titleInput.element.addEventListener('input', (e) => this._handleNoteUpdate('title', e.target.value));
        this.bodyTextarea.element.addEventListener('input', (e) => this._handleNoteUpdate('body', e.target.value));
    }

    _handleNoteUpdate(field, value) {
        const { activeThoughtId } = this.dataStore.state;
        this.app.handleAction('update-note-content', {
            id: activeThoughtId,
            field: field,
            value: value
        });
    }

    update(thought) {
        this.show(true);
        this.titleInput.element.value = thought.name || '';
        this.bodyTextarea.element.value = thought.body || '';
    }
}

const MESSAGE_ID_MAX_SIZE = 2000;
const MESSAGE_ID_TRIM_THRESHOLD = 1500;

class MessageListView extends Component {
    constructor(app, dataStore) {
        super('div', { id: 'message-list' });
        this.app = app;
        this.dataStore = dataStore;
        this.messagesContainer = new Component('div', { id: 'message-list-container' });
        this.add(this.messagesContainer);

        this.messageRenderQueue = [];
        this.renderScheduled = false;
        this.renderedMessageIds = new Set();
        this.DISPLAY_MESSAGE_LIMIT = 50;
        this.currentThoughtId = null;

        this._handleMessagesUpdated = this._queueMessagesForRender.bind(this);
    }

    _queueMessagesForRender(updatedMessagesArray) {
        const messagesToAdd = [];
        for (const msg of updatedMessagesArray) {
            if (!this.renderedMessageIds.has(msg.id)) {
                messagesToAdd.push(msg);
                this.renderedMessageIds.add(msg.id);
            }
        }

        if (messagesToAdd.length > 0) {
            this.messageRenderQueue.push(...messagesToAdd);
            this._scheduleRender();
        }
    }

    _scheduleRender() {
        if (!this.renderScheduled) {
            this.renderScheduled = true;
            requestAnimationFrame(() => {
                this._renderMessages();
                this.renderScheduled = false;
            });
        }
    }

    _renderMessages() {
        const { identity, profiles } = this.dataStore.state;
        const activeThoughtId = this.currentThoughtId;

        const msgsToRender = [...this.messageRenderQueue];
        this.messageRenderQueue = [];

        if (msgsToRender.length === 0 && this.renderedMessageIds.size === 0 && this.messagesContainer.element.children.length === 0) {
            this.messagesContainer.setContent('');
            this.messagesContainer.add(new Component('div', {
                className: 'message system',
                innerHTML: `<div class="message-content">${activeThoughtId === 'public' ? "Listening to Nostr's global feed..." : 'No messages yet.'}</div>`
            }));
            return;
        }

        if (msgsToRender.length > 0) {
            const firstChild = this.messagesContainer.element.firstChild;
            if (firstChild && firstChild.classList && firstChild.classList.contains('message') && firstChild.classList.contains('system')) {
                this.messagesContainer.setContent('');
            }
        }

        const isScrolledToBottom = this.messagesContainer.element.scrollHeight - this.messagesContainer.element.clientHeight <= this.messagesContainer.element.scrollTop + 1;

        msgsToRender.sort((a, b) => a.created_at - b.created_at);

        const fragment = document.createDocumentFragment();

        msgsToRender.forEach(msg => {
            if (!msg?.pubkey || !msg.created_at) return;

            const isSelf = msg.pubkey === identity?.pk;
            const p = profiles?.[msg.pubkey] ?? { name: shortenPubkey(msg.pubkey) };
            const senderName = isSelf ? 'You' : p.name;
            const avatarSrc = p.picture ?? createAvatarSvg(senderName, msg.pubkey);

            const msgEl = new Component('div', {
                className: `message ${isSelf ? 'self' : ''}`,
                innerHTML: `<div class="message-avatar"><img class="avatar" src="${avatarSrc}" onerror="this.src='${createAvatarSvg(senderName, msg.pubkey)}'"></div><div class="message-content"><div class="message-header"><div class="message-sender" style="color: ${getUserColor(msg.pubkey)}">${escapeHtml(senderName)}</div><div class="message-time">${formatTime(msg.created_at)}</div></div><div class="message-text">${DOMPurify.sanitize(msg.content || '')}</div></div>`
            });
            msgEl.element.dataset.id = msg.id;
            fragment.appendChild(msgEl.element);
        });

        this.messagesContainer.element.appendChild(fragment);

        while (this.messagesContainer.element.children.length > this.DISPLAY_MESSAGE_LIMIT) {
            const oldestChild = this.messagesContainer.element.firstElementChild;
            if (oldestChild && oldestChild.dataset.id) {
                this.renderedMessageIds.delete(oldestChild.dataset.id);
            }
            oldestChild.remove();
        }

        if (this.renderedMessageIds.size > MESSAGE_ID_MAX_SIZE) {
            const tempArray = Array.from(this.renderedMessageIds);
            this.renderedMessageIds = new Set(tempArray.slice(tempArray.length - MESSAGE_ID_TRIM_THRESHOLD));
        }

        if (msgsToRender.length > 0 && isScrolledToBottom) {
            this.messagesContainer.element.scrollTop = this.messagesContainer.element.scrollHeight;
        }
    }

    update(activeThoughtId) {
        this.show(true);
        if (this.currentThoughtId !== activeThoughtId) {
            if (this.currentThoughtId) {
                this.dataStore.off(`messages:${this.currentThoughtId}:updated`, this._handleMessagesUpdated);
            }
            this.dataStore.on(`messages:${activeThoughtId}:updated`, this._handleMessagesUpdated);

            this.messagesContainer.setContent('');
            this.messageRenderQueue = [];
            this.renderedMessageIds.clear();

            const currentMessages = this.dataStore.state.messages[activeThoughtId] || [];
            const initialMessagesToRender = currentMessages.slice(-this.DISPLAY_MESSAGE_LIMIT);
            this.messageRenderQueue.push(...initialMessagesToRender);
            initialMessagesToRender.forEach(msg => this.renderedMessageIds.add(msg.id));

            this.currentThoughtId = activeThoughtId;
            this._scheduleRender();
        } else {
            if(this.messageRenderQueue.length > 0) {
                 this._scheduleRender();
            }
        }
    }

    destroy() {
        if (this.currentThoughtId) {
            this.dataStore.off(`messages:${this.currentThoughtId}:updated`, this._handleMessagesUpdated);
        }
        super.destroy();
    }
}

export class ThoughtList extends Component {
    constructor(app) {
        super('div', {id: 'thoughts-list'});
        this.app = app;
        this.unsubscribeDataStore = this.app.dataStore.on('state:updated', s => this.render(s));
        this.element.addEventListener('click', e => {
            const t = e.target.closest('.thought-item');
            if (t?.dataset.id) this.app.handleAction('select-thought', t.dataset.id);
        });
    }

    destroy() {
        if (this.unsubscribeDataStore) {
            this.unsubscribeDataStore();
            this.unsubscribeDataStore = null;
        }
        super.destroy();
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
                innerHTML: `<div class="thought-icon">${icons[t.type] ?? '❓'}</div> <div class="thought-details"> <div class="thought-name"><span>${escapeHtml(name || 'Unknown')}</span>${t.unread > 0 ? `<span class="thought-unread">${t.unread}</span>` : ''}</div> <div class="thought-meta">${escapeHtml(metas[t.type] ?? '')}</div></div>`
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
    constructor(app, { noThoughtSelectedView, noteEditorView, messageListView }) {
        super('div', {id: 'main-view'});
        this.app = app;

        this.headerName = new Component('div', {className: 'thought-header-name'});
        this.headerActions = new Component('div', {id: 'thought-header-actions'});
        this.header = new Component('div', {id: 'thought-header'}).add(this.headerName, this.headerActions);

        this.noThoughtSelectedView = noThoughtSelectedView;
        this.noteEditorView = noteEditorView;
        this.messageListView = messageListView;

        this.inputForm = new Component('form', {id: 'message-input-form', autocomplete: 'off'});
        this.input = new Component('textarea', {id: 'message-input', placeholder: 'Type your message...'});
        this.sendButton = new Button({textContent: 'Send', type: 'submit'});
        this.inputForm.add(this.input, this.sendButton);
        this.inputForm.show(false);

        const viewsToAdd = [this.header];
        if (this.noThoughtSelectedView && this.noThoughtSelectedView.element) viewsToAdd.push(this.noThoughtSelectedView);
        if (this.noteEditorView && this.noteEditorView.element) viewsToAdd.push(this.noteEditorView);
        if (this.messageListView && this.messageListView.element) viewsToAdd.push(this.messageListView);
        viewsToAdd.push(this.inputForm);
        this.add(...viewsToAdd.filter(v => v));

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

        this.unsubscribeDataStore = this.app.dataStore.on('state:updated', s => this.update(s));
    }

    destroy() {
        if (this.unsubscribeDataStore) {
            this.unsubscribeDataStore();
            this.unsubscribeDataStore = null;
        }
        this.noThoughtSelectedView.destroy();
        this.noteEditorView.destroy();
        this.messageListView.destroy();
        this.inputForm.destroy();
        this.header.destroy();

        super.destroy();
    }

    update({activeThoughtId, thoughts, profiles, identity} = {}) {
        const thought = thoughts?.[activeThoughtId];

        this.noThoughtSelectedView.show(false);
        this.noteEditorView.show(false);
        this.messageListView.show(false);
        this.inputForm.show(false);


        if (!thought) {
            this.headerName.setContent('No Thought Selected');
            this.headerActions.setContent('');
            this.noThoughtSelectedView.show(true);
            return;
        }

        this.renderHeader(thought, profiles || {});
        
        const showInput = !!identity.sk && (thought.type === 'public' || thought.type === 'dm' || thought.type === 'group');
        this.inputForm.show(showInput);

        if (thought.type === 'note') {
            this.noteEditorView.update(thought);
        } else {
            this.messageListView.update(activeThoughtId);
        }
    }

    renderHeader(thought, profiles) {
        const name = thought.type === 'dm' ? (profiles[thought.pubkey]?.name ?? thought.name) : thought.name;
        this.headerName.setContent(escapeHtml(name || 'Unknown'));
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
        } else if (thought.type !== 'public' && thought.type !== 'note') {
            this.headerActions.add(
                new Button({
                    textContent: 'Hide',
                    className: 'danger',
                    onClick: () => this.app.handleAction('leave-thought')
                })
            );
        }
    }

    sendMessage() {
        const content = this.input.element.value.trim();
        if (!content) return;
        this.app.handleAction('send-message', content);
        this.input.element.value = '';
        this.input.element.style.height = 'auto';
        this.input.element.style.height = `${this.input.element.scrollHeight}px`;
        if (this.input.element.scrollHeight < 44) this.input.element.style.height = '44px';

    }
}

export { IdentityPanel, ThoughtList, MainView, NoThoughtSelectedView, NoteEditorView, MessageListView };
