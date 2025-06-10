import { describe, it, expect, vi, beforeEach, afterEach, vitest } from 'vitest';
import DOMPurify from 'dompurify';
import { MessageListView } from '../../src/components.js';
import * as UiUtils from '../../src/utils/ui-utils.js';
import * as TimeUtils from '../../src/utils/time-utils.js';

// Mock requestAnimationFrame
global.requestAnimationFrame = vi.fn((cb) => { cb(); return 1; }); // Execute callback immediately
global.cancelAnimationFrame = vi.fn();

describe('MessageListView', () => {
    let mockApp;
    let mockDataStore;
    let view;
    let activeThoughtId;

    beforeEach(() => {
        activeThoughtId = 'dm1';
        mockDataStore = {
            state: {
                messages: {
                    [activeThoughtId]: [],
                },
                identity: { pk: 'user1' },
                profiles: {
                    'user1': { name: 'User One', picture: 'user1.jpg' },
                    'user2': { name: 'User Two', picture: 'user2.jpg' },
                },
            },
            on: vi.fn(),
            off: vi.fn(),
            // We don't mock emitStateUpdated or saveThoughts as MessageListView doesn't call them directly
        };
        mockApp = { dataStore: mockDataStore };

        // Spy on Utils.createAvatarSvg to check calls if needed
        vi.spyOn(UiUtils, 'createAvatarSvg').mockReturnValue('fake-avatar.svg');
        vi.spyOn(TimeUtils, 'formatTime').mockReturnValue('12:00 PM');


        view = new MessageListView(mockApp, mockDataStore);
        document.body.appendChild(view.element);
    });

    afterEach(() => {
        if (view && view.element.parentNode) {
            document.body.removeChild(view.element);
        }
        vi.restoreAllMocks(); // Restores original implementations of spied functions
        global.requestAnimationFrame.mockClear();
        global.cancelAnimationFrame.mockClear();
    });

    it('should render a placeholder message if no messages exist for the thought', () => {
        view.update(activeThoughtId);

        const systemMessage = view.messagesContainer.element.querySelector('.message.system .message-content');
        expect(systemMessage).not.toBeNull();
        expect(systemMessage.textContent).toBe('No messages yet.');
    });

    it('should render messages when update is called with a thoughtId that has messages', () => {
        const messages = [
            { id: 'msg1', content: 'Hello', pubkey: 'user2', created_at: 1678886400 },
            { id: 'msg2', content: 'Hi there!', pubkey: 'user1', created_at: 1678886460 },
        ];
        mockDataStore.state.messages[activeThoughtId] = messages;

        view.update(activeThoughtId);

        const messageElements = view.messagesContainer.element.querySelectorAll('.message:not(.system)');
        expect(messageElements.length).toBe(2);

        // Check first message (from user2)
        expect(messageElements[0].querySelector('.message-sender').textContent).toBe('User Two');
        expect(messageElements[0].querySelector('.message-text').innerHTML).toBe('Hello'); // Changed to innerHTML
        expect(messageElements[0].classList.contains('self')).toBe(false);

        // Check second message (from user1 - self)
        expect(messageElements[1].querySelector('.message-sender').textContent).toBe('You'); // 'You' for self
        expect(messageElements[1].querySelector('.message-text').innerHTML).toBe('Hi there!'); // Changed to innerHTML
        expect(messageElements[1].classList.contains('self')).toBe(true);
    });

    it('should subscribe to messages:updated event for the active thought and unsubscribe for the previous', () => {
        const firstThoughtId = 'dm1';
        const secondThoughtId = 'dm2';
        mockDataStore.state.messages[secondThoughtId] = [];


        view.update(firstThoughtId);
        expect(mockDataStore.on).toHaveBeenCalledWith(`messages:${firstThoughtId}:updated`, view._handleMessagesUpdated);

        view.update(secondThoughtId);
        expect(mockDataStore.off).toHaveBeenCalledWith(`messages:${firstThoughtId}:updated`, view._handleMessagesUpdated);
        expect(mockDataStore.on).toHaveBeenCalledWith(`messages:${secondThoughtId}:updated`, view._handleMessagesUpdated);
    });

    it('should queue and render new messages received via _queueMessagesForRender', () => {
        view.update(activeThoughtId); // Initial update, no messages

        const newMessages = [
            { id: 'msg3', content: 'New message', pubkey: 'user2', created_at: 1678886500 }
        ];
        view._queueMessagesForRender(newMessages); // Simulate event handler being called

        // requestAnimationFrame mock will execute the render immediately in this setup
        const messageElements = view.messagesContainer.element.querySelectorAll('.message:not(.system)');
        expect(messageElements.length).toBe(1);
        expect(messageElements[0].querySelector('.message-text').innerHTML).toBe('New message'); // Changed to innerHTML
    });

    it('should respect DISPLAY_MESSAGE_LIMIT', () => {
        const initialMessages = [];
        for (let i = 0; i < view.DISPLAY_MESSAGE_LIMIT + 10; i++) {
            initialMessages.push({ id: `msg${i}`, content: `Message ${i}`, pubkey: 'user2', created_at: 1678886400 + i });
        }
        mockDataStore.state.messages[activeThoughtId] = initialMessages;

        view.update(activeThoughtId);

        const messageElements = view.messagesContainer.element.querySelectorAll('.message:not(.system)');
        expect(messageElements.length).toBe(view.DISPLAY_MESSAGE_LIMIT);
        // Check that the oldest messages were removed (e.g., msg0 to msg9 should be gone)
        expect(view.messagesContainer.element.querySelector('[data-id="msg0"]')).toBeNull();
        expect(view.messagesContainer.element.querySelector(`[data-id="msg${view.DISPLAY_MESSAGE_LIMIT + 9}"]`)).not.toBeNull(); // Last message should be present
    });

    it('should clear renderedMessageIds and messageRenderQueue when switching thoughts', () => {
        const messages1 = [{ id: 'm1', content: 'Hi', pubkey: 'user1', created_at: 123 }];
        mockDataStore.state.messages['thought1'] = messages1;
        view.update('thought1');
        expect(view.renderedMessageIds.has('m1')).toBe(true);

        mockDataStore.state.messages['thought2'] = []; // New thought has no messages initially
        view.update('thought2');

        expect(view.renderedMessageIds.size).toBe(0);
        expect(view.messageRenderQueue.length).toBe(0);
    });

    it('should render "Listening to Nostr\'s global feed..." for public thought if no messages', () => {
        activeThoughtId = 'public';
        mockDataStore.state.messages[activeThoughtId] = [];
        view.update(activeThoughtId);

        const systemMessage = view.messagesContainer.element.querySelector('.message.system .message-content');
        expect(systemMessage).not.toBeNull();
        expect(systemMessage.textContent).toBe("Listening to Nostr's global feed...");
    });

    it('destroy method should unsubscribe from dataStore events', () => {
        view.update(activeThoughtId); // Subscribes
        view.destroy();
        expect(mockDataStore.off).toHaveBeenCalledWith(`messages:${activeThoughtId}:updated`, view._handleMessagesUpdated);
    });

    it('should correctly render HTML content from a message', () => {
        const messages = [
            { id: 'msg-html', content: '<p>Hello <strong>World</strong></p>', pubkey: 'user2', created_at: 1678886400 },
        ];
        mockDataStore.state.messages[activeThoughtId] = messages;
        view.update(activeThoughtId);
        const messageElement = view.messagesContainer.element.querySelector('[data-id="msg-html"] .message-text');
        expect(messageElement.innerHTML).toBe('<p>Hello <strong>World</strong></p>');
    });

    it('should sanitize potentially malicious HTML content', () => {
        const messages = [
            { id: 'msg-xss', content: '<p>Safe <script>alert("XSS")</script> unsafe</p><img src="x" onerror="alert(\'XSS\')">', pubkey: 'user2', created_at: 1678886400 },
        ];
        mockDataStore.state.messages[activeThoughtId] = messages;
        // Spy on DOMPurify.sanitize to ensure it's called
        const sanitizeSpy = vi.spyOn(DOMPurify, 'sanitize');
        view.update(activeThoughtId);
        const messageElement = view.messagesContainer.element.querySelector('[data-id="msg-xss"] .message-text');
        expect(sanitizeSpy).toHaveBeenCalledWith(messages[0].content);
        // Check that script tag is removed and onerror is neutralized (DOMPurify typically removes script tags and sanitizes event handlers)
        expect(messageElement.innerHTML).toBe('<p>Safe  unsafe</p><img src="x">'); // Exact output depends on DOMPurify's default config
        sanitizeSpy.mockRestore();
    });
});
