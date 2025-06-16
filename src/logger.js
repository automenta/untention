let DEBUG_MODE = false;

export class Logger {
    static setDebugMode(enabled) {
        DEBUG_MODE = !!enabled;
        if (DEBUG_MODE) {
            console.info('[Logger] Debug mode enabled.');
        } else {
            console.info('[Logger] Debug mode disabled.');
        }
    }

    static isDebugMode() {
        return DEBUG_MODE;
    }

    static log(message, ...args) {
        console.log(message, ...args);
    }

    static info(message, ...args) {
        console.info(message, ...args);
    }

    static warn(message, ...args) {
        console.warn(message, ...args);
    }

    static error(message, ...args) {
        console.error(message, ...args);
    }

    static logWithContext(context, message, ...args) {
        console.log(`[${context}]`, message, ...args);
    }

    static infoWithContext(context, message, ...args) {
        console.info(`[${context}]`, message, ...args);
    }

    static warnWithContext(context, message, ...args) {
        console.warn(`[${context}]`, message, ...args);
    }

    static errorWithContext(context, message, ...args) {
        console.error(`[${context}]`, message, ...args);
    }

    static debug(context, message, ...args) {
        if (DEBUG_MODE) {
            console.log(`[${context}] DEBUG:`, message, ...args);
        }
    }
}
