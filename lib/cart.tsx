import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchItem } from './api';
import { cartTotalPence, reconcileCart, restoreCart, type CartLine } from './cart-pricing';
export type { CartLine } from './cart-pricing';

type CartState = { lines: CartLine[] };
type CartApi = {
  state: CartState;
  count: number;
  totalPence: number | null;
  add: (line: CartLine) => void;
  remove: (id: string) => void;
  setQty: (id: string, qty: number) => void;
  refreshPrices: () => Promise<{ lines: CartLine[]; changed: boolean; ready: boolean }>;
  clear: () => void;
};
const STORAGE_KEY = 'mvw.cart.v2';
const CartContext = createContext<CartApi | null>(null);

function readInitial(): CartState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('mvw.cart.v1');
    return { lines: raw ? restoreCart(JSON.parse(raw)) : [] };
  } catch { return { lines: [] }; }
}

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<CartState>(() => readInitial());
  const stateRef = useRef(state);
  stateRef.current = state;
  const refreshRef = useRef<Promise<{ lines: CartLine[]; changed: boolean; ready: boolean }> | null>(null);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { /* A server-side checkout remains blocked if its retry key cannot persist. */ }
  }, [state]);

  const updateState = (change: (previous: CartState) => CartState) => {
    const next = change(stateRef.current);
    stateRef.current = next;
    setState(next);
  };

  const refreshPrices = async () => {
    if (refreshRef.current) return refreshRef.current;
    const refresh = (async () => {
      const observations = new Map<string, any | null>();
      await Promise.all(stateRef.current.lines.map(async line => {
        try { observations.set(line.id, await fetchItem(line.id)); }
        catch { observations.set(line.id, null); }
      }));
      const result = reconcileCart(stateRef.current.lines, observations);
      const next = { lines: result.lines };
      stateRef.current = next;
      setState(next);
      return result;
    })();
    refreshRef.current = refresh;
    try { return await refresh; }
    finally { refreshRef.current = null; }
  };

  const api = useMemo<CartApi>(() => ({
    state, count: state.lines.length, totalPence: cartTotalPence(state.lines),
    add: line => updateState(previous => ({ lines: previous.lines.some(value => value.id === line.id)
      ? previous.lines.map(value => value.id === line.id ? { ...line, qty: 1 } : value)
      : [...previous.lines, { ...line, qty: 1 }] })),
    remove: id => updateState(previous => ({ lines: previous.lines.filter(line => line.id !== id) })),
    setQty: id => updateState(previous => ({ lines: previous.lines.map(line => line.id === id ? { ...line, qty: 1 } : line) })),
    refreshPrices,
    clear: () => updateState(() => ({ lines: [] })),
  }), [state]);
  return <CartContext.Provider value={api}>{children}</CartContext.Provider>;
};

export function useCart(): CartApi {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
