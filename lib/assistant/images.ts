/**
 * Images for the model (docs/assistant.md): downscaled in this browser and sent as `data:` URLs.
 * Never uploaded or stored — they live in the conversation, in memory, until it's cleared.
 *
 * 1600px on the long side keeps a business card's small print readable while holding one image
 * to a few hundred KB; a phone photo straight off the camera is 4000px and 3–5 MB of base64.
 */

export const MAX_SIDE = 1600;
export const MAX_IMAGES = 12;
const QUALITY = 0.85;

export interface ChatImage {
  id: string;
  name: string;
  /** `data:image/jpeg;base64,…` */
  url: string;
}

/** The size to draw at: the long side capped, the aspect kept, never enlarged. */
export function fitWithin(width: number, height: number, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export async function toChatImage(file: File): Promise<ChatImage> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image.`);
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot resize images.');
    // JPEG has no transparency: a PNG's clear background would turn black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return { id: crypto.randomUUID(), name: file.name || 'Pasted image', url: canvas.toDataURL('image/jpeg', QUALITY) };
  } finally {
    bitmap.close();
  }
}
