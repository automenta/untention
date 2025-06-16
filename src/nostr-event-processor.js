import {Logger} from '@/logger.js';
import {aesDecrypt} from '/utils/crypto-utils.js';
import {findTag, shortenPubkey} from '/utils/nostr-utils.js';
import {now} from '/utils/time-utils.js';
const { nip04, verifyEvent } = NostrTools;

const PROFILE_KIND = 0;
const TEXT_NOTE_KIND = 1;
const ENCRYPTED_DM_KIND = 4;
const GROUP_CHAT_KIND = 41;

export class NostrEventProcessor {
    constructor(dataStore, nostrInstance, ui) {
        this.dataStore = dataStore;
        this.nostrInstance = nostrInstance;
        this.ui = ui;
    }

    async processNostrEvent(event, subId) {
        if (!event) return;

        try {
            if (!verifyEvent(event)) {
                Logger.warnWithContext('NostrEventProcessor', 'Invalid event signature:', event);
                return;
            }
        } catch (error) {
            Logger.errorWithContext('NostrEventProcessor', 'Error verifying event signature:', error, event);
            return;
        }

        let thoughtId;
        let cleartextMessageContent = event.content;

        try {
            switch (event.kind) {
                case PROFILE_KIND:
                    await this.processKind0(event);
                    return;

                case TEXT_NOTE_KIND:
                    if (subId === 'public' || (subId && subId.startsWith('historical-public'))) {
                        thoughtId = 'public';
                    } else if (subId && subId.startsWith('thought-')) {
                        thoughtId = subId.split('-')[1];
                    } else {
                        Logger.logWithContext('NostrEventProcessor', `Text note event from subId '${subId}' not mapped to a thought, event:`, event);
                        return;
                    }
                    break;

                case ENCRYPTED_DM_KIND:
                    const otherPubkey = event.pubkey === this.dataStore.state.identity.pk ? findTag(event, 'p') : event.pubkey;
                    if (!otherPubkey) {
                        Logger.warnWithContext('NostrEventProcessor', 'DM event without a peer pubkey.', event);
                        return;
                    }
                    thoughtId = otherPubkey;

                    if (!this.dataStore.state.identity.sk) {
                        Logger.warnWithContext('NostrEventProcessor', `Cannot decrypt DM: Secret key (sk) not available. Event ID: ${event.id}`);
                        return;
                    }
                    try {
                        cleartextMessageContent = await nip04.decrypt(this.dataStore.state.identity.sk, otherPubkey, event.content);
                    } catch (err) {
                        Logger.warnWithContext('NostrEventProcessor', `Failed to decrypt DM for ${thoughtId}: ${err.message}. Event ID: ${event.id}`);
                        cleartextMessageContent = "[Could not decrypt message]";
                    }

                    if (!this.dataStore.state.thoughts[thoughtId]) {
                        this.dataStore.setState(s => {
                            if (!s.thoughts[thoughtId]) {
                                s.thoughts[thoughtId] = {
                                    id: thoughtId, name: shortenPubkey(thoughtId), type: 'dm',
                                    pubkey: thoughtId, unread: 0, lastEventTimestamp: now()
                                };
                            }
                        });
                        await this.dataStore.saveThoughts();
                        this.nostrInstance.fetchProfile(thoughtId);
                    }
                    break;

                case GROUP_CHAT_KIND:
                    const groupTag = findTag(event, 'g');
                    if (!groupTag) {
                        Logger.warnWithContext('NostrEventProcessor', 'Group chat event without a group ID.', event);
                        return;
                    }
                    thoughtId = groupTag;
                    const group = this.dataStore.state.thoughts[thoughtId];
                    if (!group || group.type !== 'group' || !group.secretKey) {
                        Logger.warnWithContext('NostrEventProcessor', `No secret key for group ${thoughtId} or thought is not a group. Cannot decrypt. Event ID: ${event.id}`);
                        return;
                    }
                    try {
                        cleartextMessageContent = await aesDecrypt(event.content, group.secretKey);
                    } catch (err) {
                        Logger.warnWithContext('NostrEventProcessor', `Failed to decrypt group message for ${thoughtId}: ${err.message}. Event ID: ${event.id}`);
                        cleartextMessageContent = "[Could not decrypt message]";
                    }
                    break;

                default:
                    Logger.logWithContext('NostrEventProcessor', `Received event of kind ${event.kind}, not processed by this handler:`, event);
                    return;
            }

            if (thoughtId && cleartextMessageContent !== undefined) {
                await this.processMessage(event, thoughtId, cleartextMessageContent);
            }

        } catch (err) {
            Logger.errorWithContext('NostrEventProcessor', 'Error processing Nostr event:', err, event);
        }
    }

    async processMessage(originalEvent, thoughtId, cleartextMessageContent) {
        if (!this.dataStore.state.thoughts[thoughtId]) {
            Logger.warnWithContext('NostrEventProcessor', `Thought ${thoughtId} not found when trying to process message:`, originalEvent);
            return;
        }

        const messageData = {
            id: originalEvent.id,
            pubkey: originalEvent.pubkey,
            created_at: originalEvent.created_at,
            content: cleartextMessageContent,
            tags: originalEvent.tags,
            sig: originalEvent.sig,
            kind: originalEvent.kind,
            thoughtId: thoughtId
        };

        this.dataStore.addMessage(thoughtId, messageData);

        const thought = this.dataStore.state.thoughts[thoughtId];
        if (thought) {
            if (thoughtId !== this.dataStore.state.activeThoughtId && originalEvent.pubkey !== this.dataStore.state.identity.pk) {
                thought.unread = (thought.unread || 0) + 1;
            }
            thought.lastEventTimestamp = Math.max(thought.lastEventTimestamp || 0, originalEvent.created_at);
        }

        if (thoughtId !== 'public') {
             await this.dataStore.saveMessages(thoughtId);
        }
        await this.dataStore.saveThoughts();

        this.dataStore.emitStateUpdated();

        if (originalEvent.pubkey && !this.dataStore.state.profiles[originalEvent.pubkey]) {
            if (!this.dataStore.state.fetchingProfiles.has(originalEvent.pubkey)) {
                 await this.nostrInstance.fetchProfile(originalEvent.pubkey);
            }
        }
    }

    async processKind0(event) {
        try {
            const profileContent = JSON.parse(event.content);
            const pubkey = event.pubkey;

            const newProfile = {
                name: profileContent.name || profileContent.display_name || shortenPubkey(pubkey),
                picture: profileContent.picture,
                nip05: profileContent.nip05,
                pubkey: pubkey,
                lastUpdatedAt: event.created_at
            };

            const existingProfile = this.dataStore.state.profiles[pubkey];
            if (!existingProfile || newProfile.lastUpdatedAt > (existingProfile.lastUpdatedAt || 0)) {
                this.dataStore.setState(s => {
                    s.profiles[pubkey] = newProfile;
                    if (pubkey === s.identity.pk) {
                        s.identity.profile = newProfile;
                    }
                    Object.values(s.thoughts).forEach(thought => {
                        if (thought.type === 'dm' && thought.pubkey === pubkey && newProfile.name) {
                            thought.name = newProfile.name;
                        }
                    });
                });
                await this.dataStore.saveProfiles();
                await this.dataStore.saveThoughts();
                this.dataStore.emitStateUpdated();
                Logger.debug('NostrEventProcessor', `Processed profile for ${shortenPubkey(pubkey)}: ${newProfile.name}`);
            }
        } catch (err) {
            Logger.warnWithContext('NostrEventProcessor', 'Error parsing profile event:', err, event.content);
        }
    }
}
