/** TON Connect app manifest; wallets fetch it to show who is asking. */
export function GET(request: Request) {
  const origin = process.env.NEARJAR_PUBLIC_URL ?? new URL(request.url).origin;
  return Response.json({ url: origin, name: "NearJar", iconUrl: `${origin}/icon-180.png` });
}
