export class BaseModal {
    constructor(title, app) {
        if (!app || !app.ui) {
            throw new Error("BaseModal requires an app instance with a UI controller.");
        }
        this.title = title;
        this.app = app;
        this.ui = app.ui;
    }

    getContent() {
        throw new Error("Method 'getContent()' must be implemented by subclasses.");
    }

    getFooterButtons() {
        throw new Error("Method 'getFooterButtons()' must be implemented by subclasses.");
    }

    onShow() {
    }

    show() {
        this.ui.showModal({
            title: this.title,
            body: this.getContent(),
            buttons: this.getFooterButtons(),
            onMounted: () => this.onShow()
        });
    }

    hide() {
        this.ui.hideModal();
    }
}
