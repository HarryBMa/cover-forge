import eye from 'lucide-static/icons/eye.svg?raw';
import eyeOff from 'lucide-static/icons/eye-off.svg?raw';
import lock from 'lucide-static/icons/lock.svg?raw';
import lockOpen from 'lucide-static/icons/lock-open.svg?raw';
import type from 'lucide-static/icons/type.svg?raw';
import image from 'lucide-static/icons/image.svg?raw';
import sticker from 'lucide-static/icons/sticker.svg?raw';
import frame from 'lucide-static/icons/frame.svg?raw';
import square from 'lucide-static/icons/square.svg?raw';
import undo from 'lucide-static/icons/undo-2.svg?raw';
import redo from 'lucide-static/icons/redo-2.svg?raw';

const ICONS = { eye, eyeOff, lock, lockOpen, type, image, sticker, frame, square, undo, redo };
export type IconName = keyof typeof ICONS;

/** A Lucide icon (ISC), inlined at build time, drawn in the current text colour. */
export function Icon({ name, size = 15 }: { name: IconName; size?: number }) {
  const svg = ICONS[name].replace(/<!--.*?-->/gs, '').replace(/width="24"/, `width="${size}"`).replace(/height="24"/, `height="${size}"`);
  return <span className="icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}
