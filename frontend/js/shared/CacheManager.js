/**
 * CacheManager.js — IndexedDB tabanlı istemci tarafı önbellek.
 */

const DB_NAME = 'AeroPathDB';
const STORE_NAME = 'predictions';
const KEY_PREFIX = 'aeropath_v1_';

export class CacheManager {
    constructor() { this._db = null; }

    async _open() {
        if (this._db) return this._db;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME))
                    db.createObjectStore(STORE_NAME);
            };
            req.onsuccess = () => { this._db = req.result; resolve(this._db); };
            req.onerror = () => reject(req.error);
        });
    }

    async save(name, data) {
        try {
            const db = await this._open();
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(data, KEY_PREFIX + name);
        } catch (e) { console.warn('Cache yazma hatası:', e); }
    }

    async load(name) {
        try {
            const db = await this._open();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const req = tx.objectStore(STORE_NAME).get(KEY_PREFIX + name);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });
        } catch { return null; }
    }
}
