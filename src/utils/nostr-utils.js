export const shortenPubkey = p => p ? `${p.slice(0, 8)}...${p.slice(-4)}` : '?';

export const findTag = (e, k) => e?.tags?.find(t => t[0] === k)?.[1];

export const validateRelayUrl = url => {
    try {
        const u = new URL(url);
        return u.protocol === 'wss:' && !!u.hostname;
    } catch {
        return false;
    }
};
