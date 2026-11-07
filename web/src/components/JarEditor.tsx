"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ReceiveAsset } from "@/lib/assets";
import { centered, closeSource, loadSource, uploadImage, type ImageKind } from "@/lib/image";
import {
  COVER_GRADIENTS,
  DEFAULT_PRESETS,
  EMPTY_PAGE,
  imageUrl,
  normalizeLink,
  PAGE_LIMITS,
  PRESET_CHOICES,
  SLUG,
  slugify,
  type JarPageData,
  type LinkKind,
} from "@/lib/pageData";
import type { ConnectedWallet } from "@/lib/wallet";
import { ImageCropper, type Edit } from "./ImageCropper";
import { JarAvatar, JarCover } from "./JarArt";
import { LinkIcon } from "./LinkIcon";
import { Modal } from "./Modal";
import { Chevron, Icon, ListCard, ListRow, PillTabs, Progress, money, shortAccount } from "./ui";

export type AssetWithIcon = ReceiveAsset & { icon: string };

/** A jar as the contract returns it. */
export interface StudioJar {
  id: string;
  title: string;
  description: string;
  image_url: string | null;
  goal_usd_cents: string | null;
  receive_asset: string;
  status: "Open" | "Closed";
  raised_usd_cents: string;
  donations_count: string;
}

type Section = "page" | "goal" | "payout" | "after";

interface Draft {
  title: string;
  story: string;
  goalOn: boolean;
  goal: string;
  receive: string;
  tagline: string;
  cover: string | null;
  coverColor: number;
  avatar: string | null;
  milestones: { usd: string; label: string }[];
  presets: number[];
  thanks: string;
  links: Record<LinkKind, string>;
  slug: string;
}

const LINK_FIELDS: { kind: LinkKind; label: string; placeholder: string }[] = [
  { kind: "website", label: "Website", placeholder: "anacosta.film" },
  { kind: "x", label: "X", placeholder: "@anacosta" },
  { kind: "telegram", label: "Telegram", placeholder: "@anacosta" },
  { kind: "youtube", label: "YouTube", placeholder: "@anacosta" },
];

function draftOf(jar: StudioJar | null, page: JarPageData | null, assets: readonly AssetWithIcon[]): Draft {
  const p = page ?? EMPTY_PAGE;
  return {
    title: jar?.title ?? "",
    story: jar?.description ?? "",
    goalOn: jar ? !!jar.goal_usd_cents : true,
    goal: jar?.goal_usd_cents ? String(Number(jar.goal_usd_cents) / 100) : jar ? "" : "1000",
    receive: jar?.receive_asset ?? assets[0]!.id,
    tagline: p.tagline,
    cover: p.cover,
    coverColor: p.coverColor,
    avatar: p.avatar,
    milestones: p.milestones.map((m) => ({ usd: String(m.usd), label: m.label })),
    presets: p.presets.length ? p.presets : DEFAULT_PRESETS,
    thanks: p.thanks,
    links: { website: p.links.website ?? "", x: p.links.x ?? "", telegram: p.links.telegram ?? "", youtube: p.links.youtube ?? "" },
    slug: p.slug ?? "",
  };
}

/** The page fields exactly as they are sent to /api/jars/prepare and /api/jars (same object both times). */
function pageOf(d: Draft) {
  return {
    tagline: d.tagline,
    cover: d.cover,
    coverColor: d.coverColor,
    avatar: d.avatar,
    milestones: d.milestones.filter((m) => m.label.trim() || m.usd.trim()).map((m) => ({ usd: Number(m.usd), label: m.label })),
    presets: d.presets,
    thanks: d.thanks,
    links: Object.fromEntries(Object.entries(d.links).filter(([, v]) => v.trim())),
    slug: d.slug.trim() || null,
  };
}

/**
 * Jar editor: four sections (page, goal & amounts, payout & link, after donation) next to a live
 * preview. Publishing signs the stored fields plus the page's fingerprint in one message.
 */
