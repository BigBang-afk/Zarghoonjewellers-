"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/**
 * Confirmation messages for completed actions. Lives in the dashboard layout
 * so the message survives the page refresh that follows an action (the record
 * that was acted on often leaves the list).
 */

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const push = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <p key={t.id} role="status" data-testid="toast" className="pointer-events-auto rounded-lg bg-emerald-900 px-4 py-2.5 text-sm text-white shadow-lg ring-1 ring-gold/40">
            {t.message}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
