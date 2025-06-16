import {Logger} from '@/logger.js';
import localforage from 'localforage';
import {now} from '/utils/time-utils.js';

const DEFAULT_THOUGHT_ID = 'public';

export class ThoughtManagerService {
    constructor(dataStore, ui, nostr, app) {
        this.dataStore = dataStore;
        this.ui = ui;
        this.nostr = nostr;
        this.app = app;
    }

    async selectThought(id) {
        this.ui.setLoading(true);
        try {
            const currentActiveThoughtId = this.dataStore.state.activeThoughtId;
            const thoughts = this.dataStore.state.thoughts;
            const newActiveThoughtId = thoughts[id] ? id : DEFAULT_THOUGHT_ID;

            const thoughtToUpdate = thoughts[newActiveThoughtId];
            let unreadActuallyChanged = false;

            if (thoughtToUpdate && thoughtToUpdate.unread > 0) {
                unreadActuallyChanged = true;
            }

            this.dataStore.setState(s => {
                s.activeThoughtId = newActiveThoughtId;
                if (s.thoughts[newActiveThoughtId]) {
                    s.thoughts[newActiveThoughtId].unread = 0;
                }
            });

            if (currentActiveThoughtId !== newActiveThoughtId) {
                await this.dataStore.saveActiveThoughtId();
            }
            if (unreadActuallyChanged) {
                await this.dataStore.saveThoughts();
            }

            if (currentActiveThoughtId !== newActiveThoughtId) {
                await this.dataStore.loadMessages(newActiveThoughtId);
                if (this.nostr && this.dataStore.state.thoughts[newActiveThoughtId]) {
                    await this.nostr.fetchHistoricalMessages(this.dataStore.state.thoughts[newActiveThoughtId]);
                }
            }
        } catch (e) {
            Logger.error(`Error selecting thought ${id}:`, e);
            this.ui.showToast(`Failed to load thought: ${e.message || 'An unexpected error occurred while selecting the thought.'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }

    async leaveThought() {
        const {activeThoughtId, thoughts} = this.dataStore.state;
        const thoughtToLeave = thoughts[activeThoughtId];
        if (!thoughtToLeave || !confirm(`Are you sure you want to remove ${thoughtToLeave.type} "${thoughtToLeave.name}"? This will only hide it from your list, not delete it from Nostr.`)) return;

        this.ui.setLoading(true);
        try {
            this.dataStore.setState(s => {
                delete s.thoughts[activeThoughtId];
                delete s.messages[activeThoughtId];
            });

            await Promise.all([
                localforage.removeItem(`messages_${activeThoughtId}`),
                this.dataStore.saveThoughts()
            ]);

            await this.selectThought(DEFAULT_THOUGHT_ID);
            this.ui.showToast('Thought removed.', 'info');
            if (this.dataStore.state.activeThoughtId === DEFAULT_THOUGHT_ID) {
                 this.ui.showToast(`Switched to ${DEFAULT_THOUGHT_ID} chat.`, 'info');
            }
        } catch (e) {
            Logger.error(`Error leaving thought ${activeThoughtId}:`, e);
            this.ui.showToast(`Failed to remove thought: ${e.message || 'An unexpected error occurred while removing the thought.'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }

    async updateNoteContent(id, field, value) {
        this.ui.setLoading(true);
        try {
            const thought = this.dataStore.state.thoughts[id];
            if (!thought || thought.type !== 'note') {
                throw new Error('Cannot update a non-note thought or invalid thought ID.');
            }

            this.dataStore.setState(s => {
                const targetThought = s.thoughts[id];
                if (field === 'title') {
                    targetThought.name = value;
                } else if (field === 'body') {
                    targetThought.body = value;
                }
                targetThought.lastEventTimestamp = now();
            });
            await this.dataStore.saveThoughts();
            this.ui.showToast('Note updated.', 'success');
        } catch (e) {
            Logger.errorWithContext('ThoughtManagerService', 'Error updating note content:', e);
            this.ui.showToast(`Failed to update note: ${e.message || 'An unexpected error occurred.'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }
}
