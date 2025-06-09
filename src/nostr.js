const {generateSecretKey, getPublicKey, finalizeEvent, verifyEvent, nip19, nip04, SimplePool} = NostrTools;

import { EventEmitter } from './event-emitter.js';
import { Logger } from './logger.js';
import { now } from './utils/time-utils.js';
import { findTag, shortenPubkey } from './utils/nostr-utils.js';
import { aesDecrypt } from './utils/crypto-utils.js';

// Nostr Event Kinds
const PROFILE_KIND = 0;
const TEXT_NOTE_KIND = 1;
const ENCRYPTED_DM_KIND = 4;
const GROUP_CHAT_KIND = 41; // Custom kind for encrypted group chat

// Time Constants
const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;

// Cache behavior constants
const SEEN_EVENT_IDS_MAX_SIZE = 2000;
const SEEN_EVENT_IDS_TRIM_THRESHOLD = 1500; // Number of items to keep after trim

const MESSAGE_LIMIT = 100; // Max messages to fetch/store per thought (already a constant, good)


export class Nostr extends EventEmitter {
    constructor(dataStore, uiController) {
        super();
        this.dataStore = dataStore;
        this.ui = uiController;
        this.pool = new SimplePool();
        this.subs = new Map();
        this.seenEventIds = new Set();
        this.connectionStatus = 'disconnected';
    }

    connect() {
        this.disconnect();
        const relays = this.dataStore.state.relays;
        if (relays.length === 0) {
            this.updateConnectionStatus('disconnected');
            const msg = 'No relays configured. Please add relays.';
            if (this.ui) {
                this.ui.showToast(msg, 'warn');
            } else {
                Logger.info(`UI not available: ${msg}`);
            }
            return;
        }

        this.pool = new SimplePool();
        this.updateConnectionStatus('connecting');
        this.subscribeToCoreEvents();
        this.updateConnectionStatus('connected');
        const successMsg = `Subscriptions sent to ${relays.length} relays.`;
        if (this.ui) {
            this.ui.showToast(successMsg, 'success');
        } else {
            Logger.info(`UI not available: ${successMsg}`);
        }
    }

    disconnect() {
        this.subs.forEach(sub => {
            if (sub && typeof sub.unsub === 'function') {
                sub.unsub();
            } else {
                Logger.warn('Attempted to unsub an invalid subscription object:', sub);
            }
        });
        this.subs.clear();

        if (this.pool) {
            this.pool.close(this.dataStore.state.relays);
        }
        this.updateConnectionStatus('disconnected');
    }

    updateConnectionStatus(status) {
        if (this.connectionStatus === status) return;
        this.connectionStatus = status;
        this.emit('connection:status', {
            status,
            count: this.dataStore.state.relays.length
        });
    }

    subscribe(id, filters) {
        this.subs.get(id)?.unsub();

        const currentRelays = this.dataStore.state.relays;
        if (currentRelays.length === 0) {
            Logger.warn(`Not subscribing to ${id}: No relays available.`);
            return;
        }

        const sub = this.pool.subscribe(currentRelays, filters, {
            onevent: (event) => {
                if (this.seenEventIds.has(event.id)) {
                    return; // Already processed this event
                }
                this.seenEventIds.add(event.id);
                // Prune the seenEventIds set to prevent unbounded growth
                if (this.seenEventIds.size > SEEN_EVENT_IDS_MAX_SIZE) {
                    const tempArray = Array.from(this.seenEventIds);
                    this.seenEventIds = new Set(tempArray.slice(tempArray.length - SEEN_EVENT_IDS_TRIM_THRESHOLD));
                }
                this.processNostrEvent(event, id);
            },
            oneose: () => {}, // End of stored events marker
            onclose: (reason) => Logger.warn(`Subscription ${id} closed: ${reason}`),
        });
        this.subs.set(id, sub);
    }

    async publish(eventTemplate) {
        const {sk} = this.dataStore.state.identity;
        if (!sk) throw new Error('Not logged in.');

        let signedEvent;
        try {
            signedEvent = finalizeEvent(eventTemplate, sk);
        } catch (err) {
            Logger.error('Failed to sign event:', err, eventTemplate);
            throw err;
        }

        const currentRelays = this.dataStore.state.relays;
        if (currentRelays.length === 0) throw new Error('No relays available for publishing.');

        try {
            const results = await Promise.any(this.pool.publish(currentRelays, signedEvent));
            return signedEvent;
        } catch (err) {
            if (err instanceof AggregateError) {
                Logger.error('Publish failed on all relays (AggregateError):', err.errors);
            } else {
                Logger.error('Publish failed on all relays (Unknown Error):', err);
            }
            throw new Error('Failed to publish event to any relay.');
        }
    }

