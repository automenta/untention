export const now = () => Math.floor(Date.now() / 1000);

export const formatTime = t => new Date(t * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
