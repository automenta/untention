const {generateSecretKey, getPublicKey, finalizeEvent, verifyEvent, nip19, nip04, SimplePool} = NostrTools;

import {EventEmitter, Logger, Utils} from "./utils.js";

const MESSAGE_LIMIT = 100;

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
            this.ui?.showToast('No relays configured. Please add relays.', 'warn');
            return;
        }

        this.pool = new SimplePool();
        this.updateConnectionStatus('connecting');
        this.subscribeToCoreEvents();
        this.updateConnectionStatus('connected');
        this.ui?.showToast(`Subscriptions sent to ${relays.length} relays.`, 'success');
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

    subscribe(id, filters) { // Removed opts from signature as it's not used
        this.subs.get(id)?.unsub();

        const currentRelays = this.dataStore.state.relays;
        if (currentRelays.length === 0) {
            Logger.warn(`Not subscribing to ${id}: No relays available.`);
            return;
        }

        const sub = this.pool.subscribe(currentRelays, filters, {
            onevent: (event) => {
                if (this.seenEventIds.has(event.id)) {
                    return;
                }
                this.seenEventIds.add(event.id);
                if (this.seenEventIds.size > 2000) {
                    const tempArray = Array.from(this.seenEventIds);
                    this.seenEventIds = new Set(tempArray.slice(tempArray.length - 1500));
                }
                this.processNostrEvent(event, id);
            },
            oneose: () => {}, // Basic EOSE handler
            onclose: (reason) => Logger.warn(`Subscription ${id} closed: ${reason}`),
        });
        this.subs.set(id, sub);
    }

    async publish(eventTemplate) {
        const {sk} = this.dataStore.state.identity;
        if (!sk) throw new Error('Not logged in.');

        const signedEvent = finalizeEvent(eventTemplate, sk);
        const currentRelays = this.dataStore.state.relays;
        if (currentRelays.length === 0) throw new Error('No relays available for publishing.');

        try {
            // SimplePool.publish returns array of promises. Promise.any needs this.
            const results = await Promise.any(this.pool.publish(currentRelays, signedEvent));
            // Ensure results is not empty and at least one success, though Promise.any handles the all-reject case.
            // For now, if Promise.any resolves, we consider it a success.
            return signedEvent;
        } catch (err) {
            Logger.error('Publish failed on all relays:', err);
            throw new Error('Failed to publish event to any relay.');
        }
    }

    subscribeToCoreEvents() {
        this.subscribe('public', [{kinds: [1]}], { onevent(event) {} }); // Wrapped filter in array, options still passed but ignored by current subscribe
        const {identity} = this.dataStore.state;
        if (identity.pk) {
            const sevenDaysAgo = Utils.now() - (7 * 24 * 60 * 60);
            this.subscribe('dms', [{kinds: [4], '#p': [identity.pk], since: sevenDaysAgo}]);
            this.subscribe('profile', [{kinds: [0], authors: [identity.pk], limit: 1}]);
            this.resubscribeToGroups();
        }
    }

    resubscribeToGroups() {
        const gids = Object.values(this.dataStore.state.thoughts).filter(c => c.type === 'group').map(c => c.id);
        if (gids.length > 0) {
            const sevenDaysAgo = Utils.now() - (7 * 24 * 60 * 60);
            this.subscribe('groups', [{
                kinds: [41],
                '#g': gids,
                since: sevenDaysAgo
            }]);
        } else {
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
        const publicHistoricalPeriod = Utils.now() - (7 * 24 * 60 * 60);
        const publicHistoricalLimit = 20;
        const dmGroupHistoricalPeriod = Utils.now() - (7 * 24 * 60 * 60);

        if (thought.type === 'public') {
            filters.push({kinds: [1], limit: publicHistoricalLimit, since: publicHistoricalPeriod});
        } else if (thought.type === 'dm' && identity.pk) {
            filters.push({
                kinds: [4],
                '#p': [thought.pubkey],
                authors: [identity.pk, thought.pubkey],
                limit: MESSAGE_LIMIT,
                since: dmGroupHistoricalPeriod
            });
        } else if (thought.type === 'group') {
            filters.push({kinds: [41], '#g': [thought.id], limit: MESSAGE_LIMIT, since: dmGroupHistoricalPeriod});
        } else {
            Logger.log(`Skipping historical fetch for unsupported thought type: ${thought.type}`);
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
            const event = await this.pool.get(relays, {kinds: [0], authors: [pubkey]});
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
                case 0:
                    return await this.processKind0(event);
                case 1:
                    if (subId === 'public' || subId.startsWith('historical-public')) {
                        thoughtId = 'public';
                    } else {
                        return; // Ignore non-public kind 1 notes not from a public-specific subscription
                    }
                    break;
                case 4:
                    const otherPubkey = event.pubkey === this.dataStore.state.identity.pk ? Utils.findTag(event, 'p') : event.pubkey;
                    if (!otherPubkey) return;
                    thoughtId = otherPubkey;
                    try {
                        if (!this.dataStore.state.identity.sk) {
                            Logger.warn(`Cannot decrypt DM, identity not loaded. Event ID: ${event.id}`);
                            return;
                        }
                        content = await nip04.decrypt(this.dataStore.state.identity.sk, otherPubkey, event.content);
                        if (!this.dataStore.state.thoughts[thoughtId]) {
                            this.dataStore.setState(s => s.thoughts[thoughtId] = {
                                id: thoughtId, name: Utils.shortenPubkey(thoughtId), type: 'dm',
                                pubkey: thoughtId, unread: 0, lastEventTimestamp: Utils.now()
                            });
                            await this.dataStore.saveThoughts();
                            this.fetchProfile(thoughtId); // Fetch profile of new DM partner
                        }
                    } catch (err) {
                        Logger.warn(`Failed to decrypt DM for ${thoughtId}: ${err.message}. Event ID: ${event.id}`);
                        return;
                    }
                    break;
                case 41: // Group Message
                    const groupTag = Utils.findTag(event, 'g');
                    if (!groupTag) return; // Not a valid group message
                    thoughtId = groupTag;
                    const group = this.dataStore.state.thoughts[thoughtId];
                    if (!group?.secretKey) {
                        Logger.warn(`No secret key for group ${thoughtId}. Cannot decrypt. Event ID: ${event.id}`);
                        return;
                    }
                    try {
                        content = await Utils.crypto.aesDecrypt(event.content, group.secretKey);
                    } catch (err) {
                        Logger.warn(`Failed to decrypt group message for ${thoughtId}: ${err.message}. Event ID: ${event.id}`);
                        return;
                    }
                    break;
                default:
                    Logger.log(`Received unhandled event kind: ${event.kind}`);
                    return;
            }

            if (thoughtId && content !== undefined) { // Ensure content is available (decrypted)
                // Pass the original event object but with potentially decrypted content
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

            if (thoughtMessages.some(m => m.id === msg.id)) return; // Already processed

            thoughtMessages.push(msg);

            // Keep only the latest MESSAGE_LIMIT messages
            if (thoughtMessages.length > MESSAGE_LIMIT) {
                thoughtMessages.sort((a, b) => a.created_at - b.created_at); // Ensure sorted before splice
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

            // Only save messages for non-public thoughts to localforage
            if (thoughtId !== 'public') {
                await this.dataStore.saveMessages(thoughtId);
            }

            this.dataStore.emit(`messages:${thoughtId}:updated`, thoughtMessages);
            this.dataStore.emitStateUpdated(); // General state update for unread counts, etc.

            // Fetch profile of the message sender if not already known/recently updated
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
                name: profileContent.name || profileContent.display_name || Utils.shortenPubkey(event.pubkey),
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
