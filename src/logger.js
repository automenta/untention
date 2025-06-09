export const Logger = {
    log: (...a) => console.log('[N]', ...a),
    warn: (...a) => console.warn('[N]', ...a),
    error: (...a) => console.error('[N]', ...a)
};
