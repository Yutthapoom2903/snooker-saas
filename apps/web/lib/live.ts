'use client';
import { useEffect, useReducer, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { getActingShop } from './api';

type Kind = 'tables' | 'bookings' | 'devices' | 'score' | 'line';
let socket: Socket | null = null;
let socketShop: string | null = null;

function getSocket() {
  // The room is chosen at handshake, so a platform admin switching shops needs a new socket.
  if (socket && socketShop === getActingShop()) return socket;
  socket?.disconnect();
  socketShop = getActingShop();
  // Socket.IO goes straight to the API port (Next rewrites don't carry websockets in dev).
  const url = process.env.NEXT_PUBLIC_WS_URL ?? `${location.protocol}//${location.hostname}:3001`;
  socket = io(url, { withCredentials: true, query: { shopId: getActingShop() ?? '' }, transports: ['websocket'] });
  return socket;
}

/** Call `onChange` when the server says one of `kinds` changed. Falls back to polling. */
export function useLive(kinds: Kind[], onChange: (kind: Kind, data?: unknown) => void, pollMs = 20000) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const key = kinds.join(',');
  useEffect(() => {
    const s = getSocket();
    const handler = (msg: { kind: Kind; data?: unknown }) => {
      if (key.split(',').includes(msg.kind)) cb.current(msg.kind, msg.data);
    };
    s.on('changed', handler);
    const t = setInterval(() => cb.current(key.split(',')[0] as Kind), pollMs);
    return () => {
      s.off('changed', handler);
      clearInterval(t);
    };
  }, [key, pollMs]);
}

/** Re-render every `ms` (for running timers). */
export function useTick(ms = 1000) {
  const [, force] = useReducerTick();
  useEffect(() => {
    const t = setInterval(force, ms);
    return () => clearInterval(t);
  }, [ms, force]);
}

function useReducerTick() {
  return useReducer((x: number) => x + 1, 0);
}