export function JarEditor({
  jar,
  page,
  wallet,
  assets,
  onClose,
  onPublished,
}: {
  jar: StudioJar | null;
  page: JarPageData | null;
  wallet: ConnectedWallet;
  assets: readonly AssetWithIcon[];
  onClose: () => void;
  onPublished: (r: { jarId: string; isNew: boolean; slugKept: boolean; slug: string | null; pageError?: string }) => void;
}) {
  const initial = useMemo(() => draftOf(jar, page, assets), [jar, page, assets]);
  const [d, setD] = useState<Draft>(initial);
  const [section, setSection] = useState<Section>("page");
  const [preview, setPreview] = useState(false); // phones: preview instead of the form
  const [slugTouched, setSlugTouched] = useState(!!initial.slug);
  const [signing, setSigning] = useState(false);
  const isNew = !jar;
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  // checked availability, per short link; the state of the one typed now is derived from it
  const [checked, setChecked] = useState<{ slug: string; available: boolean } | null>(null);
  const slug = d.slug.trim();
  const slugState: "idle" | "checking" | "ok" | "taken" | "bad" = !slug
    ? "idle"
    : !SLUG.test(slug)
      ? "bad"
      : checked?.slug === slug
        ? checked.available
          ? "ok"
          : "taken"
        : "checking";

  useEffect(() => {
    if (!slug || !SLUG.test(slug)) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/jars/slug?s=${encodeURIComponent(slug)}${jar ? `&jar=${jar.id}` : ""}`, { signal: ctrl.signal })
        .then((r) => r.json() as Promise<{ ok: boolean; available?: boolean }>)
        .then((r) => r.ok && setChecked({ slug, available: !!r.available }))
        .catch(() => {});
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [slug, jar]);

  const receive = assets.find((a) => a.id === d.receive) ?? assets[0]!;
  const goalUsd = d.goalOn && Number(d.goal) > 0 ? Number(d.goal) : null;
  const hasCover = !!d.cover || !!jar?.image_url;
  const badLink = LINK_FIELDS.find((f) => d.links[f.kind].trim() && !normalizeLink(f.kind, d.links[f.kind]));
  const linkProblem = badLink ? `${badLink.label}: use a link or a handle like ${badLink.placeholder}.` : "";
  const warn: Record<Section, boolean> = {
    page: !hasCover || !d.story.trim(),
    goal: d.milestones.some((m) => !m.label.trim() || !(Number(m.usd) >= 1)),
    payout: slugState === "taken" || slugState === "bad",
    after: !d.thanks.trim() || !!badLink,
  };
  const problem = !d.title.trim()
    ? "Give the jar a title."
    : d.goalOn && !(Number(d.goal) >= 1)
      ? "Set a goal of at least $1, or turn the goal off."
      : warn.goal
        ? "Every milestone needs an amount and a label."
        : slugState === "taken"
          ? "That short link is taken."
          : slugState === "bad"
            ? "Short link: 3–40 letters, digits or dashes."
            : linkProblem;
  const canPublish = !problem && (dirty || isNew) && slugState !== "checking";

  const status = isNew ? "Not published yet" : dirty ? "Unpublished changes" : "Live · no changes";
  const sections: { id: Section; label: string; dot?: boolean }[] = [
    { id: "page", label: "Page", dot: warn.page },
    { id: "goal", label: "Goal & amounts", dot: warn.goal },
    { id: "payout", label: "Payout & link", dot: warn.payout },
    { id: "after", label: "After donation", dot: warn.after },
  ];
  const next: Record<Section, Section | null> = { page: "goal", goal: "payout", payout: "after", after: null };

  return (
    <div className="flex flex-col gap-5">
      <header className="sticky top-0 z-20 -mx-4 -mt-4 flex flex-wrap items-center gap-3 border-b border-line bg-panel/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:-mt-8 sm:px-8 sm:py-4">
        <button type="button" onClick={onClose} aria-label="Back" className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 hover:bg-line">
          <Chevron dir="left" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{d.title.trim() || (jar?.title ?? "New jar")}</p>
          <p className={`text-xs ${isNew || dirty ? "text-amber-300" : "text-muted"}`}>{status}</p>
        </div>
        <button type="button" onClick={() => setPreview((v) => !v)} className="rounded-full border border-line px-4 py-2 text-sm lg:hidden">
          {preview ? "Edit" : "Preview"}
        </button>
        {!isNew && dirty && (
          <button type="button" onClick={() => setD(initial)} className="hidden rounded-full border border-line px-4 py-2 text-sm hover:bg-surface-2 sm:block">
            Discard
          </button>
        )}
        <button type="button" disabled={!canPublish} onClick={() => setSigning(true)} title={problem || undefined}
          className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-ink disabled:opacity-40">
          Publish
        </button>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className={`flex flex-col gap-6 ${preview ? "hidden lg:flex" : ""}`}>
          <PillTabs tabs={sections} value={section} onChange={setSection} />

          {section === "page" && (
            <div className="flex flex-col gap-6">
              <Field label="Cover" hint="JPG, PNG or WebP · you frame it after picking">
                <ImagePicker kind="cover" value={d.cover} onChange={(h) => set("cover", h)} page={d} title={d.title} legacyImage={jar?.image_url}
                  preview={<JarCover page={d} legacyImage={jar?.image_url} className="aspect-video w-full rounded-2xl" />} />
                {!d.cover && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted">No photo? Pick a color:</span>
                    {COVER_GRADIENTS.map((g, i) => (
                      <button key={g} type="button" onClick={() => set("coverColor", i)} aria-label={`Cover color ${i + 1}`} aria-pressed={d.coverColor === i}
                        style={{ background: g }} className={`size-7 rounded-full ring-offset-2 ring-offset-panel ${d.coverColor === i ? "ring-2 ring-accent" : ""}`} />
                    ))}
                  </div>
                )}
              </Field>

              <Field label="Photo or logo" hint="Shown round next to the title">
                <div className="flex items-center gap-4">
                  <JarAvatar page={d} title={d.title} size={64} />
                  <ImagePicker kind="avatar" value={d.avatar} onChange={(h) => set("avatar", h)} page={d} title={d.title} legacyImage={jar?.image_url} compact />
                </div>
              </Field>

              <Field label="Title" count={`${[...d.title].length}/80`}>
                <input value={d.title} onChange={(e) => {
                  const title = e.target.value;
                  // a new jar's short link follows its title until the owner edits it
                  setD((x) => ({ ...x, title, ...(isNew && !slugTouched ? { slug: slugify(title) } : {}) }));
                }} maxLength={80} placeholder="Help Ana finish her film" className={input} />
              </Field>

              <Field label="One line about you" count={`${[...d.tagline].length}/${PAGE_LIMITS.tagline}`}>
                <input value={d.tagline} onChange={(e) => set("tagline", e.target.value)} maxLength={PAGE_LIMITS.tagline} placeholder="Filmmaker in Lisbon · documentaries about trams" className={input} />
              </Field>

              <Field label="Story" count={`${[...d.story].length}/1000`} hint="What you're raising for and what happens with the money. 2–3 short paragraphs read best.">
                <textarea value={d.story} onChange={(e) => set("story", e.target.value)} maxLength={1000} rows={7} placeholder="I'm finishing a 20-minute documentary about Lisbon's last tram drivers…" className={input} />
              </Field>
            </div>
          )}

          {section === "goal" && (
            <div className="flex flex-col gap-6">
              <ListCard>
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <span className="flex-1">
                    <span className="block">Fundraising goal</span>
                    <span className="block text-xs text-muted">Shows a progress bar on the page</span>
                  </span>
                  <Switch on={d.goalOn} onChange={(v) => set("goalOn", v)} label="Fundraising goal" />
                </div>
                {d.goalOn && (
                  <div className="flex flex-col gap-1 px-4 py-3.5">
                    <label className="flex items-center rounded-2xl border border-line bg-panel px-4 focus-within:border-accent">
                      <span className="text-2xl text-muted">$</span>
                      <input value={d.goal} onChange={(e) => set("goal", e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" aria-label="Goal in US dollars"
                        className="w-full bg-transparent px-2 py-3 text-2xl font-semibold outline-none" />
                    </label>
                    {Number(d.goal) >= 25 && <span className="text-xs text-muted">≈ {Math.ceil(Number(d.goal) / 25)} donations of $25</span>}
                  </div>
                )}
              </ListCard>

              <Field label="Milestones" hint="What each amount pays for. Ticked on the page once raised.">
                <div className="flex flex-col gap-2">
                  {d.milestones.map((m, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <label className="flex w-28 shrink-0 items-center rounded-xl border border-line bg-surface-2 px-3 focus-within:border-accent">
                        <span className="text-muted">$</span>
                        <input value={m.usd} inputMode="numeric" aria-label="Milestone amount" placeholder="500"
                          onChange={(e) => set("milestones", d.milestones.map((x, j) => (j === i ? { ...x, usd: e.target.value.replace(/[^\d]/g, "") } : x)))}
                          className="w-full bg-transparent px-1 py-2.5 outline-none" />
                      </label>
                      <input value={m.label} maxLength={PAGE_LIMITS.milestone} aria-label="Milestone label" placeholder="Color grading"
                        onChange={(e) => set("milestones", d.milestones.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                        className={`${input} min-w-0 flex-1`} />
                      <button type="button" aria-label="Remove milestone" onClick={() => set("milestones", d.milestones.filter((_, j) => j !== i))}
                        className="grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-text">×</button>
                    </div>
                  ))}
                  {d.milestones.length < PAGE_LIMITS.milestones && (
                    <button type="button" onClick={() => set("milestones", [...d.milestones, { usd: "", label: "" }])}
                      className="self-start rounded-full border border-dashed border-line px-4 py-2 text-sm text-muted hover:text-text">
                      + Add milestone
                    </button>
                  )}
                </div>
              </Field>

              <Field label="Suggested amounts" hint={`Donors see these as one-tap buttons. Pick up to ${PAGE_LIMITS.presets}.`}>
                <div className="flex flex-wrap gap-2">
                  {PRESET_CHOICES.map((p) => {
                    const on = d.presets.includes(p);
                    return (
                      <button key={p} type="button" aria-pressed={on}
                        disabled={!on && d.presets.length >= PAGE_LIMITS.presets}
                        onClick={() => set("presets", on ? (d.presets.length > 1 ? d.presets.filter((x) => x !== p) : d.presets) : [...d.presets, p].sort((a, b) => a - b))}
                        className={`rounded-full px-4 py-2 text-sm font-medium transition disabled:opacity-40 ${on ? "bg-pill text-bg" : "bg-surface-2 hover:bg-line"}`}>
                        ${p}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>
          )}

          {section === "payout" && (
            <div className="flex flex-col gap-6">
              <Field label="Receive as" hint="Every donation is swapped into this, whatever the donor pays with.">
                <ListCard>
                  {assets.map((a) => (
                    <button key={a.id} type="button" onClick={() => set("receive", a.id)} aria-pressed={d.receive === a.id}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-2">
                      <Icon src={a.icon} alt={a.symbol} size={32} />
                      <span className="flex-1">
                        <span className="block">{a.symbol}</span>
                        <span className="block text-xs text-muted">{ASSET_NOTE[a.symbol] ?? "in near.com"}</span>
                      </span>
                      <span className={`grid size-5 place-items-center rounded-full border-2 ${d.receive === a.id ? "border-accent" : "border-line"}`}>
                        {d.receive === a.id && <span className="size-2.5 rounded-full bg-accent" />}
                      </span>
                    </button>
                  ))}
                </ListCard>
              </Field>

              <Field label="Paid to">
                <ListCard>
                  <ListRow icon={<Icon src={wallet.icon} alt={wallet.name} size={32} />} label={<span className="font-mono">nearcom:{shortAccount(wallet.account)}</span>} hint="Your near.com balance · set by the wallet you signed in with" value={<span aria-label="locked">🔒</span>} />
                </ListCard>
              </Field>

              <Field label="Short link" hint={slugHint(slugState)}>
                <label className={`flex items-center rounded-xl border bg-surface-2 px-3 focus-within:border-accent ${slugState === "taken" || slugState === "bad" ? "border-danger/60" : "border-line"}`}>
                  <span className="shrink-0 text-muted">nearjar.xyz/j/</span>
                  <input value={d.slug} maxLength={40} placeholder="ana-film" aria-label="Short link"
                    onChange={(e) => {
                      setSlugTouched(true);
                      set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                    }}
                    className="w-full bg-transparent py-2.5 font-mono outline-none" />
                  {slugState === "ok" && <span className="shrink-0 text-sm text-accent">available ✓</span>}
                  {slugState === "taken" && <span className="shrink-0 text-sm text-danger">taken</span>}
                </label>
              </Field>
            </div>
          )}

          {section === "after" && (
            <div className="flex flex-col gap-6">
              <Field label="Thank-you note" count={`${[...d.thanks].length}/${PAGE_LIMITS.thanks}`} hint="Donors see it the moment their money lands.">
                <textarea value={d.thanks} onChange={(e) => set("thanks", e.target.value)} maxLength={PAGE_LIMITS.thanks} rows={4}
                  placeholder="Obrigada! Every dollar goes into the final cut. I'll post the premiere date here." className={input} />
              </Field>
              <Field label="Links" hint="Shown under your story.">
                <div className="grid gap-2 sm:grid-cols-2">
                  {LINK_FIELDS.map((f) => (
                    <label key={f.kind} className={`flex items-center gap-2 rounded-xl border bg-surface-2 px-3 focus-within:border-accent ${badLink?.kind === f.kind ? "border-danger/60" : "border-line"}`}>
                      <span className="flex w-24 shrink-0 items-center gap-2 text-sm text-muted">
                        <LinkIcon kind={f.kind} />
                        {f.label}
                      </span>
                      <input value={d.links[f.kind]} placeholder={f.placeholder} aria-label={f.label}
                        onChange={(e) => set("links", { ...d.links, [f.kind]: e.target.value })}
                        className="w-full min-w-0 bg-transparent py-2.5 outline-none" />
                    </label>
                  ))}
                </div>
                {linkProblem && <p className="text-sm text-danger">{linkProblem}</p>}
              </Field>
            </div>
          )}

          {next[section] ? (
            <button type="button" onClick={() => setSection(next[section]!)} className="self-start rounded-full border border-line px-5 py-2.5 text-sm hover:bg-surface-2">
              Next: {sections.find((s) => s.id === next[section])!.label} →
            </button>
          ) : (
            // the last step ends on publishing, so nobody has to scroll back up to the header
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <PublishButton disabled={!canPublish} problem={problem} onClick={() => setSigning(true)} />
              <button type="button" onClick={() => setPreview(true)} className="btn-tactile h-12 justify-center px-5 text-sm lg:hidden">
                Preview the page →
              </button>
            </div>
          )}
        </div>

        <aside className={`flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start ${preview ? "" : "hidden lg:flex"}`}>
          <p className="text-xs uppercase tracking-wider text-muted">Live preview</p>
          <PagePreview d={d} jar={jar} goalUsd={goalUsd} receive={receive} />
          <Checklist d={d} hasCover={hasCover} go={(s) => { setSection(s); setPreview(false); }} />
          <div className="lg:hidden">
            <PublishButton disabled={!canPublish} problem={problem} onClick={() => setSigning(true)} />
          </div>
        </aside>
      </div>

      {signing && (
        <SignModal
          d={d}
          jar={jar}
          wallet={wallet}
          receive={receive}
          onClose={() => setSigning(false)}
          onDone={(r) => {
            setSigning(false);
            onPublished({ ...r, isNew, slug: r.slugKept && !r.pageError ? d.slug.trim() || null : null });
          }}
        />
      )}
    </div>
  );
}

const ASSET_NOTE: Record<string, string> = {
  USDC: "USD Coin · stable, $1",
  USDT: "Tether · stable, $1",
  NEAR: "NEAR · moves with the market",
  BTC: "Bitcoin · moves with the market",
  ETH: "Ether · moves with the market",
};

const input = "rounded-xl border border-line bg-surface-2 px-3 py-2.5 outline-none focus:border-accent";


function slugHint(s: "idle" | "checking" | "ok" | "taken" | "bad"): string {
  if (s === "checking") return "Checking…";
  if (s === "taken") return "Another jar uses this link. Try another.";
  if (s === "bad") return "3–40 letters, digits or dashes, with at least one letter.";
  return "Optional. The numbered link keeps working too.";
}

function Field({ label, hint, count, children }: { label: string; hint?: string; count?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{label}</span>
        {count && <span className="font-mono text-xs text-muted">{count}</span>}
      </div>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? "bg-accent" : "bg-line"}`}>
      <span className={`absolute top-1 size-5 rounded-full bg-text transition-all ${on ? "left-6" : "left-1"}`} />
    </button>
  );
}

