import {Logger} from '@/logger.js';
import {EventEmitter} from '@/event-emitter.js';
import {bytesToHex, hexToBytes} from '@/utils/crypto-utils.js';
import {validateRelayUrl} from '@/utils/nostr-utils.js';

const { getPublicKey } = NostrTools;

const IDENTITY_KEY = 'identity_v2';
const THOUGHTS_KEY = 'thoughts_v3';
const PROFILES_KEY = 'profiles_v2';
const ACTIVE_THOUGHT_ID_KEY = 'activeThoughtId_v3';
const RELAYS_KEY = 'relays_v2';
const MESSAGES_KEY_PREFIX = 'messages_';

const MESSAGE_DISPLAY_LIMIT = 50;

export class Data extends EventEmitter {
    constructor() {
        super();
        this.state = this._getDefaultState();
        this.debounceTimer = null;
        this.DEBOUNCE_DELAY = 100;
    }

    _getDefaultState() {
        return {
            identity: {sk: null, pk: null, profile: null},
            relays: [
                'wss://relay.damus.io', 'wss://nostr.wine', 'wss://nos.lol',
                'wss://relay.snort.social', 'wss://eden.nostr.land', 'wss://purple.plus',
                'wss://atlas.nostr.land', 'wss://relay.nostr.band'
            ],
            thoughts: {
                public: { id: 'public', name: 'Public Feed', type: 'public', unread: 0, lastEventTimestamp: 0 }
            },
            messages: {},
            profiles: {},
            activeThoughtId: 'public',
            fetchingProfiles: new Set(),
        };
    }

