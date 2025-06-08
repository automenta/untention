const {generateSecretKey, getPublicKey, finalizeEvent, verifyEvent, nip19, nip04, SimplePool} = NostrTools;

import {EventEmitter, Logger, Utils} from "./utils.js";

export class Nostr extends EventEmitter {
    constructor(dataStore) {
        super();
        this.dataStore = dataStore;
        this.pool = new SimplePool();
        this.subs = new Map();
        this.seenEventIds = new Set();
        this.connectionStatus = 'disconnected';
        this.appController = null; // Will be set by AppController
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
                // THIS IS THE CRITICAL NEW LOG: It will fire for ANY event received by SimplePool for this sub.
                Logger.log(`[Nostr] === Event received by SimplePool for sub '${id}' ===`, event); 

                Logger.log(`[Nostr] Raw event received for sub '${id}': kind=${event.kind}, id=${event.id.slice(0, 8)}...`);
                if (this.seenEventIds.has(event.id)) {
                    Logger.log(`[Nostr] Event ${event.id.slice(0, 8)}... for sub '${id}' skipped (already seen).`);
                    return;
                }
                this.seenEventIds.add(event.id);
                if (this.seenEventIds.size > 2000) {
                    const tempArray = Array.from(this.seenEventIds);
                    this.seenEventIds = new Set(tempArray.slice(tempArray.length - 1500));
                }
                this.emit('event', {event, subId: id});
            },
            oneose: () => Logger.log(`[EOSE] for sub '${id}'`),
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
        this.subscribe('public', [{kinds: [1]}]); // No limit or since here, just stream
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
        if (relays.length === 0 || !thought || !this.appController) {
            Logger.warn('Cannot fetch historical messages: Missing relays, thought, or appController reference.');
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

        Logger.log(`Attempting to fetch historical messages for thought ${thought.id} (${thought.type}) with filters:`, filters, 'from relays:', relays);
        try {
            const events = await this.pool.querySync(relays, filters);
            Logger.log(`Fetched ${events.length} historical events for ${thought.id}. First event (if any):`, events[0]);
            for (const event of events) {
                await this.appController.processNostrEvent(event, `historical-${thought.id}`);
            }
        } catch (e) {
            Logger.error(`Failed to fetch historical messages for ${thought.id}:`, e);
        }
    }

    async fetchProfile(pubkey) {
        const {profiles, fetchingProfiles, relays} = this.dataStore.state;
        if (!pubkey || profiles[pubkey]?.lastUpdatedAt || fetchingProfiles.has(pubkey) || relays.length === 0) return;

        fetchingProfiles.add(pubkey);
        this.emit('state:updated', this.dataStore.state);

        try {
            const event = await this.pool.get(relays, {kinds: [0], authors: [pubkey]});
            if (event) {
                this.emit('event', {event}); // Process the fetched profile event
            }
        } catch (e) {
            Logger.warn(`Profile fetch failed for ${pubkey}:`, e);
        } finally {
            fetchingProfiles.delete(pubkey);
            this.emit('state:updated', this.dataStore.state);
        }
    }
}