    subscribeToCoreEvents() {
        // Subscribe to public text notes
        this.subscribe('public', [{kinds: [TEXT_NOTE_KIND]}], { onevent(event) {} });
        const {identity} = this.dataStore.state;
        if (identity.pk) {
            const sevenDaysAgo = now() - SEVEN_DAYS_IN_SECONDS;
            // Subscribe to DMs addressed to the user
            this.subscribe('dms', [{kinds: [ENCRYPTED_DM_KIND], '#p': [identity.pk], since: sevenDaysAgo}]);
            // Subscribe to user's own profile updates
            this.subscribe('profile', [{kinds: [PROFILE_KIND], authors: [identity.pk], limit: 1}]);
            this.resubscribeToGroups(); // Resubscribe to any group chats
        }
    }

    resubscribeToGroups() {
        const gids = Object.values(this.dataStore.state.thoughts).filter(c => c.type === 'group').map(c => c.id);
        if (gids.length > 0) {
            const sevenDaysAgo = now() - SEVEN_DAYS_IN_SECONDS;
            this.subscribe('groups', [{
                kinds: [GROUP_CHAT_KIND], // Use constant for group chat kind
                '#g': gids,
                since: sevenDaysAgo
            }]);
        } else {
            // If no groups, ensure any existing group subscription is closed
            this.subs.get('groups')?.unsub();
        }
    }

    async fetchHistoricalMessages(thought) {
        const {identity, relays} = this.dataStore.state;
        if (relays.length === 0 || !thought) {
            Logger.warn('Cannot fetch historical messages: Missing relays or thought.');
            return;
        }

        let filters = [];
        const publicHistoricalPeriod = now() - SEVEN_DAYS_IN_SECONDS;
        const publicHistoricalLimit = 20; // Specific limit for public feed history
        const dmGroupHistoricalPeriod = now() - SEVEN_DAYS_IN_SECONDS;

        if (thought.type === 'public') {
            filters.push({kinds: [TEXT_NOTE_KIND], limit: publicHistoricalLimit, since: publicHistoricalPeriod});
        } else if (thought.type === 'dm' && identity.pk) {
            filters.push({
                kinds: [ENCRYPTED_DM_KIND],
                '#p': [thought.pubkey],
                authors: [identity.pk, thought.pubkey], // Fetch DMs sent by user or to user from the other party
                limit: MESSAGE_LIMIT,
                since: dmGroupHistoricalPeriod
            });
        } else if (thought.type === 'group') {
            filters.push({kinds: [GROUP_CHAT_KIND], '#g': [thought.id], limit: MESSAGE_LIMIT, since: dmGroupHistoricalPeriod});
        } else {
            // Notes are local and don't need historical fetching from relays
            Logger.log(`Skipping historical fetch for unsupported or local thought type: ${thought.type}`);
            return;
        }

        try {
            const events = await this.pool.querySync(relays, filters);
            for (const event of events) {
                await this.processNostrEvent(event, `historical-${thought.id}`);
            }
        } catch (err) {
            Logger.error(`Failed to fetch historical messages for ${thought.id}:`, err);
        }
    }

