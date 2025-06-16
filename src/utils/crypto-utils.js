// Moved from original Utils.bytesToHex
export const bytesToHex = bytes => bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');

// Moved from original Utils.hexToBytes
export const hexToBytes = hex => {
    if (!hex) return new Uint8Array();
    const matched = hex.match(/.{1,2}/g);
    if (!matched) return new Uint8Array();

    const bytes = [];
    for (const byteHex of matched) {
        if (byteHex.length > 2 || !/^[0-9a-fA-F]+$/.test(byteHex)) {
            throw new Error('Invalid hex string');
        }
        const byte = parseInt(byteHex, 16);
        if (isNaN(byte)) {
            throw new Error('Invalid hex string');
        }
        bytes.push(byte);
    }
    return new Uint8Array(bytes);
};

// Moved from original Utils.uint8ArrayToBase64
export const uint8ArrayToBase64 = arr => btoa(String.fromCharCode(...arr));

// Moved from original Utils.base64ToUint8Array
export const base64ToUint8Array = s => new Uint8Array(atob(s).split("").map(c => c.charCodeAt(0)));

// Original Utils.crypto methods, now top-level exports
export const aesEncrypt = async (plainText, keyBase64) => {
    const key = await importKeyFromBase64(keyBase64);
    const iv = crypto.getRandomValues(new Uint8Array(12)); // AES-GCM standard IV size is 12 bytes (96 bits)
    const cipherText = await crypto.subtle.encrypt({name: "AES-GCM", iv: iv}, key, new TextEncoder().encode(plainText));
    return `${uint8ArrayToBase64(iv)}:${uint8ArrayToBase64(new Uint8Array(cipherText))}`;
};

export const aesDecrypt = async (encryptedData, keyBase64) => {
    try {
        const key = await importKeyFromBase64(keyBase64);
        const [ivBase64, cipherTextBase64] = encryptedData.split(':');
        if (!ivBase64 || !cipherTextBase64) throw new Error('Invalid encrypted data format');
        const plainText = await crypto.subtle.decrypt({
            name: "AES-GCM",
            iv: base64ToUint8Array(ivBase64)
        }, key, base64ToUint8Array(cipherTextBase64));
        return new TextDecoder().decode(plainText);
    } catch (err) {
        throw err; // Rethrow to allow caller to handle UI, logging, etc.
    }
};

export const exportKeyAsBase64 = async key => {
    return uint8ArrayToBase64(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
};

export const importKeyFromBase64 = keyBase64 => {
    return crypto.subtle.importKey("raw", base64ToUint8Array(keyBase64), {name: "AES-GCM"}, true, ["encrypt", "decrypt"]);
};
