import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ViewLayout = 'grid' | 'list'
export type CardSize = 'S' | 'M' | 'L'
export type AspectRatio = 'landscape' | 'square' | 'portrait'
export type ThumbnailScale = 'fit' | 'fill'
export type TitleLines = '1' | '2' | '3'
export type SortKey = 'custom' | 'date' | 'name' | 'status' | 'type'
export type SortDirection = 'asc' | 'desc'

interface ViewSettings {
  layout: ViewLayout
  cardSize: CardSize
  aspectRatio: AspectRatio
  thumbnailScale: ThumbnailScale
  showCardInfo: boolean
  titleLines: TitleLines
  flattenFolders: boolean
  sortKey: SortKey
  sortDirection: SortDirection
  rightPanelOpen: boolean
}

interface ViewStore extends ViewSettings {
  setLayout: (layout: ViewLayout) => void
  setCardSize: (size: CardSize) => void
  setAspectRatio: (ratio: AspectRatio) => void
  setThumbnailScale: (scale: ThumbnailScale) => void
  setShowCardInfo: (show: boolean) => void
  setTitleLines: (lines: TitleLines) => void
  setFlattenFolders: (flatten: boolean) => void
  setSortKey: (key: SortKey) => void
  setSortDirection: (dir: SortDirection) => void
  toggleSortDirection: () => void
  toggleRightPanel: () => void
}

export const useViewStore = create<ViewStore>()(
  persist(
    (set) => ({
      layout: 'grid',
      cardSize: 'M',
      aspectRatio: 'landscape',
      thumbnailScale: 'fit',
      showCardInfo: true,
      titleLines: '1',
      flattenFolders: false,
      sortKey: 'date',
      sortDirection: 'desc',
      rightPanelOpen: true,

      setLayout: (layout) => set({ layout }),
      setCardSize: (size) => set({ cardSize: size }),
      setAspectRatio: (ratio) => set({ aspectRatio: ratio }),
      setThumbnailScale: (scale) => set({ thumbnailScale: scale }),
      setShowCardInfo: (show) => set({ showCardInfo: show }),
      setTitleLines: (lines) => set({ titleLines: lines }),
      setFlattenFolders: (flatten) => set({ flattenFolders: flatten }),
      setSortKey: (key) => set({ sortKey: key }),
      setSortDirection: (dir) => set({ sortDirection: dir }),
      toggleSortDirection: () =>
        set((s) => ({ sortDirection: s.sortDirection === 'asc' ? 'desc' : 'asc' })),
      toggleRightPanel: () =>
        set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
    }),
    { name: 'freeframe-view-settings' },
  ),
)