function ImagePicker({ kind, value, onChange, page, title, legacyImage, preview, compact }: {
  kind: ImageKind;
  value: string | null;
  onChange: (hash: string | null) => void;
  page: Pick<JarPageData, "cover" | "coverColor" | "avatar">;
  title: string;
  legacyImage?: string | null;
  preview?: ReactNode;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const [editing, setEditing] = useState<Edit | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  // the full picture behind the current crop, so Adjust can move out as well as in
  const kept = useRef<{ hash: string; edit: Edit } | null>(null);

  async function open(blob: Blob | undefined, from?: Edit) {
    if (ref.current) ref.current.value = "";
    if (!blob && !from) return;
    setError("");
    if (from) return setEditing(from);
    setBusy(true);
    try {
      const source = await loadSource(blob!);
      setEditing({ source, crop: centered(source), fill: source.average });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open that image.");
    } finally {
      setBusy(false);
    }
  }

  async function adjust() {
    if (!value) return;
    if (kept.current?.hash === value) return open(undefined, kept.current.edit);
    setBusy(true);
    try {
      const r = await fetch(imageUrl(value));
      if (!r.ok) throw new Error("Could not load the image.");
      await open(await r.blob());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the image.");
      setBusy(false);
    }
  }

  function drop(e: Edit) {
    if (kept.current?.edit.source !== e.source) closeSource(e.source);
  }

  async function apply(blob: Blob, e: Edit) {
    const hash = await uploadImage(blob);
    if (kept.current && kept.current.edit.source !== e.source) closeSource(kept.current.edit.source);
    kept.current = { hash, edit: e };
    onChange(hash);
    setEditing(null);
  }

  const picker = (
    <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/avif" className="sr-only" onChange={(e) => void open(e.target.files?.[0])} />
  );
  const buttons = (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => ref.current?.click()} disabled={busy} className="rounded-full bg-surface-2 px-4 py-2 text-sm hover:bg-line disabled:opacity-50">
        {busy ? "Opening…" : value ? "Replace" : "Upload"}
      </button>
      {value && !busy && (
        <>
          <button type="button" onClick={() => void adjust()} className="rounded-full bg-surface-2 px-4 py-2 text-sm hover:bg-line">
            Adjust
          </button>
          <button type="button" onClick={() => onChange(null)} className="rounded-full px-3 py-2 text-sm text-muted hover:text-danger">
            Remove
          </button>
        </>
      )}
      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  );
  const cropper = editing && (
    <ImageCropper
      kind={kind}
      start={editing}
      title={title}
      cover={<JarCover page={page} legacyImage={legacyImage} mark={false} />}
      avatar={(size) => <JarAvatar page={page} title={title} size={size} />}
      onApply={apply}
      onCancel={() => {
        drop(editing);
        setEditing(null);
      }}
    />
  );

  if (compact)
    return (
      <div>
        {picker}
        {buttons}
        {cropper}
      </div>
    );
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void open(e.dataTransfer.files[0]);
      }}
      className={`relative flex flex-col gap-3 rounded-2xl ${over ? "outline-2 outline-offset-4 outline-accent outline-dashed" : ""}`}
    >
      {picker}
      <div className="relative">
        {preview}
        {!value && (
          <button type="button" onClick={() => ref.current?.click()} className="absolute inset-0 grid place-items-center rounded-2xl text-sm text-text/80 hover:bg-black/20">
            <span className="rounded-full bg-black/50 px-4 py-2 backdrop-blur">{busy ? "Opening…" : "Drop a photo here or click to upload"}</span>
          </button>
        )}
      </div>
      {buttons}
      {cropper}
    </div>
  );
}

