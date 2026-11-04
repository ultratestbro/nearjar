// NearJar mark (logo round 3, variant 6b): a mint jar with the official NEAR "N" on its body,
// a grey orbit behind it and three chain coins on the orbit. Shared by the header, the favicon
// and the rendered PNG icons, so every copy draws the same geometry in a 120×120 box.

/** The official NEAR "N" glyph, from NEAR's 512×512 app icon (glyph only, no tile). */
export const NEAR_N_PATH =
  "M374.461 105.525a32.07 32.07 0 0 0-27.337 15.287l-62.934 93.402c-2.047 3.087-1.218 7.236 1.852 9.286a6.7 6.7 0 0 0 8.064-.494l61.935-53.715a2.503 2.503 0 0 1 3.533.197 2.6 2.6 0 0 1 .633 1.704v168.183c0 1.383-1.145 2.495-2.534 2.495a2.5 2.5 0 0 1-1.924-.89L168.58 116.86a32.21 32.21 0 0 0-24.462-11.36h-6.554c-17.713 0-32.064 14.349-32.064 32.056v236.863c-.024 17.708 14.326 32.056 32.039 32.056a32.07 32.07 0 0 0 27.337-15.287l62.934-93.402c2.047-3.087 1.218-7.236-1.852-9.286a6.7 6.7 0 0 0-8.064.494l-61.935 53.715a2.503 2.503 0 0 1-3.533-.197 2.6 2.6 0 0 1-.633-1.704V172.575c0-1.383 1.145-2.494 2.534-2.494.731 0 1.437.321 1.924.889l187.145 224.17a32.21 32.21 0 0 0 24.462 11.36h6.554c17.713 0 32.064-14.324 32.088-32.031V137.581c.024-17.708-14.326-32.056-32.039-32.056";

/** NEAR's brand green and the tile it sits on in the "Built on NEAR" badge. */
export const NEAR_GREEN = "#00EC97";

export const JAR_LID = { x: 42, y: 22, width: 36, height: 9, rx: 4 };
export const JAR_BODY = "M38 36h44v46c0 9-7 16-16 16H54c-9 0-16-7-16-16z";
/** Scales the 512-box glyph to ~33 px and centres it on the jar body (60, 67). */
export const JAR_N_TRANSFORM = "translate(31.84 38.84) scale(0.11)";
export const ORBIT = { cx: 60, cy: 66, rx: 54, ry: 18 };
/** Solana, Base and Bitcoin coins riding the orbit. */
export const COINS = [
  { cx: 8, cy: 64, r: 6, fill: "#9945FF" },
  { cx: 110, cy: 72, r: 6, fill: "#0052FF" },
  { cx: 92, cy: 52, r: 4.5, fill: "#F7931A" },
];
