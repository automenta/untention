import {
    IdentityPanel,
    MainView,
    MessageListView,
    NoteEditorView,
    NoThoughtSelectedView,
    ThoughtList
} from '@/components.js';

export class AppUIInitializer {
    constructor(app, uiController) {
        this.app = app;
        this.uiController = uiController;
    }

    setupDOM() {
        this.app.shell = document.createElement('div');
        this.app.shell.id = 'shell';
        document.body.appendChild(this.app.shell);

        this.app.sidebar = document.createElement('div');
        this.app.sidebar.id = 'sidebar';
        this.app.shell.appendChild(this.app.sidebar);

        const statusBarElement = document.createElement('div');
        statusBarElement.id = 'status-bar';
        this.app.sidebar.appendChild(statusBarElement);
        this.uiController.setStatusBarElement(statusBarElement); // Pass the element to UIController

        const noThoughtSelectedView = new NoThoughtSelectedView();
        const noteEditorView = new NoteEditorView(this.app, this.app.dataStore);
        const messageListView = new MessageListView(this.app, this.app.dataStore);

        this.app.mainView = new MainView(this.app, {
            noThoughtSelectedView,
            noteEditorView,
            messageListView
        });
        this.app.mainView.mount(this.app.shell);

        const identityPanel = new IdentityPanel(this.app);
        identityPanel.mount(this.app.sidebar);

        const thoughtList = new ThoughtList(this.app);
        thoughtList.mount(this.app.sidebar);
    }
}
