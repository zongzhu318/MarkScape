import { create } from 'zustand';
import type { FileMeta, Settings, ViewMode } from '../../../shared/types';
import { defaultSettings } from '../../../shared/defaults';
export interface Tab {
  id: string;
  name: string;
  path: string | null;
  meta: FileMeta | null;
  dirty: boolean;
  conflict: boolean;
  viewMode: ViewMode;
  revision: number;
  scrollTop: number;
  nextOffset?: number;
  pageOffset?: number;
  previousOffsets?: number[];
}
interface State {
  tabs: Tab[];
  activeId: string | null;
  root: string | null;
  recent: string[];
  settings: Settings;
  updateTab: (id: string, change: Partial<Tab>) => void;
}
export const useWorkspace = create<State>((set) => ({
  tabs: [],
  activeId: null,
  root: null,
  recent: [],
  settings: structuredClone(defaultSettings),
  updateTab: (id, change) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...change } : tab)),
    })),
}));