    async load() {
        try {
            const results = await Promise.allSettled([
                localforage.getItem(IDENTITY_KEY),
                localforage.getItem(THOUGHTS_KEY),
                localforage.getItem(PROFILES_KEY),
                localforage.getItem(ACTIVE_THOUGHT_ID_KEY),
                localforage.getItem(RELAYS_KEY)
            ]);

            const [identityResult, thoughtsResult, profilesResult, activeThoughtIdResult, relaysResult] = results;

            let identityData = null;
            if (identityResult.status === 'fulfilled') {
                identityData = identityResult.value;
            } else {
                Logger.errorWithContext('DataStore', `Failed to load ${IDENTITY_KEY} from localforage:`, identityResult.reason);
            }

            let thoughtsData = null;
            if (thoughtsResult.status === 'fulfilled') {
                thoughtsData = thoughtsResult.value;
            } else {
                Logger.errorWithContext('DataStore', `Failed to load ${THOUGHTS_KEY} from localforage:`, thoughtsResult.reason);
            }

            let profilesData = null;
            if (profilesResult.status === 'fulfilled') {
                profilesData = profilesResult.value;
            } else {
                Logger.errorWithContext('DataStore', `Failed to load ${PROFILES_KEY} from localforage:`, profilesResult.reason);
            }

            let activeThoughtIdData = null;
            if (activeThoughtIdResult.status === 'fulfilled') {
                activeThoughtIdData = activeThoughtIdResult.value;
            } else {
                Logger.errorWithContext('DataStore', `Failed to load ${ACTIVE_THOUGHT_ID_KEY} from localforage:`, activeThoughtIdResult.reason);
            }

            let relaysData = null;
            if (relaysResult.status === 'fulfilled') {
                relaysData = relaysResult.value;
            } else {
                Logger.errorWithContext('DataStore', `Failed to load ${RELAYS_KEY} from localforage:`, relaysResult.reason);
            }

            if (identityResult.status === 'fulfilled' && identityResult.value?.skHex) {
                try {
                    const skBytes = hexToBytes(identityResult.value.skHex);
                    this.state.identity.sk = skBytes;
                    this.state.identity.pk = getPublicKey(skBytes);
                    Logger.infoWithContext('DataStore', 'Identity loaded and processed successfully.');
                } catch (err) {
                    Logger.errorWithContext('DataStore', 'Corrupted identity data in storage (e.g., invalid hex or key format):', err);
                    this.state.identity = {sk: null, pk: null, profile: null};
                }
            } else {
                this.state.identity = {sk: null, pk: null, profile: null};
            }

            const defaultRelays = this._getDefaultState().relays;
            if (relaysResult.status === 'fulfilled' && Array.isArray(relaysResult.value)) {
                const loadedRelays = relaysResult.value.filter(validateRelayUrl);
                if (loadedRelays.length > 0) {
                    this.state.relays = loadedRelays;
                } else if (relaysResult.value.length > 0) {
                     Logger.warnWithContext('DataStore', 'Loaded relays were all invalid. User may need to reconfigure.');
                     this.state.relays = [];
                } else {
                    this.state.relays = [];
                }
            } else {
                this.state.relays = defaultRelays;
            }

            this.state.thoughts = (thoughtsResult.status === 'fulfilled' && typeof thoughtsResult.value === 'object' && thoughtsResult.value)
                ? thoughtsResult.value
                : this._getDefaultState().thoughts;
            if (thoughtsResult.status === 'rejected') Logger.warnWithContext('DataStore', 'Failed to load thoughts_v3:', thoughtsResult.reason);

            this.state.profiles = (profilesResult.status === 'fulfilled' && typeof profilesResult.value === 'object' && profilesResult.value)
                ? profilesResult.value
                : this._getDefaultState().profiles;
            if (profilesResult.status === 'rejected') Logger.warnWithContext('DataStore', 'Failed to load profiles_v2:', profilesResult.reason);

            this.state.activeThoughtId = (activeThoughtIdResult.status === 'fulfilled' && typeof activeThoughtIdResult.value === 'string')
                ? activeThoughtIdResult.value
                : this._getDefaultState().activeThoughtId;
            if (activeThoughtIdResult.status === 'rejected') Logger.warnWithContext('DataStore', 'Failed to load activeThoughtId_v3:', activeThoughtIdResult.reason);

            if (!this.state.thoughts.public) {
                this.state.thoughts.public = { id: 'public', name: 'Public Feed', type: 'public', unread: 0, lastEventTimestamp: 0 };
            }
            if (this.state.identity.pk && this.state.profiles[this.state.identity.pk]) {
                this.state.identity.profile = this.state.profiles[this.state.identity.pk];
            } else if (this.state.identity.pk) {
                 this.state.identity.profile = null;
            }

            Object.values(this.state.thoughts).forEach(th => th.lastEventTimestamp ||= 0);

            Logger.infoWithContext('DataStore', 'Data loading process completed.');
            this.emitStateUpdated();

        } catch (err) {
            Logger.errorWithContext('DataStore', 'Critical error during DataStore load sequence. Resetting state to defaults and re-throwing.', err);
            this.state = this._getDefaultState();
            this.emitStateUpdated();
            throw new Error(`DataStore load failed critically: ${err.message}. Application state has been reset to defaults.`);
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
            await localforage.setItem(IDENTITY_KEY, {skHex: bytesToHex(sk)});
        } catch (err) {
            Logger.errorWithContext('DataStore', 'Failed to save identity:', err);
            throw err;
        }
    }

    async saveThoughts() {
        try {
            await localforage.setItem(THOUGHTS_KEY, this.state.thoughts);
        } catch (err) {
            Logger.errorWithContext('DataStore', 'Failed to save thoughts:', err);
            throw err;
        }
    }

    async saveProfiles() {
        try {
            await localforage.setItem(PROFILES_KEY, this.state.profiles);
        } catch (err) {
            Logger.errorWithContext('DataStore', 'Failed to save profiles:', err);
            throw err;
        }
    }

    async saveActiveThoughtId() {
        try {
            await localforage.setItem(ACTIVE_THOUGHT_ID_KEY, this.state.activeThoughtId);
        } catch (err) {
            Logger.errorWithContext('DataStore', 'Failed to save activeThoughtId:', err);
            throw err;
        }
    }

    async saveRelays() {
        try {
            await localforage.setItem(RELAYS_KEY, this.state.relays);
        } catch (err) {
            Logger.errorWithContext('DataStore', 'Failed to save relays:', err);
            throw err;
        }
    }

    async saveMessages(tId) {
        if (tId && Array.isArray(this.state.messages[tId])) {
            try {
                await localforage.setItem(`${MESSAGES_KEY_PREFIX}${tId}`, this.state.messages[tId]);
            } catch (err) {
                Logger.errorWithContext('DataStore', `Failed to save messages for ${tId}:`, err);
                throw err;
            }
        }
    }

