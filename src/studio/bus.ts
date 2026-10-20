/** Commands from the Studio's side panels to its canvas (which owns the Fabric controller). */
export type StudioCommand = { type: 'crop'; id: string } | { type: 'endCrop' } | { type: 'fit' };

const bus = new EventTarget();

export function sendStudio(cmd: StudioCommand): void {
  bus.dispatchEvent(new CustomEvent('cmd', { detail: cmd }));
}

export function onStudio(fn: (cmd: StudioCommand) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<StudioCommand>).detail);
  bus.addEventListener('cmd', h);
  return () => bus.removeEventListener('cmd', h);
}
