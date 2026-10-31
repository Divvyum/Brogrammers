import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Toast } from "@hackos/ui";

type ToastItem = { id: number; message: string; tone: "info" | "error" | "success" };
type ToastApi = { show: (message: string, tone?: ToastItem["tone"]) => void };
const ToastContext = createContext<ToastApi>({ show: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback((message: string, tone: ToastItem["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 5000);
  }, []);
  return <ToastContext.Provider value={{ show }}>{children}<div className="toast-stack">{items.map((item) => <Toast key={item.id} message={item.message} tone={item.tone} onDismiss={() => setItems((current) => current.filter((x) => x.id !== item.id))} />)}</div></ToastContext.Provider>;
}

export const useToast = () => useContext(ToastContext);
