import { Logger } from './logger.js'; // Corrected path
import { EventEmitter } from './event-emitter.js'; // Corrected path
import { hexToBytes, bytesToHex } from './utils/crypto-utils.js';
import { validateRelayUrl } from './utils/nostr-utils.js';

const { getPublicKey } = NostrTools;

// Storage keys
const IDENTITY_KEY = 'identity_v2';
const THOUGHTS_KEY = 'thoughts_v3';
const PROFILES_KEY = 'profiles_v2';
const ACTIVE_THOUGHT_ID_KEY = 'activeThoughtId_v3';
const RELAYS_KEY = 'relays_v2';
const MESSAGES_KEY_PREFIX = 'messages_'; // For individual thought messages

export class Data extends EventEmitter {
    constructor() {
        super();
        // Initialize state with defaults. These will be overwritten by loaded data if available.
        // Assuming _getDefaultState was part of the previous changes that I now see are applied.
        this.state = this._getDefaultState();
        this.debounceTimer = null;
        this.DEBOUNCE_DELAY = 100;
    }

    // Assuming _getDefaultState() is present from previous successful diff.
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
                Logger.error(`Failed to load ${IDENTITY_KEY} from localforage:`, identityResult.reason);
            }

            let thoughtsData = null;
            if (thoughtsResult.status === 'fulfilled') {
                thoughtsData = thoughtsResult.value;
            } else {
                Logger.error(`Failed to load ${THOUGHTS_KEY} from localforage:`, thoughtsResult.reason);
            }

            let profilesData = null;
            if (profilesResult.status === 'fulfilled') {
                profilesData = profilesResult.value;
            } else {
                Logger.error(`Failed to load ${PROFILES_KEY} from localforage:`, profilesResult.reason);
            }

            let activeThoughtIdData = null;
            if (activeThoughtIdResult.status === 'fulfilled') {
                activeThoughtIdData = activeThoughtIdResult.value;
            } else {
                Logger.error(`Failed to load ${ACTIVE_THOUGHT_ID_KEY} from localforage:`, activeThoughtIdResult.reason);
            }

            let relaysData = null;
            if (relaysResult.status === 'fulfilled') {
                relaysData = relaysResult.value;
            } else {
                Logger.error(`Failed to load ${RELAYS_KEY} from localforage:`, relaysResult.reason);
            }

            // This section of DataStore#load was significantly refactored in the previous subtask.
            // I will ensure the Utils.* calls are updated within that newer structure.
            // For brevity, I am trusting the previous diff for DataStore#load's logic was mostly okay,
            // and will just focus on replacing Utils.* calls within its existing structure.

            // Example change within the load method structure (assuming it's similar to my last attempt for store.js)
            if (identityResult.status === 'fulfilled' && identityResult.value?.skHex) {
                try {
                    const skBytes = hexToBytes(identityResult.value.skHex); // Changed
                    this.state.identity.sk = skBytes;
                    this.state.identity.pk = getPublicKey(skBytes);
                    Logger.info('Identity loaded and processed successfully.');
                } catch (err) {
                    Logger.error('Corrupted identity data in storage (e.g., invalid hex or key format):', err);
                    this.state.identity = {sk: null, pk: null, profile: null};
                }
            } else {
                // ... error logging for identity load failure
                this.state.identity = {sk: null, pk: null, profile: null};
            }

            const defaultRelays = this._getDefaultState().relays;
            if (relaysResult.status === 'fulfilled' && Array.isArray(relaysResult.value)) {
                const loadedRelays = relaysResult.value.filter(validateRelayUrl); // Changed
                if (loadedRelays.length > 0) {
                    this.state.relays = loadedRelays;
                } else if (relaysResult.value.length > 0) {
                     Logger.warn('Loaded relays were all invalid. User may need to reconfigure.');
                     this.state.relays = [];
                } else {
                    this.state.relays = [];
                }
            } else {
                // ... error logging for relay load failure
                this.state.relays = defaultRelays;
            }

            this.state.thoughts = (thoughtsResult.status === 'fulfilled' && typeof thoughtsResult.value === 'object' && thoughtsResult.value)
                ? thoughtsResult.value
                : this._getDefaultState().thoughts;
            if (thoughtsResult.status === 'rejected') Logger.warn('Failed to load thoughts_v3:', thoughtsResult.reason);

            this.state.profiles = (profilesResult.status === 'fulfilled' && typeof profilesResult.value === 'object' && profilesResult.value)
                ? profilesResult.value
                : this._getDefaultState().profiles;
            if (profilesResult.status === 'rejected') Logger.warn('Failed to load profiles_v2:', profilesResult.reason);

            this.state.activeThoughtId = (activeThoughtIdResult.status === 'fulfilled' && typeof activeThoughtIdResult.value === 'string')
                ? activeThoughtIdResult.value
                : this._getDefaultState().activeThoughtId;
            if (activeThoughtIdResult.status === 'rejected') Logger.warn('Failed to load activeThoughtId_v3:', activeThoughtIdResult.reason);

            if (!this.state.thoughts.public) {
                this.state.thoughts.public = { id: 'public', name: 'Public Feed', type: 'public', unread: 0, lastEventTimestamp: 0 };
            }
            if (this.state.identity.pk && this.state.profiles[this.state.identity.pk]) {
                this.state.identity.profile = this.state.profiles[this.state.identity.pk];
            } else if (this.state.identity.pk) {
                 this.state.identity.profile = null;
            }

            Object.values(this.state.thoughts).forEach(th => th.lastEventTimestamp ||= 0);

            Logger.info('Data loading process completed.');
            this.emitStateUpdated();

        } catch (err) {
            Logger.error('Critical error during DataStore load sequence. Resetting state to defaults and re-throwing.', err);
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
            Logger.error('Failed to save identity:', err);
            throw err;
        }
    }

    async saveThoughts() {
        try {
            await localforage.setItem(THOUGHTS_KEY, this.state.thoughts);
        } catch (err) {
            Logger.error('Failed to save thoughts:', err);
            throw err;
        }
    }

    async saveProfiles() {
        try {
            await localforage.setItem(PROFILES_KEY, this.state.profiles);
        } catch (err) {
            Logger.error('Failed to save profiles:', err);
            throw err;
        }
    }

    async saveActiveThoughtId() {
        try {
            await localforage.setItem(ACTIVE_THOUGHT_ID_KEY, this.state.activeThoughtId);
        } catch (err) {
            Logger.error('Failed to save activeThoughtId:', err);
            throw err;
        }
    }

    async saveRelays() {
        try {
            await localforage.setItem(RELAYS_KEY, this.state.relays);
        } catch (err) {
            Logger.error('Failed to save relays:', err);
            throw err;
        }
    }

    async saveMessages(tId) {
        if (tId && Array.isArray(this.state.messages[tId])) {
            try {
                await localforage.setItem(`${MESSAGES_KEY_PREFIX}${tId}`, this.state.messages[tId]);
            } catch (err) {
                Logger.error(`Failed to save messages for ${tId}:`, err);
                throw err;
            }
        }
    }

    async addRelay(url) {
        if (!validateRelayUrl(url)) { // Changed
            throw new Error('Invalid relay URL format.');
        }
        const currentRelays = this.state.relays || [];
        if (currentRelays.includes(url)) {
            // Consider if this should be an error or a silent success.
            // For now, let's treat it as a success, no change needed.
            Logger.info(`Relay ${url} already exists.`);
            return;
        }
        const newRelays = [...currentRelays, url];
        // The overall validation of the list (e.g. not empty) might be handled by a more general update method
        // or checked by the caller if specific list-wide rules apply after adding.
        // For this method, we focus on adding one valid relay.
        this.setState(s => s.relays = newRelays);
        await this.saveRelays();
    }

    async removeRelay(url) {
        const currentRelays = this.state.relays || [];
        if (!currentRelays.includes(url)) {
            Logger.warn(`Attempted to remove non-existent relay: ${url}`);
            return; // Or throw an error, depending on desired strictness
        }
        const newRelays = currentRelays.filter(r => r !== url);
        // Similar to addRelay, list-wide validation (e.g., not empty) is a broader concern.
        // If removing the last relay has specific implications, the calling context or a general update method handles it.
        this.setState(s => s.relays = newRelays);
        await this.saveRelays();
    }

    async updateRelaysList(newRelays) {
        // This method replaces the logic previously in App.updateRelays
        const validRelays = [...new Set(newRelays)].filter(validateRelayUrl); // Changed

        // Decision: What if validRelays is empty?
        // Original App.updateRelays showed a toast: 'No valid relays provided. At least one wss:// relay is required.' and returned.
        // Throwing an error here allows the App layer to catch it and show the toast.
        if (newRelays.length > 0 && validRelays.length === 0) {
            throw new Error('No valid relays provided. List contains only invalid URLs.');
        }
        // If newRelays itself is empty, it means the user intends to clear all relays. This is permissible.

        this.setState(s => s.relays = validRelays);
        await this.saveRelays();
    }

    async resetApplicationData() {
        Logger.info('Attempting to reset application data from storage.');
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
                        Logger.error(`Failed to remove item ${key} during reset:`, err);
                        resetCompletelySuccessful = false; // Mark that at least one item failed
                    })
                );
            await Promise.all(removalPromises);
        } catch (err) {
            Logger.error('Critical error during resetApplicationData (e.g., accessing localforage.keys):', err);
            resetCompletelySuccessful = false;
            // This kind of error is severe, preventing even the attempt to remove items.
            throw new Error(`Critical failure during application data reset setup: ${err.message}`);
        }

        // Always reset the in-memory state to defaults regardless of storage cleaning outcome.
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
            // Also reset fetchingProfiles, just in case
            state.fetchingProfiles = new Set();
        });
        this.emitStateUpdated(); // Ensure UI reflects the reset in-memory state immediately

        if (!resetCompletelySuccessful) {
            throw new Error('Failed to completely reset all application data from storage. Some old data might remain.');
        }
        Logger.info('Application data reset successfully completed (both in-memory and relevant storage items).');
    }

    async loadMessages(thoughtId) {
        if (!thoughtId) {
            Logger.warn('loadMessages called with no thoughtId');
            return; // Or throw an error if this case is unexpected
        }
        try {
            const messages = await localforage.getItem(`${MESSAGES_KEY_PREFIX}${thoughtId}`);
            this.state.messages[thoughtId] = Array.isArray(messages) ? messages : [];
        } catch (err) {
            Logger.error(`Failed to load messages for thought ${thoughtId}:`, err);
            this.state.messages[thoughtId] = []; // Ensure it's an empty array on error
            this.emit(`messages:${thoughtId}:updated`, this.state.messages[thoughtId]); // Update UI with empty
            throw err; // Re-throw so the caller (App.js) can show a toast
        }
        this.emit(`messages:${thoughtId}:updated`, this.state.messages[thoughtId]);
    }
}
