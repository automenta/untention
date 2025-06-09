export class EventEmitter {
    constructor() {
        this.listeners = {};
    }

    on(event, callback) {
        (this.listeners[event] = this.listeners[event] || []).push(callback);
        return () => this.off(event, callback);
    }

    off(event, callback) {
        this.listeners[event] = this.listeners[event]?.filter(cb => cb !== callback);
    }

    emit(event, data) {
        this.listeners[event]?.forEach(cb => cb(data));
    }
}
