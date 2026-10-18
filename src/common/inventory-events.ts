/**
 * "Square's stock count of these variations may have changed": said wherever a new count arrives (Square's webhook, the scheduled sync, a
 * restock in the admin), and heard by whatever keeps another sales channel in step (the eBay sync). A plain in-process signal: the listener
 * reads the counts again itself, so a missed or doubled signal changes nothing but timing.
 */
type Listener = (variationIds: string[]) => void;
const listeners = new Set<Listener>();

export const inventoryEvents = {
  on(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  changed(variationIds: string[]): void {
    if (!variationIds.length) return;
    for (const listener of listeners) {
      try {
        listener(variationIds);
      } catch {
        /* a listener's trouble is its own */
      }
    }
  },
};
