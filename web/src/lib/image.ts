// Covers and avatars are cropped and re-encoded in the browser before upload: a cover to 8:3 at up
// to 1600 px wide, an avatar to a 400 px square. Re-encoding also drops EXIF (location, camera).

export const SHAPE = { cover: { w: 1600, ratio: 8 / 3 }, avatar: { w: 400, ratio: 1 } } as const;
const MAX_BYTES = 680_000;

export type ImageKind = keyof typeof SHAPE;

export interface Source {
  bmp: ImageBitmap;
  /** An object URL of the same picture for on-screen editing; revoke it with closeSource. */
  url: string;
  w: number;
  h: number;
  /** The picture's average color, the default fill when it is zoomed out past the frame. */
  average: string;
}

/**
 * Where the frame sits on the picture, in its pixels: the frame's center and a zoom where 1 fills
 * the frame edge to edge and less shows the whole picture with a border.
 */
export interface Crop {
  cx: number;
  cy: number;
  zoom: number;
}

export async function loadSource(file: Blob): Promise<Source> {
  if (!/^image\/(jpeg|png|webp|gif|avif|heic|heif)$/i.test(file.type)) throw new Error("Use a JPG, PNG or WebP image.");
  if (file.size > 25_000_000) throw new Error("That image is over 25 MB.");
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new Error("This browser can't read that image. Try a JPG or PNG.");
  });
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const ctx = c.getContext("2d");
  let average = "#171717";
  if (ctx) {
    ctx.drawImage(bmp, 0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    // a mostly transparent logo keeps the page's panel color
    if (a! > 128) average = `rgb(${r}, ${g}, ${b})`;
  }
  return { bmp, url: URL.createObjectURL(file), w: bmp.width, h: bmp.height, average };
}

export function closeSource(s: Source) {
  s.bmp.close();
  URL.revokeObjectURL(s.url);
}

/** The largest frame of the kind's shape that fits inside the picture, in its pixels. */
function baseFrame(s: Pick<Source, "w" | "h">, kind: ImageKind) {
  const { ratio } = SHAPE[kind];
  const w = Math.min(s.w, s.h * ratio);
  return { w, h: w / ratio };
}

/** Zooming out stops where the whole picture fits; in, at 5× the fill. */
export function zoomRange(s: Pick<Source, "w" | "h">, kind: ImageKind) {
  const b = baseFrame(s, kind);
  return { min: Math.min(1, b.w / s.w, b.h / s.h), max: 5 };
}

/** The frame's size on the picture, with its center kept inside it (or centered when wider). */
export function frameOf(s: Pick<Source, "w" | "h">, kind: ImageKind, crop: Crop) {
  const { min, max } = zoomRange(s, kind);
  const zoom = Math.min(max, Math.max(min, crop.zoom));
  const b = baseFrame(s, kind);
  const w = b.w / zoom;
  const h = b.h / zoom;
  const clamp = (c: number, size: number, full: number) => (size >= full ? full / 2 : Math.min(full - size / 2, Math.max(size / 2, c)));
  return { zoom, w, h, cx: clamp(crop.cx, w, s.w), cy: clamp(crop.cy, h, s.h) };
}

export const centered = (s: Pick<Source, "w" | "h">): Crop => ({ cx: s.w / 2, cy: s.h / 2, zoom: 1 });

export async function renderCrop(s: Source, kind: ImageKind, crop: Crop, fill: string): Promise<Blob> {
  const f = frameOf(s, kind, crop);
  const { w: maxW, ratio } = SHAPE[kind];
  const w = Math.round(Math.min(maxW, f.w));
  const h = Math.round(w / ratio);
  const k = w / f.w;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process the image.");
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(s.bmp, (f.w / 2 - f.cx) * k, (f.h / 2 - f.cy) * k, s.w * k, s.h * k);

  for (const q of [0.85, 0.72, 0.6]) {
    let blob = await toBlob(canvas, "image/webp", q);
    // Safari before 17 can't encode WebP and hands back a PNG
    if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", q);
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error("That image is too detailed to compress. Try another one.");
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Uploads a prepared image; returns the sha256 the jar page stores. */
export async function uploadImage(blob: Blob): Promise<string> {
  const res = (await (await fetch("/api/img", { method: "POST", headers: { "content-type": blob.type }, body: blob })).json()) as {
    ok: boolean;
    hash?: string;
    error?: string;
  };
  if (!res.ok || !res.hash) throw new Error(res.error ?? "Upload failed.");
  return res.hash;
}
