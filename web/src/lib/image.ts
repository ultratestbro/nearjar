// Covers and avatars are cropped and re-encoded in the browser before upload: a cover to 8:3 at up
// to 1600 px wide, an avatar to a 400 px square. Re-encoding also drops EXIF (location, camera).

const SHAPE = { cover: { w: 1600, ratio: 8 / 3 }, avatar: { w: 400, ratio: 1 } } as const;
const MAX_BYTES = 680_000;

export type ImageKind = keyof typeof SHAPE;

export async function prepareImage(file: File, kind: ImageKind): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|gif|avif|heic|heif)$/i.test(file.type)) throw new Error("Use a JPG, PNG or WebP image.");
  if (file.size > 25_000_000) throw new Error("That image is over 25 MB.");
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new Error("This browser can't read that image. Try a JPG or PNG.");
  });
  const { w: maxW, ratio } = SHAPE[kind];
  // center crop to the target shape
  let sw = bmp.width;
  let sh = sw / ratio;
  if (sh > bmp.height) {
    sh = bmp.height;
    sw = sh * ratio;
  }
  const sx = (bmp.width - sw) / 2;
  const sy = (bmp.height - sh) / 2;
  const w = Math.round(Math.min(maxW, sw));
  const h = Math.round(w / ratio);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process the image.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
  bmp.close();

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
