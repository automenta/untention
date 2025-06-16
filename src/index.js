import {Logger} from "@/logger.js"; // Updated import
// Specific crypto utils used in this file:
// Specific time utils used in this file:
// Specific nostr utils used in this file:
// Other utils like validateRelayUrl, findTag, ui-utils are not directly used in App class methods here,
// but might be used in other modules that App interacts with.
import {ModalService} from "@/modal-service.js"; // Updated import
import {Nostr} from "@/nostr.js"; // Updated import
import {Data} from '@/store.js'; // Updated import
import {UIController} from '@/ui-controller.js'; // Updated import
import {AppUIInitializer} from '@/app-ui-initializer.js'; // Updated import
import {RelayManagerService} from '@/relay-manager-service.js'; // Updated import
import {IdentityService} from '@/identity-service.js'; // Updated import
import {ThoughtManagerService} from '@/thought-manager-service.js'; // Updated import
import {NostrPublishService} from '@/nostr-publish-service.js'; // Updated import
import {ThoughtCreationService} from '@/thought-creation-service.js'; // Updated import
// Initialize Logger Debug Mode (e.g., based on localStorage or a build flag)
// To enable debug mode via console: Logger.setDebugMode(true)
// Or: Logger.setDebugMode(localStorage.getItem('APP_DEBUG_MODE') === 'true');
Logger.setDebugMode(import.meta.env.DEV);

// NostrTools is loaded globally via script tag in index.html, so no destructuring needed here.
// const {generateSecretKey, nip19, nip04 } = NostrTools; // Removed redundant destructuring

// Define Nostr event kinds as constants for clarity and maintainability
const TEXT_NOTE_KIND = 1;
const ENCRYPTED_DM_KIND = 4;
const PROFILE_KIND = 0;
const GROUP_CHAT_KIND = 41; // Custom kind for encrypted group chat

const DEFAULT_THOUGHT_ID = 'public'; // Default thought to select

export class App {
    constructor() {
        this.dataStore = new Data();
        this.ui = new UIController();
        this.nostr = new Nostr(this.dataStore, this.ui);
        this.modalService = new ModalService(this, this.ui, this.dataStore); // Instantiate ModalService
        this.relayManagerService = new RelayManagerService(this.dataStore, this.nostr, this.ui);
        this.identityService = new IdentityService(this.dataStore, this.ui, this);
        this.thoughtManagerService = new ThoughtManagerService(this.dataStore, this.ui, this.nostr, this);
        this.nostrPublishService = new NostrPublishService(this.dataStore, this.nostr, this.ui);
        this.thoughtCreationService = new ThoughtCreationService(this.dataStore, this.ui, this.nostr, this);
        this.init();
        window.addEventListener('unhandledrejection', e => {
            Logger.errorWithContext('App', 'Unhandled promise rejection:', e.reason);
            this.ui.showToast(`Error: ${e.reason.message || 'Unknown error'}`, 'error');
        });

    }

    /**
     * Initializes the application.
     * Sets up the main UI components, registers event listeners,
     * loads initial data, and connects to Nostr relays.
     */
    async init() {
        this.ui.setLoading(true);
        try {
            // Setup main application shell and layout
            const uiInitializer = new AppUIInitializer(this, this.ui);
            uiInitializer.setupDOM();

            // Listen for Nostr connection status changes to update the UI
            this.nostr.on('connection:status', ({status, count}) => {
            const statusMessage = {connecting: "Connecting...", connected: "Connected", disconnected: "Disconnected"}[status];
            // Ensure statusBar is accessible, e.g., this.statusBar if set by AppUIInitializer
            if (this.statusBar) {
                this.statusBar.setContent(`<div class="relay-status-icon ${status}"></div><span>${count} Relays</span><span style="margin-left: auto;">${statusMessage}</span>`);
            }
        });

        // Listen for changes in the data store, particularly identity changes, to trigger Nostr reconnections
        this.dataStore.on('state:updated', ({identity}) => {
            // If the public key has changed, update currentPk and reconnect to Nostr
            if (this.currentPk !== undefined && this.currentPk !== identity.pk) {
                this.currentPk = identity.pk;
                this.nostr.connect(); // Reconnect with the new identity
            }
        });

        // Load existing data from storage
        await this.dataStore.load();
        // If no secret key is found, prompt the user to manage their identity (load or generate one)
        if (!this.dataStore.state.identity.sk) {
            this.modalService.show('identity'); // Use ModalService
        }
            this.currentPk = this.dataStore.state.identity.pk; // Set current public key
            this.nostr.connect(); // Initial connection to Nostr relays
            // Fetch historical messages for the currently active thought (e.g., 'public' or last selected)
            await this.nostr.fetchHistoricalMessages(this.dataStore.state.thoughts[this.dataStore.state.activeThoughtId]);
        } catch (e) {
            Logger.errorWithContext('App', 'Initialization failed:', e);
            this.ui.showToast(`Initialization failed: ${e.message || 'An unexpected error occurred during app initialization.'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }

    /**
     * Centralized handler for dispatching actions triggered by UI components or other parts of the application.
     * @param {string} action - The name of the action to perform.
     * @param {any} data - Optional data associated with the action.
     */
    handleAction(action, data) {
        const actions = {
            'manage-identity': () => this.dataStore.state.identity.sk ? this.identityService.logout() : this.modalService.show('identity'),
            'show-modal': (modal) => this.modalService.show(modal),
            'select-thought': (id) => this.thoughtManagerService.selectThought(id),
            'leave-thought': () => this.thoughtManagerService.leaveThought(),
            'send-message': (content) => this.nostrPublishService.sendMessage(content),
            'update-profile': (formData) => this.nostrPublishService.updateProfile(formData),
            'create-dm': (formData) => this.thoughtCreationService.createDmThought(formData.get('pubkey')),
            'create-group': (formData) => this.thoughtCreationService.createGroupThought(formData.get('name')),
            'join-group': (formData) => this.thoughtCreationService.joinGroupThought(formData.get('id'), formData.get('key'), formData.get('name')),
            'add-relay': (formData) => this.relayManagerService.addRelay(formData.get('url')),
            'remove-relay': (url) => this.relayManagerService.removeRelay(url),
            'create-note': () => this.thoughtCreationService.createNoteThought(),
        };
        if (actions[action]) actions[action](data);
    }

    // The following methods (leaveThought, createDmThought, createGroupThought, joinGroupThought, createNoteThought, updateRelaysList)
    // have been moved to their respective service classes (ThoughtManagerService, ThoughtCreationService, RelayManagerService).
    // They are now called via `this.thoughtManagerService.leaveThought()`, etc., from `handleAction`.
    // Therefore, they are removed from the App class to avoid duplication.
}

document.addEventListener('DOMContentLoaded', () => new App());
