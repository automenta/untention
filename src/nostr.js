const {generateSecretKey, getPublicKey, finalizeEvent, verifyEvent, nip19, nip04, SimplePool} = NostrTools;

import {EventEmitter, Logger, Utils} from "./utils.js";

const MESSAGE_LIMIT = 100; // Max messages to keep per thought (moved from index.js)

export class Nostr extends EventEmitter {
    constructor(dataStore, uiController) {
        super();
        this.dataStore = dataStore;
        this.ui = uiController; // Added uiController
        this.pool = new SimplePool();
        this.subs = new Map();
        this.seenEventIds = new Set();
        this.connectionStatus = 'disconnected';
        // Removed: this.appController = null;
    }

    connect() {
        this.disconnect(); // Clear previous state
        const relays = this.dataStore.state.relays;
        if (relays.length === 0) {
            this.updateConnectionStatus('disconnected');
            this.ui?.showToast('No relays configured. Please add relays.', 'warn');
            return;
        }

        this.pool = new SimplePool(); // Create a new pool for a new connection attempt
        this.updateConnectionStatus('connecting');
        this.subscribeToCoreEvents();
        this.updateConnectionStatus('connected'); // Immediately show connected, actual events will flow
        this.ui?.showToast(`Subscriptions sent to ${relays.length} relays.`, 'success');
    }

    disconnect() {
        // Unsubscribe all active subscriptions first
        this.subs.forEach(sub => {
            if (sub && typeof sub.unsub === 'function') {
                sub.unsub();
            } else {
                Logger.warn('Attempted to unsub an invalid subscription object:', sub);
            }
        });
        this.subs.clear(); // Clear the map after unsubscribing

        // Then close the pool connections
        if (this.pool) {
            this.pool.close(this.dataStore.state.relays); // This closes WebSocket connections
        }

        this.updateConnectionStatus('disconnected');
    }

    updateConnectionStatus(status) {
        if (this.connectionStatus === status) return;
        this.connectionStatus = status;
        Logger.log(`Relay status: ${status}`);
        this.emit('connection:status', {
            status,
            count: this.dataStore.state.relays.length
        });
    }

