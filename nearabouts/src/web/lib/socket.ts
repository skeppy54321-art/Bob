/** Single shared Socket.IO connection (authenticated by the session cookie). */
import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;
export function getSocket(): Socket {
  if (!socket) {
    socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'], reconnectionDelay: 800, reconnectionDelayMax: 4000 });
  }
  return socket;
}
export function resetSocket() {
  socket?.disconnect();
  socket = null;
}

export interface Ack { ok: boolean; error?: string; code?: string; [k: string]: any }
/** Emit with acknowledgement; rejects with the server's message. */
export function emit(event: string, data: unknown = {}, timeoutMs = 8000): Promise<Ack> {
  const s = getSocket();
  return new Promise((resolve, reject) => {
    s.timeout(timeoutMs).emit(event, data, (err: Error | null, res: Ack) => {
      if (err) return reject(new Error('The server did not respond. Check your connection.'));
      if (!res?.ok) return reject(Object.assign(new Error(res?.error ?? 'Request failed.'), { code: res?.code }));
      resolve(res);
    });
  });
}