    async fetchProfile(pubkey) {
        const {profiles, fetchingProfiles, relays} = this.dataStore.state;
        if (!pubkey || profiles[pubkey]?.lastUpdatedAt || fetchingProfiles.has(pubkey) || relays.length === 0) return;

        fetchingProfiles.add(pubkey);
        this.dataStore.emitStateUpdated();

        try {
            const event = await this.pool.get(relays, {kinds: [PROFILE_KIND], authors: [pubkey]}); // Use constant
            if (event) {
                await this.processNostrEvent(event, 'profile-fetch');
            }
        } catch (err) {
            Logger.warn(`Profile fetch failed for ${pubkey}:`, err);
        } finally {
            fetchingProfiles.delete(pubkey);
            this.dataStore.emitStateUpdated();
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
                case PROFILE_KIND: // Kind 0: Profile metadata
                    return await this.processKind0(event);
                case TEXT_NOTE_KIND: // Kind 1: Public text note
                    if (subId === 'public' || subId.startsWith('historical-public')) {
                        thoughtId = 'public'; // Assign to the main public feed
                    } else {
                        // If it's from another subscription, ignore for now, or handle if it's a mention, etc.
                        return;
                    }
                    break;
                case ENCRYPTED_DM_KIND: // Kind 4: Encrypted Direct Message
                    const otherPubkey = event.pubkey === this.dataStore.state.identity.pk ? findTag(event, 'p') : event.pubkey;
                    if (!otherPubkey) return; // DM must have a peer pubkey
                    thoughtId = otherPubkey; // Thought ID for DMs is the other user's pubkey
                    try {
                        if (!this.dataStore.state.identity.sk) {
                            Logger.warn(`Cannot decrypt DM: Secret key (sk) not available. Event ID: ${event.id}`);
                            return;
                        }
                        content = await nip04.decrypt(this.dataStore.state.identity.sk, otherPubkey, event.content);
                        // If this DM is from a new contact, create a thought for them
                        if (!this.dataStore.state.thoughts[thoughtId]) {
                            this.dataStore.setState(s => s.thoughts[thoughtId] = {
                                id: thoughtId, name: shortenPubkey(thoughtId), type: 'dm',
                                pubkey: thoughtId, unread: 0, lastEventTimestamp: now()
                            });
                            await this.dataStore.saveThoughts();
                            this.fetchProfile(thoughtId); // Fetch profile for new DM contact
                        }
                    } catch (err) {
                        Logger.warn(`Failed to decrypt DM for ${thoughtId}: ${err.message}. Event ID: ${event.id}`);
                        return; // Skip processing if decryption fails
                    }
                    break;
                case GROUP_CHAT_KIND: // Kind 41: Custom Group Chat Message
                    const groupTag = findTag(event, 'g'); // 'g' tag indicates the group ID
                    if (!groupTag) return; // Group message must have a group ID
                    thoughtId = groupTag;
                    const group = this.dataStore.state.thoughts[thoughtId];
                    if (!group?.secretKey) {
                        Logger.warn(`No secret key for group ${thoughtId}. Cannot decrypt. Event ID: ${event.id}`);
                        return; // Cannot decrypt without the group's secret key
                    }
                    try {
                        content = await aesDecrypt(event.content, group.secretKey);
                    } catch (err) {
                        Logger.warn(`Failed to decrypt group message for ${thoughtId}: ${err.message}. Event ID: ${event.id}`);
                        return; // Skip processing if decryption fails
                    }
                    break;
                default:
                    Logger.log(`Received unhandled event kind: ${event.kind}, ID: ${event.id}`);
                    return; // Ignore unknown event kinds
            }

            if (thoughtId && content !== undefined) {
                await this.processMessage({...event, content: content}, thoughtId);
            }
        } catch (err) {
            Logger.error('Error processing Nostr event:', err, event);
        }
    }

    async processMessage(msg, thoughtId) {
        try {
            const {messages, activeThoughtId, identity} = this.dataStore.state;

            let thoughtMessages = messages[thoughtId];
            if (!thoughtMessages) {
                thoughtMessages = [];
                messages[thoughtId] = thoughtMessages;
            }

            if (thoughtMessages.some(m => m.id === msg.id)) return;

            thoughtMessages.push(msg);

            if (thoughtMessages.length > MESSAGE_LIMIT) {
                thoughtMessages.sort((a, b) => a.created_at - b.created_at);
                thoughtMessages.splice(0, thoughtMessages.length - MESSAGE_LIMIT);
            } else {
                thoughtMessages.sort((a, b) => a.created_at - b.created_at);
            }


            const thought = this.dataStore.state.thoughts[thoughtId];
            if (thought) {
                thought.lastEventTimestamp = Math.max(thought.lastEventTimestamp || 0, msg.created_at);
                if (thoughtId !== activeThoughtId && msg.pubkey !== identity.pk) {
                    thought.unread = (thought.unread || 0) + 1;
                }
            }

            if (thoughtId !== 'public') {
                await this.dataStore.saveMessages(thoughtId);
            }

            this.dataStore.emit(`messages:${thoughtId}:updated`, thoughtMessages);
            this.dataStore.emitStateUpdated();

            if (msg.pubkey) {
                this.fetchProfile(msg.pubkey);
            }
        } catch (err) {
            Logger.error(`Error processing message for ${thoughtId}:`, err, msg);
        }
    }

    async processKind0(event) {
        try {
            const profileContent = JSON.parse(event.content);
            const newProfile = {
                name: profileContent.name || profileContent.display_name || shortenPubkey(event.pubkey),
                picture: profileContent.picture,
                nip05: profileContent.nip05,
                pubkey: event.pubkey,
                lastUpdatedAt: event.created_at
            };
            const existingProfile = this.dataStore.state.profiles[event.pubkey];
            if (!existingProfile || newProfile.lastUpdatedAt > (existingProfile.lastUpdatedAt || 0)) {
                this.dataStore.setState(s => {
                    s.profiles[event.pubkey] = newProfile;
                    if (newProfile.pubkey === s.identity.pk) s.identity.profile = newProfile;
                });
                await this.dataStore.saveProfiles();
            }
        } catch (err) {
            Logger.warn('Error parsing profile event:', err, event.content);
        }
    }
}
