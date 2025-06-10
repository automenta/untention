// Moved from original Utils.escapeHtml
export const escapeHtml = text => {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text?.replace(/[&<>"']/g, char => map[char]) ?? '';
};

// Moved from original Utils.getUserColor
export const getUserColor = p => {
    const c = ['#4dabf7', '#20c997', '#f06595', '#cc5de8', '#5c7cfa', '#fcc419', '#ff8787', '#74b816'];
    return c[p ? Array.from(p).reduce((acc, char) => acc + char.charCodeAt(0), 0) % c.length : 0];
};

// Moved from original Utils.createAvatarSvg
// Note: This function depends on getUserColor and escapeHtml, which are now in this file.
// If they were in different files, we'd need to import them.
export const createAvatarSvg = (text, seed) => {
    const initial = (text?.charAt(0) || '?').toUpperCase();
    const color = getUserColor(seed); // Assumes getUserColor is in the same module or imported
    // Assumes escapeHtml is in the same module or imported
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${escapeHtml(color)}"/><text x="50%" y="50%" font-size="50" dominant-baseline="central" text-anchor="middle" fill="white" font-family="system-ui, sans-serif">${escapeHtml(initial)}</text></svg>`)}`;
};
