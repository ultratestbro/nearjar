import { Studio } from "@/components/Studio";
import { RECEIVE_ASSETS, assetIcon, studioCatalog } from "@/lib/assets";

export default function StudioPage() {
  return <Studio assets={RECEIVE_ASSETS.map((a) => ({ ...a, icon: assetIcon(a.id) }))} catalog={studioCatalog()} />;
}
