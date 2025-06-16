import {Logger} from '@/logger.js';

export class ModalService {
    constructor(app, ui, dataStore) {
        this.app = app;
        this.ui = ui;
        this.dataStore = dataStore;
        this.activeModal = null;
    }

    async show(modalName, data = {}) {
        if (this.activeModal) {
            this.activeModal.hide();
            this.activeModal = null;
        }

        let modalInstance;
        let ModalClass;

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
                if (modalName === 'profile') {
                    const profileData = data.profile || (this.dataStore.state.identity && this.dataStore.state.identity.profile) || {};
                    modalInstance = new ModalClass(this.app, profileData);
                } else if (modalName === 'groupInfo') {
                    let groupDataForModal = data.group;
                    if (!groupDataForModal || !groupDataForModal.id) {
                        const activeThought = this.dataStore.state.thoughts[this.dataStore.state.activeThoughtId];
                        if (activeThought && activeThought.type === 'group') {
                            groupDataForModal = activeThought;
                        } else {
                            groupDataForModal = null;
                        }
                    }

                    if (groupDataForModal) {
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
                this.activeModal.show();
            }
        } catch (error) {
            Logger.errorWithContext('ModalService', `Failed to load modal ${modalName}:`, error);
            this.app.ui.showToast(`Failed to open modal: ${error.message || 'An unexpected error occurred.'}`, 'error');
        }
    }

    hide() {
        if (this.activeModal) {
            this.activeModal.hide();
            this.activeModal = null;
        } else {
            this.ui.hideModal();
        }
    }
}
