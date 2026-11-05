import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;
export function getSocket() {
  if (!socket) socket = io({ path: "/socket.io", withCredentials: true, transports: ["websocket", "polling"], reconnectionDelay: 1000, reconnectionDelayMax: 5000 });
  return socket;
}
export function closeSocket() {
  socket?.disconnect();
  socket = null;
}
