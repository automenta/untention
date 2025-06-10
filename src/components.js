import DOMPurify from 'dompurify';
import { Component, Button } from './ui.js';
import { Logger } from './logger.js'; // Assuming Logger might be used, good practice to include
// No direct use of EventEmitter in this file's classes, but keeping for potential (though unlikely) module-level use.
import { EventEmitter } from './event-emitter.js';
import { escapeHtml, createAvatarSvg, getUserColor } from './utils/ui-utils.js';
import { formatTime, now } from './utils/time-utils.js';
import { shortenPubkey } from './utils/nostr-utils.js'; // findTag not used here

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
        // Destroy buttons if they have their own event listeners or internal state that needs cleanup
        // For now, assuming Component.destroy() handles their elements.
        // Object.values(this.actionButtons).forEach(button => {
        //     if (button instanceof Component && typeof button.destroy === 'function') {
        //         button.destroy();
        //     }
        // });
        super.destroy(); // Call base class destroy if it exists and handles element removal
    }

    update(identity) {
        const {pk, profile} = identity || {};
        const isLoggedIn = !!pk;
        const displayName = isLoggedIn ? (profile?.name || shortenPubkey(pk)) : 'Anonymous'; // Changed
        const pubkeyText = isLoggedIn ? nip19.npubEncode(pk) : 'No identity loaded';
        const avatarSrc = isLoggedIn ? (profile?.picture || createAvatarSvg(displayName, pk)) : createAvatarSvg('?', '#ccc'); // Changed
        this.avatar.element.src = avatarSrc;
        this.avatar.element.onerror = () => this.avatar.element.src = createAvatarSvg(displayName, pk); // Changed
        this.userName.setContent(escapeHtml(displayName)); // Changed
        this.userPubkey.setContent(escapeHtml(pubkeyText)); // Changed
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
        super('div', { id: 'no-thought-selected-view', className: 'no-thought-content-wrapper' }); // Added a wrapper class for potential full-height styling
        this.setContent(`
            <div class="no-thought-content">
              <h2>👋 Welcome to Notention!</h2>
              <p>Select an item from the sidebar to view it here.</p>
              <p>New? Try creating a Note, starting a DM, or making a Group using the buttons in the top-left panel.</p>
            </div>
        `);
    }

    update(app, dataStore, activeThoughtId, thoughts, profiles, identity) {
        // This view is static for now, but might need updates later
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
        const { activeThoughtId, thoughts } = this.dataStore.state;
        const thought = thoughts[activeThoughtId];

        // Ensure we're updating an existing note.
        if (thought && thought.type === 'note') {
            if (field === 'title') {
                thought.name = value;
            } else if (field === 'body') {
                thought.body = value;
            }
            // Update timestamp to reflect change and save.
            // This directly modifies and saves data, differing from action-based updates elsewhere.
            thought.lastEventTimestamp = now(); // Changed
            this.dataStore.saveThoughts();
            this.dataStore.emitStateUpdated(); // Notify other components like ThoughtList
        }
    }

    update(thought) {
        this.show(true);
        this.titleInput.element.value = thought.name || '';
        this.bodyTextarea.element.value = thought.body || '';
    }
}

