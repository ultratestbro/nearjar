import { COVER_GRADIENTS, imageUrl, type JarPageData } from "@/lib/pageData";
import { LogoMark } from "./Logo";

type Art = Pick<JarPageData, "cover" | "coverColor" | "avatar">;

/** The jar's cover: the uploaded photo, else the picked gradient with the NearJar mark. */
export function JarCover({ page, legacyImage, className = "", mark = true }: { page: Art; legacyImage?: string | null; className?: string; mark?: boolean }) {
  const src = page.cover ? imageUrl(page.cover) : legacyImage;
  if (src) return <img src={src} alt="" className={`object-cover ${className}`} />;
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: COVER_GRADIENTS[page.coverColor] ?? COVER_GRADIENTS[0] }}>
      {mark && (
        <span className="absolute -bottom-3 right-4 opacity-25">
          <LogoMark size={96} orbit={false} />
        </span>
      )}
    </div>
  );
}

/** The creator's photo or logo; the jar's first letter on its gradient otherwise. */
export function JarAvatar({ page, title, size = 48, className = "" }: { page: Art; title: string; size?: number; className?: string }) {
  const style = { width: size, height: size };
  if (page.avatar) return <img src={imageUrl(page.avatar)} alt="" style={style} className={`shrink-0 rounded-full object-cover ${className}`} />;
  return (
    <span
      style={{ ...style, background: COVER_GRADIENTS[page.coverColor] ?? COVER_GRADIENTS[0], fontSize: size * 0.42 }}
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-text ${className}`}
    >
      {(title.trim() || "J").slice(0, 1).toUpperCase()}
    </span>
  );
}

const LINK_LABEL = { website: "Website", x: "X", telegram: "Telegram", youtube: "YouTube" } as const;

export function JarLinks({ links }: { links: JarPageData["links"] }) {
  const items = (Object.keys(LINK_LABEL) as (keyof typeof LINK_LABEL)[]).filter((k) => links[k]);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((k) => (
        <a key={k} href={links[k]} target="_blank" rel="noopener nofollow ugc" className="rounded-full border border-line px-3 py-1 text-sm text-muted hover:bg-surface hover:text-text">
          {LINK_LABEL[k]} ↗
        </a>
      ))}
    </div>
  );
}
