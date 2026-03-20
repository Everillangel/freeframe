import { create } from 'zustand'

interface BreadcrumbStore {
  /** Map of path segments (e.g. UUID) → display label */
  labels: Record<string, string>
  setLabel: (segment: string, label: string) => void
  clearLabels: () => void
}

export const useBreadcrumbStore = create<BreadcrumbStore>((set) => ({
  labels: {},
  setLabel: (segment, label) =>
    set((s) => ({ labels: { ...s.labels, [segment]: label } })),
  clearLabels: () => set({ labels: {} }),
}))
