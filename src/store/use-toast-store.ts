import { create } from "zustand";

export type ToastType = "success" | "error" | "info";

export type Toast = {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
};

type ToastState = {
  toasts: Toast[];
  add: (toast: Omit<Toast, "id">) => void;
  remove: (id: string) => void;
};

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  add: (toast) => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
  remove: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export function toast(type: ToastType, title: string, description?: string) {
  useToastStore.getState().add({ type, title, description });
}