class MessageListView extends Component {
    constructor(app, dataStore) {
        super('div', { id: 'message-list-view' }); // Changed ID to avoid conflict if old one is still there
        this.app = app;
        this.dataStore = dataStore;
        this.messagesContainer = new Component('div', { id: 'message-list-container' }); // Inner container for messages
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
        const activeThoughtId = this.currentThoughtId; // Use the stored thought ID

        const msgsToRender = [...this.messageRenderQueue];
        this.messageRenderQueue = []; // Clear queue after copying

        // Handle initial state or empty message list
        if (msgsToRender.length === 0 && this.renderedMessageIds.size === 0 && this.messagesContainer.element.children.length === 0) {
            this.messagesContainer.setContent(''); // Clear previous, if any
            this.messagesContainer.add(new Component('div', {
                className: 'message system', // System message style
                innerHTML: `<div class="message-content">${activeThoughtId === 'public' ? "Listening to Nostr's global feed..." : 'No messages yet.'}</div>`
            }));
            return;
        }

        // If a placeholder "No messages yet" exists and we now have messages, clear it.
        if (msgsToRender.length > 0) {
            const firstChild = this.messagesContainer.element.firstChild;
            if (firstChild && firstChild.classList && firstChild.classList.contains('message') && firstChild.classList.contains('system')) {
                this.messagesContainer.setContent(''); // Clear placeholder
            }
        }

        // Determine if view is scrolled to bottom before adding new messages
        const isScrolledToBottom = this.messagesContainer.element.scrollHeight - this.messagesContainer.element.clientHeight <= this.messagesContainer.element.scrollTop + 1;

        msgsToRender.sort((a, b) => a.created_at - b.created_at); // Ensure chronological order

        const fragment = document.createDocumentFragment(); // Use a fragment for efficient batch DOM insertion

        msgsToRender.forEach(msg => {
            if (!msg?.pubkey || !msg.created_at) return; // Skip invalid messages

            const isSelf = msg.pubkey === identity?.pk;
            const p = profiles?.[msg.pubkey] ?? { name: shortenPubkey(msg.pubkey) };
            const senderName = isSelf ? 'You' : p.name;
            const avatarSrc = p.picture ?? createAvatarSvg(senderName, msg.pubkey);

            // Create message element
            const msgEl = new Component('div', {
                className: `message ${isSelf ? 'self' : ''}`,
                innerHTML: `<div class="message-avatar"><img class="avatar" src="${avatarSrc}" onerror="this.src='${createAvatarSvg(senderName, msg.pubkey)}'"></div><div class="message-content"><div class="message-header"><div class="message-sender" style="color: ${getUserColor(msg.pubkey)}">${escapeHtml(senderName)}</div><div class="message-time">${formatTime(msg.created_at)}</div></div><div class="message-text">${DOMPurify.sanitize(msg.content || '')}</div></div>`
            });
            msgEl.element.dataset.id = msg.id; // Store ID for potential future reference/updates
            fragment.appendChild(msgEl.element);
        });

        this.messagesContainer.element.appendChild(fragment); // Append all new messages at once

        // Maintain message limit by removing oldest messages
        while (this.messagesContainer.element.children.length > this.DISPLAY_MESSAGE_LIMIT) {
            const oldestChild = this.messagesContainer.element.firstElementChild;
            if (oldestChild && oldestChild.dataset.id) {
                this.renderedMessageIds.delete(oldestChild.dataset.id); // Update tracking set
            }
            oldestChild.remove();
        }

        // Auto-scroll to bottom if it was already there
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

            this.messagesContainer.setContent(''); // Clear previous messages
            this.messageRenderQueue = [];
            this.renderedMessageIds.clear();

            const currentMessages = this.dataStore.state.messages[activeThoughtId] || [];
            const initialMessagesToRender = currentMessages.slice(-this.DISPLAY_MESSAGE_LIMIT);
            this.messageRenderQueue.push(...initialMessagesToRender);
            initialMessagesToRender.forEach(msg => this.renderedMessageIds.add(msg.id));

            this.currentThoughtId = activeThoughtId;
            this._scheduleRender(); // Initial render for the new thought
        } else {
            // If it's the same thought, new messages might have been queued by dataStore event
            // ensure render is scheduled if needed
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
        // The event listener on this.element will be removed when super.destroy() removes the element.
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
                innerHTML: `<div class="thought-icon">${icons[t.type] ?? '❓'}</div> <div class="thought-details"> <div class="thought-name"><span>${escapeHtml(name || 'Unknown')}</span>${t.unread > 0 ? `<span class="thought-unread">${t.unread}</span>` : ''}</div> <div class="thought-meta">${escapeHtml(metas[t.type] ?? '')}</div></div>` // Changed
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

        // Assign injected sub-components
        this.noThoughtSelectedView = noThoughtSelectedView;
        this.noteEditorView = noteEditorView;
        this.messageListView = messageListView;

        // Initially hide all sub-views
        if (this.noThoughtSelectedView) this.noThoughtSelectedView.show(false);
        this.noteEditorView.show(false);
        this.messageListView.show(false);

        this.inputForm = new Component('form', {id: 'message-input-form', autocomplete: 'off'});
        this.input = new Component('textarea', {id: 'message-input', placeholder: 'Type your message...'});
        this.sendButton = new Button({textContent: 'Send', type: 'submit'});
        this.inputForm.add(this.input, this.sendButton);
        if (this.inputForm) this.inputForm.show(false); // Initially hidden

        // Add elements of injected views if they exist
        const viewsToAdd = [this.header];
        if (this.noThoughtSelectedView && this.noThoughtSelectedView.element) viewsToAdd.push(this.noThoughtSelectedView);
        if (this.noteEditorView && this.noteEditorView.element) viewsToAdd.push(this.noteEditorView);
        if (this.messageListView && this.messageListView.element) viewsToAdd.push(this.messageListView);
        viewsToAdd.push(this.inputForm);
        this.add(...viewsToAdd.filter(v => v)); // Filter out any undefined views before adding

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
        // Destroy managed sub-components
        this.noThoughtSelectedView.destroy();
        this.noteEditorView.destroy();
        this.messageListView.destroy(); // This one already has a good destroy method
        this.inputForm.destroy(); // If Component base class has destroy
        this.header.destroy(); // If Component base class has destroy

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
            // Call update on NoThoughtSelectedView if it needs to react to data changes
            // this.noThoughtSelectedView.update(this.app, this.app.dataStore, activeThoughtId, thoughts, profiles, identity);
            return;
        }

