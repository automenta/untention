// Moved from original Utils.shortenPubkey
export const shortenPubkey = p => p ? `${p.slice(0, 8)}...${p.slice(-4)}` : '?';

// Moved from original Utils.findTag
export const findTag = (e, k) => e?.tags?.find(t => t[0] === k)?.[1];

// Moved from original Utils.validateRelayUrl
export const validateRelayUrl = url => {
    try {
        const u = new URL(url);
        return u.protocol === 'wss:' && !!u.hostname; // Ensure hostname is not empty
    } catch {
        return false;
    }
};
