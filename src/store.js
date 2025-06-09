import { Utils, Logger, EventEmitter } from './utils.js';
// NostrTools will be available globally via script tag in index.html
// For localforage, it's also expected to be global.

const { getPublicKey } = NostrTools; // Assuming NostrTools is global

export class Data extends EventEmitter {
    constructor() {
        super();
        this.state = {
            identity: {sk: null, pk: null, profile: null},
            relays: [
                'wss://relay.damus.io',
                'wss://nostr.wine',
                'wss://nos.lol',
                'wss://relay.snort.social',
                'wss://eden.nostr.land',
                'wss://purple.plus',
                'wss://atlas.nostr.land',
                'wss://relay.nostr.band'
            ],
            thoughts: {},
            messages: {},
            profiles: {},
            activeThoughtId: 'public',
            fetchingProfiles: new Set(),
        };
        this.debounceTimer = null;
        this.DEBOUNCE_DELAY = 100;
    }

    async load() {
        try {
            const [i, t, p, a, r] = await Promise.all([
                localforage.getItem('identity_v2').catch(() => null),
                localforage.getItem('thoughts_v3').catch(() => null),
                localforage.getItem('profiles_v2').catch(() => null),
                localforage.getItem('activeThoughtId_v3').catch(() => null),
                localforage.getItem('relays_v2').catch(() => null)
            ]);
            if (i?.skHex) {
                try {
                    this.state.identity.sk = Utils.hexToBytes(i.skHex);
                    this.state.identity.pk = getPublicKey(this.state.identity.sk);
                } catch (e) {
                    Logger.error("Failed to load identity:", e);
                    await this.clearIdentity();
                }
            }
            this.state.thoughts = t && typeof t === 'object' ? t : {};
            if (!this.state.thoughts.public) {
                this.state.thoughts.public = {
                    id: 'public',
                    name: 'Public Feed',
                    type: 'public',
                    unread: 0,
                    lastEventTimestamp: 0
                };
            }
            this.state.profiles = p && typeof p === 'object' ? p : {};
            this.state.activeThoughtId = a && typeof a === 'string' ? a : 'public';
            this.state.relays = r && Array.isArray(r) ? r.filter(Utils.validateRelayUrl) : this.state.relays;
            if (this.state.identity.pk && this.state.profiles[this.state.identity.pk]) {
                this.state.identity.profile = this.state.profiles[this.state.identity.pk];
            }
            Object.values(this.state.thoughts).forEach(th => th.lastEventTimestamp = th.lastEventTimestamp ?? 0);
            this.emitStateUpdated();
        } catch (e) {
            Logger.error('DataStore load failed:', e);
            await this.clearIdentity();
            this.emitStateUpdated();
        }
    }

    setState(updater) {
        updater(this.state);
        this.emitStateUpdated();
    }

    emitStateUpdated() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.emit('state:updated', this.state);
            this.debounceTimer = null;
        }, this.DEBOUNCE_DELAY);
    }

    async saveIdentity(sk) {
        await localforage.setItem('identity_v2', {skHex: Utils.bytesToHex(sk)});
    }

    async saveThoughts() {
        await localforage.setItem('thoughts_v3', this.state.thoughts);
    }

    async saveProfiles() {
        await localforage.setItem('profiles_v2', this.state.profiles);
    }

    async saveActiveThoughtId() {
        await localforage.setItem('activeThoughtId_v3', this.state.activeThoughtId);
    }

    async saveRelays() {
        await localforage.setItem('relays_v2', this.state.relays);
    }

    async saveMessages(tId) {
        if (tId && Array.isArray(this.state.messages[tId])) {
            await localforage.setItem(`messages_${tId}`, this.state.messages[tId]);
        }
    }

    async clearIdentity() {
        const k = await localforage.keys();
        await Promise.all([
            localforage.removeItem('identity_v2'),
            localforage.removeItem('thoughts_v3'),
            localforage.removeItem('profiles_v2'),
            localforage.removeItem('activeThoughtId_v3'),
            ...k.filter(key => key.startsWith('messages_')).map(key => localforage.removeItem(key))
        ]);
        this.setState(s => {
            s.identity = {sk: null, pk: null, profile: null};
            s.thoughts = {
                public: {
                    id: 'public',
                    name: 'Public Feed',
                    type: 'public',
                    unread: 0,
                    lastEventTimestamp: 0
                }
            };
            s.messages = {};
            s.profiles = {};
            s.activeThoughtId = 'public';
        });
    }

    async loadMessages(tId) {
        if (tId) {
            try {
                const messages = await localforage.getItem(`messages_${tId}`);
                this.state.messages[tId] = Array.isArray(messages) ? messages : [];
            } catch (e) {
                Logger.error(`Failed to load messages for ${tId}:`, e);
                this.state.messages[tId] = [];
            }
            this.emit(`messages:${tId}:updated`, this.state.messages[tId]);
        }
    }
}
