let DEBUG_MODE = false; // Module-local debug flag

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

    // Standard logging methods (without explicit context)
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

    // Logging methods with explicit context
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

    // Debug logging method (only logs if DEBUG_MODE is true)
    static debug(context, message, ...args) {
        if (DEBUG_MODE) {
            // console.debug is often filtered by default in browsers, use console.log for more visibility
            // or instruct users to enable verbose/debug levels in their console.
            // Using console.log for wider default visibility:
            console.log(`[${context}] DEBUG:`, message, ...args);
            // Alternatively, to use console.debug:
            // console.debug(`[${context}] DEBUG:`, message, ...args);
        }
    }
}
