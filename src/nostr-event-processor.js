import { Logger } from './logger.js';
import { aesDecrypt } from './utils/crypto-utils.js';
import { findTag, shortenPubkey } from './utils/nostr-utils.js';
import { now } from './utils/time-utils.js';
// NostrTools is expected to be available globally
const { nip04, verifyEvent } = NostrTools;

// Define Nostr event kinds and other constants
const PROFILE_KIND = 0;
const TEXT_NOTE_KIND = 1;
const ENCRYPTED_DM_KIND = 4;
const GROUP_CHAT_KIND = 41;
// MESSAGE_LIMIT is used in DataStore.addMessage, not directly here for now.

export class NostrEventProcessor {
    constructor(dataStore, nostrInstance, ui) {
        this.dataStore = dataStore;
        this.nostrInstance = nostrInstance; // Instance of the Nostr class
        this.ui = ui; // UIController, if direct UI interaction is needed (preferably not)
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
        let cleartextMessageContent = event.content; // Default for non-encrypted

        try {
            switch (event.kind) {
                case PROFILE_KIND:
                    await this.processKind0(event);
                    return; // Kind 0 processing is self-contained

                case TEXT_NOTE_KIND:
                    // Determine thoughtId for public text notes
                    if (subId === 'public' || (subId && subId.startsWith('historical-public'))) {
                        thoughtId = 'public';
                    } else if (subId && subId.startsWith('thought-')) { // e.g. historical fetch for a specific user feed if we treat those as thoughts
                        thoughtId = subId.split('-')[1];
                    } else {
                        // Default to public or ignore if subId doesn't provide context
                        // The original Nostr.js logic for TEXT_NOTE_KIND implies it mainly cares about 'public' context from subId.
                        // Other text notes might be ignored unless explicitly subscribed for a specific thought.
                        // For now, if not clearly 'public' from subId, we might ignore or assign to a generic place.
                        // Let's stick to 'public' if subId implies it.
                        Logger.logWithContext('NostrEventProcessor', `Text note event from subId '${subId}' not mapped to a thought, event:`, event);
                        return; // Or assign to a default/current thought if applicable
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
                        cleartextMessageContent = "[Could not decrypt message]"; // Show error in UI
                        // return; // Optionally, don't process if decryption fails
                    }

                    // If this DM is from a new contact, create a thought for them
                    if (!this.dataStore.state.thoughts[thoughtId]) {
                        this.dataStore.setState(s => {
                            if (!s.thoughts[thoughtId]) { // Check again in case of async race
                                s.thoughts[thoughtId] = {
                                    id: thoughtId, name: shortenPubkey(thoughtId), type: 'dm',
                                    pubkey: thoughtId, unread: 0, lastEventTimestamp: now()
                                };
                            }
                        });
                        await this.dataStore.saveThoughts();
                        this.nostrInstance.fetchProfile(thoughtId); // Fetch profile for new DM contact
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
                        // return; // Optionally, don't process if decryption fails
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
        // Ensure the thought exists (it should, especially for DMs due to logic in processNostrEvent)
        if (!this.dataStore.state.thoughts[thoughtId]) {
            Logger.warnWithContext('NostrEventProcessor', `Thought ${thoughtId} not found when trying to process message:`, originalEvent);
            return;
        }

        const messageData = {
            id: originalEvent.id,
            pubkey: originalEvent.pubkey,
            created_at: originalEvent.created_at,
            content: cleartextMessageContent, // Already decrypted content
            tags: originalEvent.tags,
            sig: originalEvent.sig,
            kind: originalEvent.kind,
            thoughtId: thoughtId
        };

        // This now calls the method in DataStore which handles message limits and sorting
        this.dataStore.addMessage(thoughtId, messageData);

        // Update unread count and last message timestamp
        const thought = this.dataStore.state.thoughts[thoughtId];
        if (thought) { // Should always be true due to check above
            if (thoughtId !== this.dataStore.state.activeThoughtId && originalEvent.pubkey !== this.dataStore.state.identity.pk) {
                thought.unread = (thought.unread || 0) + 1;
            }
            thought.lastEventTimestamp = Math.max(thought.lastEventTimestamp || 0, originalEvent.created_at);
            // No direct saveThoughts here, rely on DataStore's batching or specific save calls if needed after state change
        }

        // Save messages (DataStore.addMessage might batch this, or we ensure it's saved)
        // The original `Nostr.processMessage` called `this.dataStore.saveMessages(thoughtId)` if not public.
        if (thoughtId !== 'public') { // Assuming 'public' is the ID for public chat
             await this.dataStore.saveMessages(thoughtId); // Ensure messages are saved
        }
        await this.dataStore.saveThoughts(); // Save updated unread counts and timestamps

        // Emit events for UI update
        // DataStore.addMessage should ideally emit `messages:${thoughtId}:updated`
        // and also `state:updated` or a more specific thought-updated event.
        // Forcing state update to ensure UI reacts to unread/timestamp changes.
        this.dataStore.emitStateUpdated();


        // Fetch profile if it's not already known for the message sender
        if (originalEvent.pubkey && !this.dataStore.state.profiles[originalEvent.pubkey]) {
            // Check if already fetching to avoid redundant calls
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
                pubkey: pubkey, // Ensure pubkey is part of the profile object
                lastUpdatedAt: event.created_at // Use event creation time as update time
            };

            const existingProfile = this.dataStore.state.profiles[pubkey];
            if (!existingProfile || newProfile.lastUpdatedAt > (existingProfile.lastUpdatedAt || 0)) {
                this.dataStore.setState(s => {
                    s.profiles[pubkey] = newProfile;
                    // Update user's own identity profile if this event is for them
                    if (pubkey === s.identity.pk) {
                        s.identity.profile = newProfile;
                    }
                    // Update thought names for DMs
                    Object.values(s.thoughts).forEach(thought => {
                        if (thought.type === 'dm' && thought.pubkey === pubkey && newProfile.name) {
                            thought.name = newProfile.name;
                        }
                    });
                });
                await this.dataStore.saveProfiles();
                await this.dataStore.saveThoughts(); // If thought names were updated
                this.dataStore.emitStateUpdated(); // To reflect potential changes in UI
                Logger.debug('NostrEventProcessor', `Processed profile for ${shortenPubkey(pubkey)}: ${newProfile.name}`);
            }
        } catch (err) {
            Logger.warnWithContext('NostrEventProcessor', 'Error parsing profile event:', err, event.content);
        }
    }
}
