// Import specific modal classes
import {IdentityModal} from '/ui/modals/identity-modal.js';
import {ProfileModal} from '/ui/modals/profile-modal.js';
import {CreateGroupModal} from '/ui/modals/create-group-modal.js';
import {JoinGroupModal} from '/ui/modals/join-group-modal.js';
import {CreateDmModal} from '/ui/modals/create-dm-modal.js';
import {GroupInfoModal} from '/ui/modals/group-info-modal.js';
import {RelaysModal} from '/ui/modals/relays-modal.js';
import {Logger} from '/logger.js'; // Adjusted path


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
    show(modalName, data = {}) {
        if (this.activeModal) {
            // Hide any existing modal before showing a new one.
            // This assumes BaseModal.hide() correctly cleans up.
            // Alternatively, ensure this is called only when no modal is active.
            this.activeModal.hide();
            this.activeModal = null;
        }

        let modalInstance;

        switch (modalName) {
            case 'identity':
                modalInstance = new IdentityModal(this.app);
                break;
            case 'profile':
                // ProfileModal expects current profile data, pass from dataStore or provided data
                const profileData = data.profile || (this.dataStore.state.identity && this.dataStore.state.identity.profile) || {};
                modalInstance = new ProfileModal(this.app, profileData);
                break;
            case 'createGroup':
                modalInstance = new CreateGroupModal(this.app);
                break;
            case 'joinGroup':
                modalInstance = new JoinGroupModal(this.app);
                break;
            case 'createDm':
                modalInstance = new CreateDmModal(this.app);
                break;
            case 'groupInfo':
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
                    modalInstance = new GroupInfoModal(this.app, groupDataForModal);
                } else {
                    Logger.error("ModalService: GroupInfo modal called without valid group data or active group.");
                    this.app.ui.showToast("Cannot show group info: no group selected or data missing.", "error");
                    return;
                }
                break;
            case 'relays':
                // RelaysModal expects the current list of relays
                const relaysList = data.relays || this.dataStore.state.relays || [];
                modalInstance = new RelaysModal(this.app, relaysList);
                break;
            default:
                Logger.warn(`ModalService: Unknown modal type requested: ${modalName}`);
                return;
        }

        if (modalInstance) {
            this.activeModal = modalInstance;
            this.activeModal.show(); // Calls BaseModal.show()
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