        this.renderHeader(thought, profiles || {});
        this.inputForm.show(!!identity.sk && thought.type !== 'note' && thought.type !== 'public'); // Show input form for DMs and groups if logged in

        if (thought.type === 'note') {
            this.noteEditorView.update(thought);
        } else {
            // For 'public', 'dm', 'group'
            this.messageListView.update(activeThoughtId);
            if (thought.type === 'public' && !identity.sk) {
                 this.inputForm.show(false); // Hide input form for public view if not logged in
            } else if (thought.type === 'public' && identity.sk) {
                this.inputForm.show(true); // Show for public if logged in.
            }
        }
    }

    renderHeader(thought, profiles) {
        const name = thought.type === 'dm' ? (profiles[thought.pubkey]?.name ?? thought.name) : thought.name;
        this.headerName.setContent(escapeHtml(name || 'Unknown')); // Changed
        this.headerActions.setContent(''); // Clear previous actions

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
        } else if (thought.type !== 'public' && thought.type !== 'note') { // DM
            this.headerActions.add(
                new Button({
                    textContent: 'Hide',
                    className: 'danger',
                    onClick: () => this.app.handleAction('leave-thought')
                })
            );
        }
        // No specific header actions for 'note' or 'public' in this iteration
    }

    sendMessage() {
        const content = this.input.element.value.trim();
        if (!content) return;
        this.app.handleAction('send-message', content); // This can stay here, as it's an app-level action
        this.input.element.value = '';
        // Consider resetting textarea height if it dynamically adjusts
        this.input.element.style.height = 'auto'; // Reset height
        this.input.element.style.height = `${this.input.element.scrollHeight}px`; // Adjust to content or back to default
        if (this.input.element.scrollHeight < 44) this.input.element.style.height = '44px';

    }

    // Old methods like _handleNoThoughtSelected, _switchToNoteView, _switchToMessageView,
    // queueMessagesForRender, scheduleRender, renderMessages, handleNoteUpdate
    // are now removed or moved into the respective sub-components.
}

export { IdentityPanel, ThoughtList, MainView, NoThoughtSelectedView, NoteEditorView, MessageListView };
