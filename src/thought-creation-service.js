import {Logger} from '@/logger.js';
import {shortenPubkey} from '@/utils/nostr-utils.js';
import {now} from '@/utils/time-utils.js';
import {exportKeyAsBase64} from '@/utils/crypto-utils.js';
const { nip19 } = NostrTools;

export class ThoughtCreationService {
    constructor(dataStore, ui, nostr, app) {
        this.dataStore = dataStore;
        this.ui = ui;
        this.nostr = nostr;
        this.app = app;
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
                    name: shortenPubkey(pk),
                    type: 'dm',
                    pubkey: pk,
                    unread: 0,
                    lastEventTimestamp: now()
                });
                await this.dataStore.saveThoughts();
                await this.nostr.fetchProfile(pk);
            }
            this.app.thoughtManagerService.selectThought(pk);
            this.ui.showToast(`DM started.`, 'success');
        } catch (e) {
            Logger.error('Error creating DM thought:', e);
            this.ui.showToast(`Error creating DM: ${e.message || 'An unexpected error occurred while creating the DM.'}`, 'error');
        }
    }

    async createGroupThought(name) {
        this.ui.hideModal();
        try {
            if (!this.dataStore.state.identity.sk) throw new Error('Login to create groups.');
            if (!name || name.trim() === '') throw new Error('Group name is required.');

            this.ui.setLoading(true);
            const id = crypto.randomUUID();
            const key = await exportKeyAsBase64(await crypto.subtle.generateKey({
                name: "AES-GCM",
                length: 256
            }, true, ["encrypt", "decrypt"]));

            this.dataStore.setState(s => s.thoughts[id] = {
                id,
                name,
                type: 'group',
                secretKey: key,
                unread: 0,
                lastEventTimestamp: now()
            });
            await this.dataStore.saveThoughts();
            this.app.thoughtManagerService.selectThought(id);
            this.ui.showToast(`Group "${name}" created.`, 'success');
            this.app.modalService.show('groupInfo');
        } catch (e) {
            Logger.error('Error creating group thought:', e);
            this.ui.showToast(`Failed to create group: ${e.message || 'An unexpected error occurred while creating the group.'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }

    async joinGroupThought(id, key, name) {
        this.ui.hideModal();
        try {
            if (!this.dataStore.state.identity.sk) throw new Error('Login to join groups.');
            if (this.dataStore.state.thoughts[id]) throw new Error(`Already in group "${this.dataStore.state.thoughts[id].name}".`);
            if (!id || !key || !name) throw new Error('Group ID, key, and name are required.');

            this.ui.setLoading(true);
            atob(key);

            this.dataStore.setState(s => s.thoughts[id] = {
                id,
                name,
                type: 'group',
                secretKey: key,
                unread: 0,
                lastEventTimestamp: now()
            });
            await this.dataStore.saveThoughts();
            this.app.thoughtManagerService.selectThought(id);
            this.ui.showToast(`Joined group "${name}".`, 'success');
        } catch (e) {
            Logger.error('Error joining group thought:', e);
            this.ui.showToast(`Failed to join group: ${e.message || 'An unexpected error occurred while joining the group.'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }

    async createNoteThought() {
        try {
            if (!this.dataStore.state.identity.sk) throw new Error('Login to create notes.');
            this.ui.setLoading(true);
            const newId = crypto.randomUUID();
            let noteName = 'New Note';
            const existingNames = new Set(Object.values(this.dataStore.state.thoughts)
                                            .filter(t => t.type === 'note')
                                            .map(t => t.name));
            if (existingNames.has(noteName)) {
                let i = 1;
                while (existingNames.has(`New Note ${i}`)) {
                    i++;
                }
                noteName = `New Note ${i}`;
            }

            const newNote = {
                id: newId,
                name: noteName,
                type: 'note',
                body: '',
                lastEventTimestamp: now(),
                unread: 0
            };
            this.dataStore.setState(s => {
                s.thoughts[newId] = newNote;
            });
            await this.dataStore.saveThoughts();
            this.app.thoughtManagerService.selectThought(newId);
            this.ui.showToast('Note created.', 'success');
        } catch (e) {
            Logger.error('Error creating note thought:', e);
            this.ui.showToast(`Failed to create note: ${e.message || 'An unexpected error occurred while creating the note.'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }
}
