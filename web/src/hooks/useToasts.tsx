import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type ToastKind = "info" | "success" | "error" | "pending";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  txHash?: string;
}

interface ToastContextValue {
  toasts: Toast[];
  push(toast: Omit<Toast, "id">): number;
  dismiss(id: number): void;
  update(id: number, patch: Partial<Toast>): void;
}

const Ctx = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((toast: Omit<Toast, "id">) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((t) => [...t, { ...toast, id }]);
    if (toast.kind !== "pending") {
      setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
      }, 7000);
    }
    return id;
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const update = useCallback((id: number, patch: Partial<Toast>) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    if (patch.kind && patch.kind !== "pending") {
      setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
      }, 7000);
    }
  }, []);

  const value = useMemo(
    () => ({ toasts, push, dismiss, update }),
    [toasts, push, dismiss, update]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToasts(): ToastContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToasts requires <ToastProvider>");
  return v;
}
