'use client';
import { createContext, useContext } from 'react';
import type { Me } from './types';

export const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx)!;
export const isOwner = (me: Me) => me.role === 'SHOP_OWNER' || me.role === 'PLATFORM_ADMIN';
