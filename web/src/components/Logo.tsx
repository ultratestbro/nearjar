import { COINS, JAR_BODY, JAR_LID, JAR_N_TRANSFORM, NEAR_N_PATH, ORBIT } from "@/lib/brand";

/** The NearJar mark, cropped to its drawing (lid to orbit); `size` is its height. */
export function LogoMark({ size = 32, orbit = true }: { size?: number; orbit?: boolean }) {
  return (
    <svg width={(size * 120) / 80} height={size} viewBox="0 20 120 80" aria-hidden className="shrink-0">
      {orbit && <ellipse {...ORBIT} fill="none" stroke="#4a4a4a" strokeWidth="3" />}
      <rect {...JAR_LID} fill="var(--accent)" />
      <path d={JAR_BODY} fill="var(--accent)" />
      <path d={NEAR_N_PATH} transform={JAR_N_TRANSFORM} fill="var(--accent-ink)" />
      {orbit && COINS.map((c) => <circle key={c.fill} {...c} />)}
    </svg>
  );
}
