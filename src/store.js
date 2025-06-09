import { Utils, Logger, EventEmitter } from './utils.js';

const { getPublicKey } = NostrTools;

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
            const [identityData, thoughtsData, profilesData, activeThoughtIdData, relaysData] = await Promise.all([
                localforage.getItem('identity_v2').catch(() => null),
                localforage.getItem('thoughts_v3').catch(() => null),
                localforage.getItem('profiles_v2').catch(() => null),
                localforage.getItem('activeThoughtId_v3').catch(() => null),
                localforage.getItem('relays_v2').catch(() => null)
            ]);
            if (identityData?.skHex) {
                try {
                    this.state.identity.sk = Utils.hexToBytes(identityData.skHex);
                    this.state.identity.pk = getPublicKey(this.state.identity.sk);
                } catch (err) {
                    Logger.error("Failed to load identity:", err);
                    await this.clearIdentity();
                }
            }
            this.state.thoughts = thoughtsData && typeof thoughtsData === 'object' ? thoughtsData : {};
            if (!this.state.thoughts.public) {
                this.state.thoughts.public = {
                    id: 'public',
                    name: 'Public Feed',
                    type: 'public',
                    unread: 0,
                    lastEventTimestamp: 0
                };
            }
            this.state.profiles = profilesData && typeof profilesData === 'object' ? profilesData : {};
            this.state.activeThoughtId = typeof activeThoughtIdData === 'string' ? activeThoughtIdData : 'public';
            this.state.relays = Array.isArray(relaysData) ? relaysData.filter(Utils.validateRelayUrl) : this.state.relays;
            if (this.state.identity.pk && this.state.profiles[this.state.identity.pk]) {
                this.state.identity.profile = this.state.profiles[this.state.identity.pk];
            }
            Object.values(this.state.thoughts).forEach(th => th.lastEventTimestamp ||= 0);
            this.emitStateUpdated();
        } catch (err) {
            Logger.error('DataStore load failed:', err);
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
        try {
            await localforage.setItem('identity_v2', {skHex: Utils.bytesToHex(sk)});
        } catch (err) {
            Logger.error('Failed to save identity:', err);
        }
    }

    async saveThoughts() {
        try {
            await localforage.setItem('thoughts_v3', this.state.thoughts);
        } catch (err) {
            Logger.error('Failed to save thoughts:', err);
        }
    }

    async saveProfiles() {
        try {
            await localforage.setItem('profiles_v2', this.state.profiles);
        } catch (err) {
            Logger.error('Failed to save profiles:', err);
        }
    }

    async saveActiveThoughtId() {
        try {
            await localforage.setItem('activeThoughtId_v3', this.state.activeThoughtId);
        } catch (err) {
            Logger.error('Failed to save activeThoughtId:', err);
        }
    }

    async saveRelays() {
        try {
            await localforage.setItem('relays_v2', this.state.relays);
        } catch (err) {
            Logger.error('Failed to save relays:', err);
        }
    }

    async saveMessages(tId) {
        if (tId && Array.isArray(this.state.messages[tId])) {
            try {
                await localforage.setItem(`messages_${tId}`, this.state.messages[tId]);
            } catch (err) {
                Logger.error(`Failed to save messages for ${tId}:`, err);
            }
        }
    }

    async clearIdentity() {
        try {
            const keys = await localforage.keys();
            await Promise.all(keys.map(key => {
                if (key.startsWith('identity_v2') ||
                    key.startsWith('thoughts_v3') ||
                    key.startsWith('profiles_v2') ||
                    key.startsWith('activeThoughtId_v3') ||
                    key.startsWith('messages_')) {
                    return localforage.removeItem(key).catch(err => Logger.error(`Failed to remove item ${key}:`, err));
                }
                return Promise.resolve();
            }));
        } catch (err) {
            Logger.error('Failed to get keys or remove items during clearIdentity:', err);
        }
        this.setState(state => {
            state.identity = {sk: null, pk: null, profile: null};
            state.thoughts = {
                public: {
                    id: 'public',
                    name: 'Public Feed',
                    type: 'public',
                    unread: 0,
                    lastEventTimestamp: 0
                }
            };
            state.messages = {};
            state.profiles = {};
            state.activeThoughtId = 'public';
        });
    }

    async loadMessages(thoughtId) {
        if (thoughtId) {
            try {
                const messages = await localforage.getItem(`messages_${thoughtId}`);
                this.state.messages[thoughtId] = Array.isArray(messages) ? messages : [];
            } catch (err) {
                Logger.error(`Failed to load messages for ${thoughtId}:`, err);
                this.state.messages[thoughtId] = [];
            }
            this.emit(`messages:${thoughtId}:updated`, this.state.messages[thoughtId]);
        }
    }
}
