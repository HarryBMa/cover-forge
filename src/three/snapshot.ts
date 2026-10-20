/** Asks the 3D view for a picture of what it shows (transparent background), as a PNG data URL. */
type Request = { scale: number; resolve: (url: string | null) => void };

const bus = new EventTarget();

export function requestSnapshot(scale = 2): Promise<string | null> {
  return new Promise((resolve) => {
    const ev = new CustomEvent<Request>('snap', { detail: { scale, resolve } });
    bus.dispatchEvent(ev);
    // Nobody listening (the 3D view isn't open).
    if (!ev.defaultPrevented) resolve(null);
  });
}

export function onSnapshot(fn: (r: Request) => void): () => void {
  const h = (e: Event) => {
    e.preventDefault();
    fn((e as CustomEvent<Request>).detail);
  };
  bus.addEventListener('snap', h);
  return () => bus.removeEventListener('snap', h);
}