    addMessage(thoughtId, messageData) {
        if (!this.state.messages[thoughtId]) {
            this.state.messages[thoughtId] = [];
        }

        if (this.state.messages[thoughtId].some(msg => msg.id === messageData.id)) {
            Logger.debugWithContext('DataStore', `Message ${messageData.id} for thought ${thoughtId} already exists, skipping.`);
            return;
        }

        this.state.messages[thoughtId].push(messageData);

        this.state.messages[thoughtId].sort((a, b) => a.created_at - b.created_at);

        if (this.state.messages[thoughtId].length > MESSAGE_DISPLAY_LIMIT) {
            this.state.messages[thoughtId] = this.state.messages[thoughtId].slice(-MESSAGE_DISPLAY_LIMIT);
        }

        this.emit(`messages:${thoughtId}:updated`, this.state.messages[thoughtId]);

        this.emitStateUpdated();
    }

    async addRelay(url) {
        if (!validateRelayUrl(url)) {
            throw new Error('Invalid relay URL format.');
        }
        const currentRelays = this.state.relays || [];
        if (currentRelays.includes(url)) {
            Logger.infoWithContext('DataStore', `Relay ${url} already exists.`);
            return;
        }
        const newRelays = [...currentRelays, url];
        this.setState(s => s.relays = newRelays);
        await this.saveRelays();
    }

    async removeRelay(url) {
        const currentRelays = this.state.relays || [];
        if (!currentRelays.includes(url)) {
            Logger.warnWithContext('DataStore', `Attempted to remove non-existent relay: ${url}`);
            return;
        }
        const newRelays = currentRelays.filter(r => r !== url);
        this.setState(s => s.relays = newRelays);
        await this.saveRelays();
    }

    async updateRelaysList(newRelays) {
        const validRelays = [...new Set(newRelays)].filter(validateRelayUrl);

        if (newRelays.length > 0 && validRelays.length === 0) {
            throw new Error('No valid relays provided. List contains only invalid URLs.');
        }

        this.setState(s => s.relays = validRelays);
        await this.saveRelays();
    }

    async resetApplicationData() {
        Logger.infoWithContext('DataStore', 'Attempting to reset application data from storage.');
        let resetCompletelySuccessful = true;
        try {
            const keys = await localforage.keys();
            const removalPromises = keys
                .filter(key =>
                    key.startsWith(IDENTITY_KEY) ||
                    key.startsWith(THOUGHTS_KEY) ||
                    key.startsWith(PROFILES_KEY) ||
                    key.startsWith(ACTIVE_THOUGHT_ID_KEY) ||
                    key.startsWith(MESSAGES_KEY_PREFIX)
                )
                .map(key =>
                    localforage.removeItem(key).catch(err => {
                        Logger.errorWithContext('DataStore', `Failed to remove item ${key} during reset:`, err);
                        resetCompletelySuccessful = false;
                    })
                );
            await Promise.all(removalPromises);
        } catch (err) {
            Logger.errorWithContext('DataStore', 'Critical error during resetApplicationData (e.g., accessing localforage.keys):', err);
            resetCompletelySuccessful = false;
            throw new Error(`Critical failure during application data reset setup: ${err.message}`);
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
            state.fetchingProfiles = new Set();
        });
        this.emitStateUpdated();

        if (!resetCompletelySuccessful) {
            throw new Error('Failed to completely reset all application data from storage. Some old data might remain.');
        }
        Logger.infoWithContext('DataStore', 'Application data reset successfully completed (both in-memory and relevant storage items).');
    }

    async loadMessages(thoughtId) {
        if (!thoughtId) {
            Logger.warnWithContext('DataStore', 'loadMessages called with no thoughtId');
            return;
        }
        try {
            const messages = await localforage.getItem(`${MESSAGES_KEY_PREFIX}${thoughtId}`);
            this.state.messages[thoughtId] = Array.isArray(messages) ? messages : [];
        } catch (err) {
            Logger.errorWithContext('DataStore', `Failed to load messages for thought ${thoughtId}:`, err);
            this.state.messages[thoughtId] = [];
            this.emit(`messages:${thoughtId}:updated`, this.state.messages[thoughtId]);
            throw err;
        }
        this.emit(`messages:${thoughtId}:updated`, this.state.messages[thoughtId]);
    }
}
