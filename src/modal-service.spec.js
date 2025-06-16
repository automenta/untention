import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ModalService} from '/modal-service.js';
import {IdentityModal} from '/ui/modals/identity-modal.js';
import {ProfileModal} from '/ui/modals/profile-modal.js';
import {CreateGroupModal} from '/ui/modals/create-group-modal.js';
import {JoinGroupModal} from '/ui/modals/join-group-modal.js';
import {CreateDmModal} from '/ui/modals/create-dm-modal.js';
import {GroupInfoModal} from '/ui/modals/group-info-modal.js';
import {RelaysModal} from '/ui/modals/relays-modal.js';

vi.mock('/ui/modals/identity-modal.js', () => ({ IdentityModal: vi.fn() }));
vi.mock('/ui/modals/profile-modal.js', () => ({ ProfileModal: vi.fn() }));
vi.mock('/ui/modals/create-group-modal.js', () => ({ CreateGroupModal: vi.fn() }));
vi.mock('/ui/modals/join-group-modal.js', () => ({ JoinGroupModal: vi.fn() }));
vi.mock('/ui/modals/create-dm-modal.js', () => ({ CreateDmModal: vi.fn() }));
vi.mock('/ui/modals/group-info-modal.js', () => ({ GroupInfoModal: vi.fn() }));
vi.mock('/ui/modals/relays-modal.js', () => ({ RelaysModal: vi.fn() }));


const mockApp = {
    ui: {
        showModal: vi.fn(),
        hideModal: vi.fn(),
        showToast: vi.fn(),
    },
    dataStore: {
        state: {
            identity: { profile: { name: 'Default Profile' } },
            thoughts: { 'activeGroup123': { id: 'activeGroup123', name: 'Active Group', type: 'group', secretKey: 'key' } },
            activeThoughtId: 'activeGroup123',
            relays: ['wss://default.relay'],
        }
    }
};

