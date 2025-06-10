import { MainView, IdentityPanel, ThoughtList, MessageListView, NoThoughtSelectedView, NoteEditorView } from './components.js';
import { Component } from './ui.js';

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

        this.app.statusBar = document.createElement('div');
        this.app.statusBar.id = 'status-bar';
        this.app.shell.appendChild(this.app.statusBar);

        // Instantiate child views for MainView
        const noThoughtSelectedView = new NoThoughtSelectedView(); // Assuming no args or app if not needed for constructor
        const noteEditorView = new NoteEditorView(this.app, this.app.dataStore);
        const messageListView = new MessageListView(this.app, this.app.dataStore);

        // Pass app instance and injected views to MainView
        this.app.mainView = new MainView(this.app, {
            noThoughtSelectedView,
            noteEditorView,
            messageListView
        });
        this.app.shell.appendChild(this.app.mainView.render()); // Assuming render() returns the element

        const identityPanel = new IdentityPanel(this.app);
        this.app.sidebar.appendChild(identityPanel.render());

        const thoughtList = new ThoughtList(this.app);
        this.app.sidebar.appendChild(thoughtList.render());

        this.uiController.statusBar = this.app.statusBar;
    }
}
