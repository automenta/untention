import {Logger} from "@/logger.js";
import {ModalService} from "@/modal-service.js";
import {Nostr} from "@/nostr.js";
import {Data} from '@/store.js';
import {UIController} from '@/ui-controller.js';
import {AppUIInitializer} from '@/app-ui-initializer.js';
import {RelayManagerService} from '@/relay-manager-service.js';
import {IdentityService} from '@/identity-service.js';
import {ThoughtManagerService} from '@/thought-manager-service.js';
import {NostrPublishService} from '@/nostr-publish-service.js';
import {ThoughtCreationService} from '@/thought-creation-service.js';
Logger.setDebugMode(import.meta.env.DEV);

const TEXT_NOTE_KIND = 1;
const ENCRYPTED_DM_KIND = 4;
const PROFILE_KIND = 0;
const GROUP_CHAT_KIND = 41;

const DEFAULT_THOUGHT_ID = 'public';

export class App {
    constructor() {
        this.dataStore = new Data();
        this.ui = new UIController();
        this.nostr = new Nostr(this.dataStore, this.ui);
        this.modalService = new ModalService(this, this.ui, this.dataStore);
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

    async init() {
        this.ui.setLoading(true);
        try {
            const uiInitializer = new AppUIInitializer(this, this.ui);
            uiInitializer.setupDOM();

            this.nostr.on('connection:status', ({status, count}) => {
            const statusMessage = {connecting: "Connecting...", connected: "Connected", disconnected: "Disconnected"}[status];
            if (this.statusBar) {
                this.statusBar.setContent(`<div class="relay-status-icon ${status}"></div><span>${count} Relays</span><span style="margin-left: auto;">${statusMessage}</span>`);
            }
        });

        this.dataStore.on('state:updated', ({identity}) => {
            if (this.currentPk !== undefined && this.currentPk !== identity.pk) {
                this.currentPk = identity.pk;
                this.nostr.connect();
            }
        });

        await this.dataStore.load();
        if (!this.dataStore.state.identity.sk) {
            this.modalService.show('identity');
        }
            this.currentPk = this.dataStore.state.identity.pk;
            this.nostr.connect();
            await this.nostr.fetchHistoricalMessages(this.dataStore.state.thoughts[this.dataStore.state.activeThoughtId]);
        } catch (e) {
            Logger.errorWithContext('App', 'Initialization failed:', e);
            this.ui.showToast(`Initialization failed: ${e.message || 'An unexpected error occurred during app initialization.'}`, 'error');
        } finally {
            this.ui.setLoading(false);
        }
    }

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
            'update-note-content': (data) => this.thoughtManagerService.updateNoteContent(data.id, data.field, data.value),
        };
        if (actions[action]) actions[action](data);
    }
}

document.addEventListener('DOMContentLoaded', () => new App());
