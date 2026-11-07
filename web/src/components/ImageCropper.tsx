"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { SHAPE, centered, frameOf, renderCrop, zoomRange, type Crop, type ImageKind, type Source } from "@/lib/image";
import { Modal } from "./Modal";

export interface Edit {
  source: Source;
  crop: Crop;
  fill: string;
}

/** The source as it shows through a frame of the kind's shape; the parent sets the frame's size. */
export function CropView({ edit, kind, className = "" }: { edit: Edit; kind: ImageKind; className?: string }) {
  const { source: s } = edit;
  const f = frameOf(s, kind, edit.crop);
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: edit.fill }}>
      <img
        src={s.url}
        alt=""
        draggable={false}
        className="pointer-events-none absolute max-w-none select-none"
        style={{
          width: `${(s.w / f.w) * 100}%`,
          height: `${(s.h / f.h) * 100}%`,
          left: `${((f.w / 2 - f.cx) / f.w) * 100}%`,
          top: `${((f.h / 2 - f.cy) / f.h) * 100}%`,
        }}
      />
    </div>
  );
}

/**
 * Drag to move, pinch / scroll / the slider to zoom, with the jar's header on a phone and on a
 * desktop next to it. Zoomed out past the frame, the border takes a fill color.
 */
export function ImageCropper({
  kind,
  start,
  cover,
  avatar,
  title,
  onApply,
  onCancel,
}: {
  kind: ImageKind;
  start: Edit;
  /** The other image of the header, as it is now; the one being edited is drawn from the crop. */
  cover: ReactNode;
  avatar: (size: number) => ReactNode;
  title: string;
  onApply: (blob: Blob, edit: Edit) => Promise<void>;
  onCancel: () => void;
}) {
  const [edit, setEdit] = useState(start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const frame = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const s = edit.source;
  const f = frameOf(s, kind, edit.crop);
  const range = zoomRange(s, kind);
  const zoomedOut = f.zoom < 0.999;
  const soft = f.w < SHAPE[kind].w * 0.5;

  const update = (next: (c: Crop) => Crop) =>
    setEdit((e) => {
      const g = frameOf(e.source, kind, next(e.crop));
      return { ...e, crop: { cx: g.cx, cy: g.cy, zoom: g.zoom } };
    });

  // wheel zoom needs a non-passive listener to keep the page from scrolling
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      update((c) => ({ ...c, zoom: c.zoom * Math.exp(-e.deltaY * 0.002) }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function down(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  function move(e: PointerEvent<HTMLDivElement>) {
    const p = pointers.current;
    const last = p.get(e.pointerId);
    if (!last) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (p.size === 1) {
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      update((c) => {
        const g = frameOf(s, kind, c);
        return { ...c, cx: c.cx - (dx * g.w) / rect.width, cy: c.cy - (dy * g.h) / rect.height };
      });
    } else if (p.size === 2) {
      const other = [...p.entries()].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(last.x - other.x, last.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (before > 0) update((c) => ({ ...c, zoom: (c.zoom * after) / before }));
    }
    p.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  function up(e: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
  }

  function key(e: KeyboardEvent<HTMLDivElement>) {
    const step = (e.shiftKey ? 0.1 : 0.02) * f.w;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      update((c) => ({ ...c, cx: c.cx + m[0], cy: c.cy + m[1] }));
    } else if (e.key === "+" || e.key === "=") update((c) => ({ ...c, zoom: c.zoom * 1.1 }));
    else if (e.key === "-") update((c) => ({ ...c, zoom: c.zoom / 1.1 }));
  }

  async function apply() {
    setBusy(true);
    setError("");
    try {
      await onApply(await renderCrop(s, kind, edit.crop, edit.fill), edit);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
      setBusy(false);
    }
  }

  const view = <CropView edit={edit} kind={kind} className="size-full" />;
  const fills = [...new Set([s.average, "#262626", "#ffffff"])];

  return (
    <Modal title={kind === "cover" ? "Adjust the cover" : "Adjust the photo or logo"} onClose={busy ? () => {} : onCancel} wide>
      <div className="flex flex-col gap-4">
        <div
          ref={frame}
          tabIndex={0}
          role="application"
          aria-label="Image position. Drag or use the arrow keys to move, plus and minus to zoom."
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={key}
          className={`relative cursor-grab touch-none overflow-hidden rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing ${kind === "cover" ? "aspect-video w-full" : "mx-auto aspect-square w-full max-w-[300px]"}`}
        >
          {view}
          {kind === "avatar" && <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgba(0,0,0,0.55)]" />}
          <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/15" />
        </div>

        <div className="flex items-center gap-3">
          <button type="button" aria-label="Zoom out" onClick={() => update((c) => ({ ...c, zoom: c.zoom / 1.15 }))} className="btn-tactile size-9 shrink-0 justify-center text-lg">
            −
          </button>
          <input
            type="range"
            aria-label="Zoom"
            min={Math.log(range.min)}
            max={Math.log(range.max)}
            step={0.01}
            value={Math.log(f.zoom)}
            onChange={(e) => update((c) => ({ ...c, zoom: Math.exp(Number(e.target.value)) }))}
            className="w-full accent-[var(--accent)]"
          />
          <button type="button" aria-label="Zoom in" onClick={() => update((c) => ({ ...c, zoom: c.zoom * 1.15 }))} className="btn-tactile size-9 shrink-0 justify-center text-lg">
            +
          </button>
          <button type="button" onClick={() => setEdit((e) => ({ ...e, crop: centered(e.source) }))} className="btn-tactile h-9 shrink-0 px-3.5 text-sm">
            Reset
          </button>
        </div>

        <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
          <span>Drag to move · pinch, scroll or slide to zoom</span>
          {range.min < 0.999 && (
            <button type="button" onClick={() => update((c) => ({ ...c, zoom: range.min }))} className="text-text underline decoration-line underline-offset-4 hover:decoration-accent">
              Fit the whole image
            </button>
          )}
          {zoomedOut && (
            <span className="flex items-center gap-2">
              Border
              {fills.map((c) => (
                <button key={c} type="button" aria-label={`Border color ${c}`} aria-pressed={edit.fill === c} onClick={() => setEdit((e) => ({ ...e, fill: c }))}
                  style={{ background: c }} className={`size-6 rounded-full border border-line ring-offset-2 ring-offset-panel ${edit.fill === c ? "ring-2 ring-accent" : ""}`} />
              ))}
            </span>
          )}
        </div>
        {soft && <p className="text-sm text-amber-300">This part of the image is small ({Math.round(f.w)}×{Math.round(f.h)} px), so it may look soft. Zoom out or use a bigger image.</p>}

        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wider text-muted">On your page</p>
          <div className="flex flex-wrap items-end gap-4 rounded-2xl bg-bg p-4">
            <Header label="Phone" width={170} pageWidth={358} avatarPx={80} overlapPx={40} avatarLeftPx={16} padPx={16} titlePx={30}
              cover={kind === "cover" ? view : cover} avatar={kind === "avatar" ? () => view : avatar} title={title} />
            <Header label="Desktop" width={340} pageWidth={724} avatarPx={80} overlapPx={48} avatarLeftPx={24} padPx={0} titlePx={36}
              cover={kind === "cover" ? view : cover} avatar={kind === "avatar" ? () => view : avatar} title={title} />
          </div>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-tactile h-12 px-5 text-sm">
            Cancel
          </button>
          <button type="button" onClick={() => void apply()} disabled={busy} className="btn-tactile-accent btn-tactile-lg h-12 justify-center px-6">
            {busy ? "Uploading…" : "Use this"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The top of the jar page scaled down: the cover, the avatar over its bottom edge and the title.
 * The sizes are the page's own (app/j/[id]/page.tsx): a full-bleed cover on phones, the left
 * column's on desktops.
 */
function Header(p: {
  label: string;
  width: number;
  pageWidth: number;
  avatarPx: number;
  overlapPx: number;
  avatarLeftPx: number;
  padPx: number;
  titlePx: number;
  cover: ReactNode;
  avatar: (size: number) => ReactNode;
  title: string;
}) {
  const k = p.width / p.pageWidth;
  const size = p.avatarPx * k;
  const border = Math.max(1, 4 * k);
  return (
    <div className="flex flex-col gap-1.5" style={{ width: p.width }}>
      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        <div className="aspect-video w-full overflow-hidden [&>*]:size-full">{p.cover}</div>
        <div style={{ padding: `0 ${p.padPx * k}px ${Math.max(6, p.padPx * k)}px` }}>
          <div
            className="relative overflow-hidden rounded-full border-panel [&>*]:size-full"
            style={{ width: size, height: size, marginTop: -p.overlapPx * k, marginLeft: (p.avatarLeftPx - p.padPx) * k, borderWidth: border }}
          >
            {p.avatar(size - 2 * border)}
          </div>
          <p className="mt-1 truncate font-semibold leading-tight" style={{ fontSize: Math.max(9, p.titlePx * k) }}>
            {p.title.trim() || "Your jar title"}
          </p>
        </div>
      </div>
      <span className="text-xs text-muted">{p.label}</span>
    </div>
  );
}