    subscribe(id, filters) {
        this.subs.get(id)?.unsub(); // Unsubscribe from previous subscription with the same ID

        const currentRelays = this.dataStore.state.relays;
        if (currentRelays.length === 0) {
            Logger.warn(`Not subscribing to ${id}: No relays available.`);
            return;
        }

        Logger.log(`[Nostr] Subscribing to '${id}' with filters:`, filters);
        // NEW LOGS: Detailed inspection of the filters array and its first element
        Logger.log(`[Nostr] Type of filters: ${typeof filters}, isArray: ${Array.isArray(filters)}`);
        if (Array.isArray(filters) && filters.length > 0) {
            Logger.log(`[Nostr] Type of first filter element: ${typeof filters[0]}, isObject: ${typeof filters[0] === 'object' && filters[0] !== null}`);
            try {
                Logger.log(`[Nostr] JSON.stringify(filters[0]): ${JSON.stringify(filters[0])}`);
            } catch (e) {
                Logger.error(`[Nostr] Error stringifying filter:`, e);
            }
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
                // Directly call processNostrEvent instead of emitting
                this.processNostrEvent(event, id);
            },
            oneose: () => {}, // Removed Logger.log(`[EOSE] for sub '${id}'`)
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
            await Promise.any(this.pool.publish(currentRelays, signedEvent));
            return signedEvent;
        } catch (e) {
            Logger.error('Publish failed on all relays:', e);
            throw new Error('Failed to publish event to any relay.');
        }
    }

    subscribeToCoreEvents() {
        const currentRelays = this.dataStore.state.relays;
        if (currentRelays.length === 0) {
            Logger.warn('Not subscribing to core events: No relays available.');
            return;
        }
        // These subscriptions are for real-time streaming of new events.
        // Historical fetching is handled by fetchHistoricalMessages.
        // Removed 'since' filter for public feed to align with working snippet's behavior
        // and receive all new incoming messages regardless of age.
        this.subscribe('public', {kinds: [1]},
            {
                onevent(event) {

                }
            });
        const {identity} = this.dataStore.state;
        if (identity.pk) {
            const sevenDaysAgo = Utils.now() - (7 * 24 * 60 * 60); // Events from the last 7 days for live stream
            this.subscribe('dms', [{kinds: [4], '#p': [identity.pk], since: sevenDaysAgo}]);
            this.subscribe('profile', [{kinds: [0], authors: [identity.pk], limit: 1}]);
            this.resubscribeToGroups();
        }
    }

    resubscribeToGroups() {
        const gids = Object.values(this.dataStore.state.thoughts).filter(c => c.type === 'group').map(c => c.id);
        const currentRelays = this.dataStore.state.relays;
        if (gids.length > 0 && currentRelays.length > 0) {
            const sevenDaysAgo = Utils.now() - (7 * 24 * 60 * 60); // Events from the last 7 days for live stream
            this.subscribe('groups', [{
                kinds: [41],
                '#g': gids,
                since: sevenDaysAgo
            }]);
        } else {
            this.subs.get('groups')?.unsub();
        }
    }

    /**
     * Fetches historical messages for a specific thought using querySync.
     * These events will then be processed by AppController.processNostrEvent.
     */
    async fetchHistoricalMessages(thought) {
        const {identity, relays} = this.dataStore.state;
        // Removed !this.appController from the condition
        if (relays.length === 0 || !thought) {
            Logger.warn('Cannot fetch historical messages: Missing relays or thought.');
            return;
        }

        let filters = [];
        // Align public feed historical fetch with working feed.html's more conservative query.
        const publicHistoricalPeriod = Utils.now() - (7 * 24 * 60 * 60); // Last 7 days for public feed (was 24 hours)
        const publicHistoricalLimit = 20; // Limit to 20 events for public feed
        const dmGroupHistoricalPeriod = Utils.now() - (7 * 24 * 60 * 60); // Last 7 days for DMs/Groups

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
                // Call own processNostrEvent
                await this.processNostrEvent(event, `historical-${thought.id}`);
            }
        } catch (e) {
            Logger.error(`Failed to fetch historical messages for ${thought.id}:`, e);
        }
    }

    async fetchProfile(pubkey) {
        const {profiles, fetchingProfiles, relays} = this.dataStore.state;
        if (!pubkey || profiles[pubkey]?.lastUpdatedAt || fetchingProfiles.has(pubkey) || relays.length === 0) return;

        fetchingProfiles.add(pubkey);
        this.dataStore.emitStateUpdated(); // Changed to debounced emitter

        try {
            const event = await this.pool.get(relays, {kinds: [0], authors: [pubkey]});
            if (event) {
                // Call own processNostrEvent with a specific subId for profile fetches
                await this.processNostrEvent(event, 'profile-fetch');
            }
        } catch (e) {
            Logger.warn(`Profile fetch failed for ${pubkey}:`, e);
        } finally {
            fetchingProfiles.delete(pubkey);
            this.dataStore.emitStateUpdated(); // Changed to debounced emitter
        }
    }

    // --- Methods moved from App class ---
    async processNostrEvent(event, subId) {
        try {
            if (!verifyEvent(event)) { // verifyEvent is from global NostrTools
                Logger.warn('Invalid event signature:', event);
                return;
            }

            let thoughtId, content = event.content;

            switch (event.kind) {
                case 0: // Profile metadata
                    return await this.processKind0(event);

                case 1: // Public text note
                    if (subId === 'public' || subId.startsWith('historical-public')) {
                        thoughtId = 'public';
                    } else if (subId === 'profile-fetch') { // Kind 0 from fetchProfile might be re-processed if not handled carefully
                        // This case might be redundant if processKind0 handles everything from profile fetches.
                        // However, if processKind0 is only for kind 0 events, this is fine.
                        // For now, let's assume profile-fetch events are handled by their kind.
                        return;
                    }
                    else {
                        return;
                    }
                    break;

                case 4: // Encrypted Direct Message
                    const other = event.pubkey === this.dataStore.state.identity.pk ? Utils.findTag(event, 'p') : event.pubkey;
                    if (!other) return;
                    thoughtId = other;
                    try {
                        if (!this.dataStore.state.identity.sk) {
                            Logger.warn(`Cannot decrypt DM, identity not loaded. Event ID: ${event.id}`);
                            return;
                        }
                        content = await nip04.decrypt(this.dataStore.state.identity.sk, other, event.content); // nip04 from global
                        if (!this.dataStore.state.thoughts[thoughtId]) {
                            this.dataStore.setState(s => s.thoughts[thoughtId] = {
                                id: thoughtId, name: Utils.shortenPubkey(thoughtId), type: 'dm',
                                pubkey: thoughtId, unread: 0, lastEventTimestamp: Utils.now()
                            });
                            await this.dataStore.saveThoughts();
                            this.fetchProfile(thoughtId); // Call own fetchProfile
                        }
                    } catch (e) {
                        Logger.warn(`Failed to decrypt DM for ${thoughtId}:`, e);
                        return;
                    }
                    break;

                case 41: // Encrypted Group Message
                    const gTag = Utils.findTag(event, 'g');
                    if (!gTag) return;
                    thoughtId = gTag;
                    const group = this.dataStore.state.thoughts[thoughtId];
                    if (!group?.secretKey) return;
                    try {
                        content = await Utils.crypto.aesDecrypt(event.content, group.secretKey);
                    } catch (e) {
                        Logger.warn(`Failed to decrypt group message for ${thoughtId}:`, e);
                        return;
                    }
                    break;

                default:
                    return;
            }

            if (thoughtId) {
                await this.processMessage({...event, content}, thoughtId);
            }
        } catch (e) {
            Logger.error('Error processing Nostr event:', e);
        }
    }

    async processMessage(msg, tId) {
        try {
            const {messages, activeThoughtId, identity} = this.dataStore.state;

            let msgs = messages[tId];
            if (!msgs) {
                msgs = [];
                messages[tId] = msgs;
            }

            if (msgs.some(m => m.id === msg.id)) {
                return;
            }

            msgs.push(msg);

            if (msgs.length > MESSAGE_LIMIT) { // MESSAGE_LIMIT is now defined in this file
                msgs.shift();
            }

            msgs.sort((a, b) => a.created_at - b.created_at);

            const t = this.dataStore.state.thoughts[tId];
            if (t) {
                t.lastEventTimestamp = Math.max(t.lastEventTimestamp || 0, msg.created_at);
                if (tId !== activeThoughtId && msg.pubkey !== identity.pk) {
                    t.unread = (t.unread || 0) + 1;
                }
            }

            if (tId !== 'public') {
                await this.dataStore.saveMessages(tId);
            }

            this.dataStore.emit(`messages:${tId}:updated`, msgs);
            this.dataStore.emitStateUpdated();

            this.fetchProfile(msg.pubkey); // Call own fetchProfile
        } catch (e) {
            Logger.error(`Error processing message for ${tId}:`, e);
        }
    }

    async processKind0(event) {
        try {
            const p = JSON.parse(event.content);
            const n = {
                name: p.name || p.display_name || Utils.shortenPubkey(event.pubkey),
                picture: p.picture,
                nip05: p.nip05,
                pubkey: event.pubkey,
                lastUpdatedAt: event.created_at
            };
            const existingProfile = this.dataStore.state.profiles[event.pubkey];
            if (!existingProfile || n.lastUpdatedAt > (existingProfile.lastUpdatedAt ?? 0)) {
                this.dataStore.setState(s => {
                    s.profiles[event.pubkey] = n;
                    if (n.pubkey === s.identity.pk) s.identity.profile = n;
                });
                await this.dataStore.saveProfiles();
            }
        } catch (e) {
            Logger.warn('Error parsing profile event:', e);
        }
    }
}
