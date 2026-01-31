import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type CartLine = {
  id: string;
  title: string;
  priceGbp: number;
  imageUrl?: string;
  qty: number;
};

type CartState = {
  lines: CartLine[];
};

type CartApi = {
  state: CartState;
  count: number;
  subtotalGbp: number;
  add: (line: Omit<CartLine, 'qty'>, qty?: number) => void;
  remove: (id: string) => void;
  setQty: (id: string, qty: number) => void;
  clear: () => void;
};

const STORAGE_KEY = 'mvw.cart.v1';

const CartContext = createContext<CartApi | null>(null);

function readInitial(): CartState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { lines: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.lines)) return { lines: [] };
    return { lines: parsed.lines };
  } catch {
    return { lines: [] };
  }
}

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<CartState>(() => readInitial());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  }, [state]);

  const api = useMemo<CartApi>(() => {
    const count = state.lines.reduce((n, l) => n + l.qty, 0);
    const subtotalGbp = state.lines.reduce((n, l) => n + l.qty * l.priceGbp, 0);
    return {
      state,
      count,
      subtotalGbp,
      add: (line, qty = 1) => {
        setState((s) => {
          const existing = s.lines.find((l) => l.id === line.id);
          if (existing) {
            return {
              lines: s.lines.map((l) => (l.id === line.id ? { ...l, qty: l.qty + qty } : l)),
            };
          }
          return { lines: [...s.lines, { ...line, qty }] };
        });
      },
      remove: (id) => setState((s) => ({ lines: s.lines.filter((l) => l.id !== id) })),
      setQty: (id, qty) =>
        setState((s) => ({
          lines: s.lines
            .map((l) => (l.id === id ? { ...l, qty: Math.max(1, Math.floor(qty || 1)) } : l))
            .filter((l) => l.qty > 0),
        })),
      clear: () => setState({ lines: [] }),
    };
  }, [state]);

  return <CartContext.Provider value={api}>{children}</CartContext.Provider>;
};

export function useCart(): CartApi {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
