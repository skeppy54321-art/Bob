/** Which users currently have a live socket connection. */
const online = new Map<string, number>();
export const markOnline = (id: string) => online.set(id, (online.get(id) ?? 0) + 1);
export const markOffline = (id: string) => { const n = (online.get(id) ?? 1) - 1; if (n <= 0) online.delete(id); else online.set(id, n); };
export const isOnline = (id: string) => online.has(id);
