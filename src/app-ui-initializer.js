import { MainView, IdentityPanel, ThoughtList } from './components.js';
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

        // Pass app instance to components that need it for handleAction
        this.app.mainView = new MainView(this.app);
        this.app.shell.appendChild(this.app.mainView.render());

        const identityPanel = new IdentityPanel(this.app);
        this.app.sidebar.appendChild(identityPanel.render());

        const thoughtList = new ThoughtList(this.app);
        this.app.sidebar.appendChild(thoughtList.render());

        this.uiController.statusBar = this.app.statusBar;
    }
}
