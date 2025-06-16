import {Logger} from '/logger.js';
import localforage from 'localforage';

const DEFAULT_THOUGHT_ID = 'public'; // Define locally for now

export class ThoughtManagerService {
    constructor(dataStore, ui, nostr, app) {
        this.dataStore = dataStore;
        this.ui = ui;
        this.nostr = nostr;
        this.app = app; // For potential direct app method calls if needed
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
                // Ensure nostr service is available and thought exists before fetching
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
        if (!thoughtToLeave || !confirm(`Leave/hide ${thoughtToLeave.type} "${thoughtToLeave.name}"?`)) return;

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

            await this.selectThought(DEFAULT_THOUGHT_ID); // Call within the service
            this.ui.showToast('Thought removed.', 'info');
            // The original App.leaveThought also showed a toast "Switched to public chat"
            // This is implicitly handled by selectThought if it updates UI or if MainView shows current thought name.
            // We can add it explicitly if needed, but selectThought should handle the transition.
            // For consistency, let's add it if the new thought is indeed public.
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
}