function PagePreview({ d, jar, goalUsd, receive }: { d: Draft; jar: StudioJar | null; goalUsd: number | null; receive: AssetWithIcon }) {
  const raised = jar ? Number(jar.raised_usd_cents) / 100 : 0;
  const milestones = d.milestones.filter((m) => m.label.trim() && Number(m.usd) >= 1).sort((a, b) => Number(a.usd) - Number(b.usd));
  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-bg">
      <JarCover page={d} legacyImage={jar?.image_url} className="aspect-video w-full" mark={false} />
      <div className="flex flex-col gap-3 p-4">
        <JarAvatar page={d} title={d.title} size={48} className="relative -mt-10 border-4 border-bg" />
        <div>
          <p className="break-words text-lg font-semibold leading-tight">{d.title.trim() || "Your jar title"}</p>
          {d.tagline.trim() && <p className="text-sm text-muted">{d.tagline}</p>}
        </div>
        <div className="flex flex-col gap-2 rounded-2xl bg-surface p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-semibold">{money(raised)}</span>
            {goalUsd && <span className="text-xs text-muted">of {money(goalUsd, 0)}</span>}
          </div>
          {goalUsd && <Progress pct={(raised / goalUsd) * 100} className="h-1.5" />}
          <div className="flex flex-wrap gap-1.5">
            {d.presets.map((p, i) => (
              <span key={p} className={`rounded-full px-2.5 py-1 text-xs ${i === Math.min(1, d.presets.length - 1) ? "bg-pill text-bg" : "bg-surface-2"}`}>${p}</span>
            ))}
          </div>
          <span className="rounded-full bg-accent py-2 text-center text-sm font-medium text-accent-ink">Donate</span>
          <span className="flex items-center justify-center gap-1.5 text-[11px] text-muted">
            <Icon src={receive.icon} alt={receive.symbol} size={12} /> arrives as {receive.symbol} in near.com
          </span>
        </div>
        {d.story.trim() ? <p className="line-clamp-4 whitespace-pre-line text-sm text-muted">{d.story}</p> : <p className="text-sm text-muted/60">Your story appears here.</p>}
        {milestones.length > 0 && (
          <ul className="flex flex-col gap-1.5 text-sm">
            {milestones.map((m, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className={`size-3 rounded-full ${raised >= Number(m.usd) ? "bg-accent" : "border-2 border-line"}`} />
                <span className="flex-1 truncate">{m.label}</span>
                <span className="font-mono text-xs text-muted">${Number(m.usd).toLocaleString("en-US")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The big publish button at the end of the form and under the phone preview. */
function PublishButton({ disabled, problem, onClick }: { disabled: boolean; problem: string; onClick: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <button type="button" disabled={disabled} onClick={onClick}
        className="btn-tactile-accent btn-tactile-lg h-14 w-full justify-center px-8 text-[17px] disabled:pointer-events-none disabled:opacity-40 sm:w-auto">
        Publish
      </button>
      {problem && <p className="text-sm text-danger">{problem}</p>}
    </div>
  );
}

function Checklist({ d, hasCover, go }: { d: Draft; hasCover: boolean; go: (s: Section) => void }) {
  const items: { done: boolean; label: string; section: Section }[] = [
    { done: hasCover, label: "A cover photo", section: "page" },
    { done: d.story.trim().length >= 120, label: "A story of 2–3 sentences", section: "page" },
    { done: d.milestones.some((m) => m.label.trim()), label: "Milestones donors can see", section: "goal" },
    { done: !!d.thanks.trim(), label: "A thank-you note", section: "after" },
  ];
  const left = items.filter((i) => !i.done).length;
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line p-4">
      <p className="text-sm">{left === 0 ? "Your page has everything that gets donations ✓" : "Pages like this get more donations with:"}</p>
      <ul className="flex flex-col gap-1">
        {items.map((i) => (
          <li key={i.label}>
            <button type="button" onClick={() => go(i.section)} className="flex w-full items-center gap-2 rounded-lg py-1 text-left text-sm hover:text-accent">
              <span className={`grid size-4 place-items-center rounded-full text-[10px] ${i.done ? "bg-accent text-accent-ink" : "border border-line"}`}>{i.done ? "✓" : ""}</span>
              <span className={i.done ? "text-muted line-through decoration-line" : ""}>{i.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SignModal({
  d,
  jar,
  wallet,
  receive,
  onClose,
  onDone,
}: {
  d: Draft;
  jar: StudioJar | null;
  wallet: ConnectedWallet;
  receive: AssetWithIcon;
  onClose: () => void;
  onDone: (r: { jarId: string; slugKept: boolean; pageError?: string }) => void;
}) {
  // where publishing is: nothing yet, then the three steps the modal lists
  const [stage, setStage] = useState<"idle" | "prepare" | "sign" | "save">("idle");
  const [error, setError] = useState("");
  const page = useMemo(() => pageOf(d), [d]);
  const images = [d.cover, d.avatar].filter(Boolean).length;
  const busy = stage !== "idle";

  async function sign() {
    setError("");
    try {
      setStage("prepare");
      const jarFields = {
        title: d.title,
        description: d.story,
        image_url: jar?.image_url ?? null,
        goal_usd: d.goalOn ? d.goal : null,
        receive_asset: d.receive,
        page,
      };
      const prep = (await post("/api/jars/prepare", {
        signerId: wallet.account,
        action: jar ? "update_jar" : "create_jar",
        ...(jar ? { jarId: jar.id } : {}),
        jar: jarFields,
        standard: wallet.family === "near" ? "nep413" : undefined,
      })) as { ok: boolean; message?: string; nonce?: string; recipient?: string; error?: string };
      if (!prep.ok || !prep.message || !prep.nonce || !prep.recipient) throw new Error(prep.error ?? "Could not prepare the jar.");

      setStage("sign");
      const signed = await wallet.sign({ message: prep.message, nonce: prep.nonce, recipient: prep.recipient });

      setStage("save");
      const res = (await post("/api/jars", { signed, page })) as { ok: boolean; jarId?: string; slugKept?: boolean; pageError?: string; error?: string };
      if (!res.ok || !res.jarId) throw new Error(res.error ?? "The jar was not saved.");
      onDone({ jarId: res.jarId, slugKept: res.slugKept ?? true, ...(res.pageError ? { pageError: res.pageError } : {}) });
    } catch (e) {
      const m = e instanceof Error ? e.message : "Something went wrong.";
      setError(/reject|denied|4001|cancel/i.test(m) ? "You cancelled in the wallet." : m);
    } finally {
      setStage("idle");
    }
  }

  const steps = [
    {
      title: `Sign in ${wallet.name}`,
      text: "One message. It isn't a transaction and costs nothing.",
      icon: <Icon src={wallet.icon} alt={wallet.name} size={18} />,
      active: stage === "prepare" || stage === "sign",
    },
    {
      title: "NearJar sends it to NEAR",
      text: "Our relayer pays the gas. The contract checks with near.com that the key is yours.",
      active: stage === "save",
    },
    {
      title: jar ? "The changes go live" : "Your jar goes live",
      text: jar ? "Donors see the new version right away." : "You get its link to share, ready for donations.",
      active: false,
    },
  ];
  const at = stage === "save" ? 1 : 0;
  const goal = d.goalOn && Number(d.goal) > 0 ? `${money(Number(d.goal), 0)} goal` : "No goal";

  return (
    <Modal title={jar ? "Publish changes" : "Publish your jar"} onClose={() => !busy && onClose()}>
      <div className="flex flex-col gap-5">
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <JarCover page={page} legacyImage={jar?.image_url} className="h-20 w-full" />
          <div className="flex items-end gap-3 px-4 pb-3.5">
            <JarAvatar page={page} title={d.title} size={52} className="-mt-7 ring-4 ring-surface" />
            <div className="flex min-w-0 flex-col pt-2">
              <p className="truncate font-semibold">{d.title.trim() || "Untitled jar"}</p>
              <p className="flex items-center gap-1.5 truncate text-sm text-muted">
                {goal} · paid out in <Icon src={receive.icon} alt={receive.symbol} size={14} /> {receive.symbol}
              </p>
            </div>
          </div>
        </div>

        <ol className="flex flex-col">
          {steps.map((s, i) => {
            const done = busy && i < at;
            return (
              <li key={s.title} className="relative flex gap-3 pb-4 last:pb-0">
                {i < steps.length - 1 && <span aria-hidden className="absolute bottom-0 left-[15px] top-8 w-px bg-line" />}
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold ${
                    done ? "bg-accent text-accent-ink" : s.active ? "bg-accent/15 text-accent ring-1 ring-accent/60" : "bg-surface-2 text-muted"
                  }`}
                >
                  {done ? "✓" : s.active ? <span className="size-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent" /> : (s.icon ?? i + 1)}
                </span>
                <div className="flex min-w-0 flex-col gap-0.5 pt-1">
                  <p className={`font-medium ${s.active ? "text-accent" : ""}`}>{s.title}</p>
                  <p className="text-sm text-muted">{s.text}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <details className="group rounded-2xl border border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm text-muted hover:text-text [&::-webkit-details-marker]:hidden">
            What exactly you sign
            <span className="transition group-open:rotate-90"><Chevron /></span>
          </summary>
          <div className="flex flex-col gap-3 px-4 pb-4">
            <ListCard>
              <ListRow label="Action" value={<span className="font-mono text-sm">{jar ? "update_jar" : "create_jar"}</span>} />
              <ListRow label="Title" value={<span className="line-clamp-1 max-w-48">{d.title}</span>} />
              <ListRow label="Goal" value={d.goalOn ? money(Number(d.goal), 0) : "No goal"} />
              <ListRow label="Receive" value={receive.symbol} />
              <ListRow label="Page" hint="cover, photo, milestones, amounts, note, links" value={images ? `${images} image${images === 1 ? "" : "s"} · fingerprint` : "fingerprint"} />
            </ListCard>
            <p className="text-xs text-muted">
              The story and the fields above are stored by the NearJar contract. Images and the rest of the page are stored by NearJar; the signed text carries
              their sha256 fingerprint, so nobody can change them without your signature.
            </p>
          </div>
        </details>

        {error && <p className="text-sm text-danger">{error}</p>}
        <button type="button" onClick={sign} disabled={busy}
          className="flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-3.5 font-medium text-accent-ink disabled:opacity-60">
          {busy && <span className="size-4 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" />}
          {stage === "prepare" ? "Preparing…" : stage === "sign" ? `Waiting for ${wallet.name}…` : stage === "save" ? (jar ? "Saving on NEAR…" : "Creating the jar on NEAR…") : `Sign in ${wallet.name}`}
        </button>
        <p className="-mt-2 text-center text-xs text-muted">No gas · no transaction · $0</p>
      </div>
    </Modal>
  );
}

async function post(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}

