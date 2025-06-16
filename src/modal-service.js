// REMOVE ALL STATIC MODAL IMPORTS AT THE TOP:
// import {IdentityModal} from '/ui/modals/identity-modal.js';
// import {ProfileModal} from '/ui/modals/profile-modal.js';
// import {CreateGroupModal} from '/ui/modals/create-group-modal.js';
// import {JoinGroupModal} from '/ui/modals/join-group-modal.js';
// import {CreateDmModal} from '/ui/modals/create-dm-modal.js';
// import {GroupInfoModal} from '/ui/modals/group-info-modal.js';
// import {RelaysModal} from '/ui/modals/relays-modal.js';
import {Logger} from '@/logger.js'; // Updated import


export class ModalService {
    /**
     * Service responsible for creating and displaying modals using a class-based system.
     * @param {App} app - Instance of the main App class, used for callbacks and actions.
     * @param {UIController} ui - Instance of the UIController for showing/hiding modal shells.
     * @param {Data} dataStore - Instance of the Data store for accessing application state.
     */
    constructor(app, ui, dataStore) {
        this.app = app;
        this.ui = ui;
        this.dataStore = dataStore;
        this.activeModal = null; // To keep track of the currently shown modal instance
    }

    /**
     * Displays a modal based on its registered name by instantiating its class.
     * @param {string} modalName - The name of the modal to show (e.g., 'identity', 'profile').
     * @param {object} [data] - Optional data to pass to the modal constructor (e.g., profile data, group info).
     */
    async show(modalName, data = {}) { // Make this method async
        if (this.activeModal) {
            // Hide any existing modal before showing a new one.
            // This assumes BaseModal.hide() correctly cleans up.
            // Alternatively, ensure this is called only when no modal is active.
            this.activeModal.hide();
            this.activeModal = null;
        }

        let modalInstance;
        let ModalClass; // Declare a variable to hold the dynamically imported class

        try {
            switch (modalName) {
                case 'identity':
                    ModalClass = (await import('@/ui/modals/identity-modal.js')).IdentityModal;
                    break;
                case 'profile':
                    ModalClass = (await import('@/ui/modals/profile-modal.js')).ProfileModal;
                    break;
                case 'createGroup':
                    ModalClass = (await import('@/ui/modals/create-group-modal.js')).CreateGroupModal;
                    break;
                case 'joinGroup':
                    ModalClass = (await import('@/ui/modals/join-group-modal.js')).JoinGroupModal;
                    break;
                case 'createDm':
                    ModalClass = (await import('@/ui/modals/create-dm-modal.js')).CreateDmModal;
                    break;
                case 'groupInfo':
                    ModalClass = (await import('@/ui/modals/group-info-modal.js')).GroupInfoModal;
                    break;
                case 'relays':
                    ModalClass = (await import('@/ui/modals/relays-modal.js')).RelaysModal;
                    break;
                default:
                    Logger.warn(`ModalService: Unknown modal type requested: ${modalName}`);
                    return;
            }

            if (ModalClass) {
                // Instantiate the modal class with appropriate data based on modalName
                if (modalName === 'profile') {
                    const profileData = data.profile || (this.dataStore.state.identity && this.dataStore.state.identity.profile) || {};
                    modalInstance = new ModalClass(this.app, profileData);
                } else if (modalName === 'groupInfo') {
                    let groupDataForModal = data.group; // Attempt to get from provided data first
                    // If not provided directly, or if it's an object without an id (incomplete)
                    if (!groupDataForModal || !groupDataForModal.id) {
                        const activeThought = this.dataStore.state.thoughts[this.dataStore.state.activeThoughtId];
                        if (activeThought && activeThought.type === 'group') {
                            groupDataForModal = activeThought; // Fallback to active thought if it's a group
                        } else {
                            groupDataForModal = null; // Explicitly nullify if no valid data found
                        }
                    }

                    if (groupDataForModal) { // Check if we ended up with valid group data
                        modalInstance = new ModalClass(this.app, groupDataForModal);
                    } else {
                        Logger.error("ModalService: GroupInfo modal called without valid group data or active group.");
                        this.app.ui.showToast("Cannot show group info: no group selected or data missing.", "error");
                        return;
                    }
                } else if (modalName === 'relays') {
                    const relaysList = data.relays || this.dataStore.state.relays || [];
                    modalInstance = new ModalClass(this.app, relaysList);
                } else {
                    modalInstance = new ModalClass(this.app);
                }

                this.activeModal = modalInstance;
                this.activeModal.show(); // Calls BaseModal.show()
            }
        } catch (error) {
            Logger.errorWithContext('ModalService', `Failed to load modal ${modalName}:`, error);
            this.app.ui.showToast(`Failed to open modal: ${error.message || 'An unexpected error occurred.'}`, 'error');
        }
    }

    /**
     * Hides the currently active modal, if one exists.
     */
    hide() {
        if (this.activeModal) {
            this.activeModal.hide(); // This calls BaseModal.hide(), which calls this.ui.hideModal()
            this.activeModal = null;
        } else {
            // Fallback if no activeModal instance is tracked but UIController might have a modal.
            // This can happen if ui.hideModal was called directly elsewhere.
            this.ui.hideModal();
        }
    }
}