describe('ModalService', () => {
    let modalService;
    let mockModalInstanceShowSpy;
    let mockModalInstanceHideSpy;

    beforeEach(() => {
        vi.clearAllMocks();
        modalService = new ModalService(mockApp, mockApp.ui, mockApp.dataStore);

        mockModalInstanceShowSpy = vi.fn();
        mockModalInstanceHideSpy = vi.fn();
        const mockModalImplementation = {
            show: mockModalInstanceShowSpy,
            hide: mockModalInstanceHideSpy,
        };

        IdentityModal.mockImplementation(() => ({ ...mockModalImplementation }));
        ProfileModal.mockImplementation(() => ({ ...mockModalImplementation }));
        CreateGroupModal.mockImplementation(() => ({ ...mockModalImplementation }));
        JoinGroupModal.mockImplementation(() => ({ ...mockModalImplementation }));
        CreateDmModal.mockImplementation(() => ({ ...mockModalImplementation }));
        GroupInfoModal.mockImplementation(() => ({ ...mockModalImplementation }));
        RelaysModal.mockImplementation(() => ({ ...mockModalImplementation }));
    });

    it('constructor should store app, ui, and dataStore', () => {
        expect(modalService.app).toBe(mockApp);
        expect(modalService.ui).toBe(mockApp.ui);
        expect(modalService.dataStore).toBe(mockApp.dataStore);
        expect(modalService.activeModal).toBeNull();
    });

    describe('show()', () => {
        it('should create and show IdentityModal', () => {
            modalService.show('identity');
            expect(IdentityModal).toHaveBeenCalledWith(mockApp);
            expect(mockModalInstanceShowSpy).toHaveBeenCalledTimes(1);
            expect(modalService.activeModal).toBeInstanceOf(IdentityModal);
        });

        it('should create and show ProfileModal with data from store if no data passed', () => {
            modalService.show('profile');
            expect(ProfileModal).toHaveBeenCalledWith(mockApp, mockApp.dataStore.state.identity.profile);
            expect(mockModalInstanceShowSpy).toHaveBeenCalledTimes(1);
        });

        it('should create and show ProfileModal with explicit data', () => {
            const explicitProfileData = { name: 'Explicit User' };
            modalService.show('profile', { profile: explicitProfileData });
            expect(ProfileModal).toHaveBeenCalledWith(mockApp, explicitProfileData);
            expect(mockModalInstanceShowSpy).toHaveBeenCalledTimes(1);
        });

        it('should create and show CreateGroupModal', () => {
            modalService.show('createGroup');
            expect(CreateGroupModal).toHaveBeenCalledWith(mockApp);
            expect(mockModalInstanceShowSpy).toHaveBeenCalledTimes(1);
        });

        it('should create and show JoinGroupModal', () => {
            modalService.show('joinGroup');
            expect(JoinGroupModal).toHaveBeenCalledWith(mockApp);
            expect(mockModalInstanceShowSpy).toHaveBeenCalledTimes(1);
        });

        it('should create and show CreateDmModal', () => {
            modalService.show('createDm');
            expect(CreateDmModal).toHaveBeenCalledWith(mockApp);
            expect(mockModalInstanceShowSpy).toHaveBeenCalledTimes(1);
        });

        it('should create and show GroupInfoModal with data from active thought if no data passed', () => {
            modalService.show('groupInfo');
            expect(GroupInfoModal).toHaveBeenCalledWith(mockApp, mockApp.dataStore.state.thoughts.activeGroup123);
            expect(mockModalInstanceShowSpy).toHaveBeenCalledTimes(1);
        });

        it('should create and show GroupInfoModal with explicit group data', () => {
            const explicitGroupData = { id: 'g1', name: 'Explicit Group' };
            modalService.show('groupInfo', { group: explicitGroupData });
            expect(GroupInfoModal).toHaveBeenCalledWith(mockApp, explicitGroupData);
            expect(mockModalInstanceShowSpy).toHaveBeenCalledTimes(1);
        });

        it('should show error toast if GroupInfoModal called with no data and no active group', () => {
            const originalActiveThoughtId = mockApp.dataStore.state.activeThoughtId;
            mockApp.dataStore.state.activeThoughtId = 'nonexistent';
            modalService.show('groupInfo');
            expect(GroupInfoModal).not.toHaveBeenCalled();
            expect(mockApp.ui.showToast).toHaveBeenCalledWith("Cannot show group info: no group selected or data missing.", "error");
            mockApp.dataStore.state.activeThoughtId = originalActiveThoughtId;
        });


        it('should create and show RelaysModal with data from store if no data passed', () => {
            modalService.show('relays');
            expect(RelaysModal).toHaveBeenCalledWith(mockApp, mockApp.dataStore.state.relays);
            expect(mockModalInstanceShowSpy).toHaveBeenCalledTimes(1);
        });

        it('should create and show RelaysModal with explicit relays data', () => {
            const explicitRelaysData = ['wss://explicit.relay'];
            modalService.show('relays', { relays: explicitRelaysData });
            expect(RelaysModal).toHaveBeenCalledWith(mockApp, explicitRelaysData);
            expect(mockModalInstanceShowSpy).toHaveBeenCalledTimes(1);
        });


        it('should warn for an unknown modal type', () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            modalService.show('unknownModal');
            expect(consoleWarnSpy).toHaveBeenCalledWith('ModalService: Unknown modal type requested: unknownModal');
            expect(mockModalInstanceShowSpy).not.toHaveBeenCalled();
            consoleWarnSpy.mockRestore();
        });

        it('should hide previous active modal before showing a new one', () => {
            modalService.show('identity');
            const firstModalInstance = modalService.activeModal;
            vi.clearAllMocks();

            IdentityModal.mockImplementation(() => ({ show: mockModalInstanceShowSpy, hide: mockModalInstanceHideSpy }));
            ProfileModal.mockImplementation(() => ({ show: mockModalInstanceShowSpy, hide: mockModalInstanceHideSpy }));


            modalService.show('profile');
            expect(mockModalInstanceHideSpy).toHaveBeenCalledTimes(1);
            expect(ProfileModal).toHaveBeenCalledWith(mockApp, mockApp.dataStore.state.identity.profile);
            expect(mockModalInstanceShowSpy).toHaveBeenCalledTimes(1);
            expect(modalService.activeModal).not.toBe(firstModalInstance);
        });
    });

    describe('hide()', () => {
        it('should call hide on activeModal if it exists and set activeModal to null', () => {
            modalService.show('identity');
            expect(modalService.activeModal).not.toBeNull();

            modalService.hide();
            expect(mockModalInstanceHideSpy).toHaveBeenCalledTimes(1);
            expect(modalService.activeModal).toBeNull();
        });

        it('should do nothing if no activeModal exists but call ui.hideModal as fallback', () => {
            modalService.hide();
            expect(mockModalInstanceHideSpy).not.toHaveBeenCalled();
            expect(modalService.activeModal).toBeNull();
            expect(mockApp.ui.hideModal).toHaveBeenCalledTimes(1);
        });
    });
});
