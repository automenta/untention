const {generateSecretKey, getPublicKey, finalizeEvent, verifyEvent, nip19, nip04, SimplePool} = NostrTools;

import { EventEmitter } from './event-emitter.js';
import { Logger } from './logger.js';
import { now } from './utils/time-utils.js';
import { NostrEventProcessor } from './nostr-event-processor.js';

const PROFILE_KIND = 0;
const TEXT_NOTE_KIND = 1;
const ENCRYPTED_DM_KIND = 4;
const GROUP_CHAT_KIND = 41;

const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;
const SEEN_EVENT_IDS_MAX_SIZE = 2000;
const SEEN_EVENT_IDS_TRIM_THRESHOLD = 1500;
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
        this.eventProcessor = new NostrEventProcessor(dataStore, this, uiController);
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
                Logger.warnWithContext('Nostr', 'Attempted to unsub an invalid subscription object:', sub);
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
            Logger.warnWithContext('Nostr', `Not subscribing to ${id}: No relays available.`);
            return;
        }

        const sub = this.pool.subscribe(currentRelays, filters, {
            onevent: (event) => {
                Logger.debug('Nostr', `Received event for sub ${id}:`, event);
                if (this.seenEventIds.has(event.id)) {
                    Logger.debug('Nostr', `Event ${event.id} already seen, skipping.`);
                    return;
                }
                this.seenEventIds.add(event.id);
                if (this.seenEventIds.size > SEEN_EVENT_IDS_MAX_SIZE) {
                    const tempArray = Array.from(this.seenEventIds);
                    this.seenEventIds = new Set(tempArray.slice(tempArray.length - SEEN_EVENT_IDS_TRIM_THRESHOLD));
                    Logger.debug('Nostr', 'Pruned seenEventIds set.');
                }
                this.eventProcessor.processNostrEvent(event, id);
            },
            oneose: () => {
                Logger.debug('Nostr', `Subscription ${id} received EOSE.`);
            },
            onclose: (reason) => Logger.warnWithContext('Nostr', `Subscription ${id} closed: ${reason}`),
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
            Logger.errorWithContext('Nostr', 'Failed to sign event:', err, eventTemplate);
            throw err;
        }

        const currentRelays = this.dataStore.state.relays;
        if (currentRelays.length === 0) throw new Error('No relays available for publishing.');

        try {
            Logger.debug('Nostr', 'Publishing event:', signedEvent);
            const promises = this.pool.publish(currentRelays, signedEvent);
            if (!Array.isArray(promises) || !promises.every(p => p instanceof Promise)) {
                 Logger.errorWithContext('Nostr', 'this.pool.publish did not return an array of Promises. Mock issue?', promises);
            }
            const results = await Promise.any(promises);
            Logger.debug('Nostr', 'Event published successfully to at least one relay:', results);
            return signedEvent;
        } catch (err) {
            if (err instanceof AggregateError) {
                Logger.errorWithContext('Nostr', 'Publish failed on all relays (AggregateError):', err); // Log the err itself
            } else {
                Logger.errorWithContext('Nostr', 'Publish failed on all relays (Unknown Error):', err);
            }
            throw new Error('Failed to publish event to any relay.');
        }
    }

    subscribeToCoreEvents() {
        this.subscribe('public', [{kinds: [TEXT_NOTE_KIND]}]);
        const {identity} = this.dataStore.state;
        if (identity.pk) {
            const sevenDaysAgo = now() - SEVEN_DAYS_IN_SECONDS;
            this.subscribe('dms', [{kinds: [ENCRYPTED_DM_KIND], '#p': [identity.pk], since: sevenDaysAgo}]);
            this.subscribe('profile', [{kinds: [PROFILE_KIND], authors: [identity.pk], limit: 1}]);
            this.resubscribeToGroups();
        }
    }

    resubscribeToGroups() {
        const gids = Object.values(this.dataStore.state.thoughts).filter(c => c.type === 'group').map(c => c.id);
        if (gids.length > 0) {
            const sevenDaysAgo = now() - SEVEN_DAYS_IN_SECONDS;
            this.subscribe('groups', [{
                kinds: [GROUP_CHAT_KIND],
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
            Logger.warnWithContext('Nostr', 'Cannot fetch historical messages: Missing relays or thought.');
            return;
        }

        let filters = [];
        const publicHistoricalPeriod = now() - SEVEN_DAYS_IN_SECONDS;
        const publicHistoricalLimit = 20;
        const dmGroupHistoricalPeriod = now() - SEVEN_DAYS_IN_SECONDS;

        if (thought.type === 'public') {
            filters.push({kinds: [TEXT_NOTE_KIND], limit: publicHistoricalLimit, since: publicHistoricalPeriod});
        } else if (thought.type === 'dm' && identity.pk) {
            filters.push({
                kinds: [ENCRYPTED_DM_KIND],
                '#p': [thought.pubkey],
                authors: [identity.pk, thought.pubkey],
                limit: MESSAGE_LIMIT,
                since: dmGroupHistoricalPeriod
            });
        } else if (thought.type === 'group') {
            filters.push({kinds: [GROUP_CHAT_KIND], '#g': [thought.id], limit: MESSAGE_LIMIT, since: dmGroupHistoricalPeriod});
        } else {
            Logger.logWithContext('Nostr', `Skipping historical fetch for unsupported or local thought type: ${thought.type}`);
            return;
        }

        try {
            Logger.debug('Nostr', `Fetching historical messages for thought ${thought.id} with filters:`, filters);
            const events = await this.pool.querySync(relays, filters);
            Logger.debug('Nostr', `Fetched ${events.length} historical events for thought ${thought.id}.`);
            for (const event of events) {
                if (this.seenEventIds.has(event.id)) {
                    Logger.debug('Nostr', `Historical event ${event.id} already seen, skipping.`);
                    continue;
                }
                this.seenEventIds.add(event.id);
                await this.eventProcessor.processNostrEvent(event, `historical-${thought.id}`);
            }
        } catch (err) {
            Logger.errorWithContext('Nostr', `Failed to fetch historical messages for ${thought.id}:`, err);
        }
    }

    async fetchProfile(pubkey) {
        const {profiles, fetchingProfiles, relays} = this.dataStore.state;
        if (!pubkey || profiles[pubkey]?.lastUpdatedAt || fetchingProfiles.has(pubkey) || relays.length === 0) {
            if(relays.length === 0 && pubkey) Logger.warnWithContext('Nostr', `Cannot fetch profile for ${pubkey}: No relays.`);
            return;
        }

        fetchingProfiles.add(pubkey);
        this.dataStore.emitStateUpdated();
        Logger.debug('Nostr', `Fetching profile for pubkey: ${pubkey}`);

        try {
            const event = await this.pool.get(relays, {kinds: [PROFILE_KIND], authors: [pubkey]});
            if (event) {
                Logger.debug('Nostr', `Fetched profile event for ${pubkey}:`, event);
                if (!this.seenEventIds.has(event.id)) {
                    this.seenEventIds.add(event.id);
                    await this.eventProcessor.processNostrEvent(event, 'profile-fetch');
                } else {
                    Logger.debug('Nostr', `Profile event ${event.id} for ${pubkey} already seen, skipping.`);
                }
            } else {
                Logger.debug('Nostr', `No profile event found for ${pubkey}.`);
            }
        } catch (err) {
            Logger.warnWithContext('Nostr', `Profile fetch failed for ${pubkey}:`, err);
        } finally {
            fetchingProfiles.delete(pubkey);
            this.dataStore.emitStateUpdated();
        }
    }
}
