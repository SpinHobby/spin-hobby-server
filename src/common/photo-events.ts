/**
 * "The shop background changed": said by the photo backgrounds library, heard by whatever shows product photos somewhere that cannot show
 * transparency and keeps its own copy (the eBay sync re-sends the photos of its listings). A plain in-process signal, like inventory-events.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export const photoEvents = {
  on(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  backgroundChanged(): void {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* a listener's trouble is its own */
      }
    }
  },
};
