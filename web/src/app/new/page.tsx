import { Studio } from "@/components/Studio";
import { RECEIVE_ASSETS, assetIcon } from "@/lib/assets";

export default function NewJarPage() {
  return <Studio startNew assets={RECEIVE_ASSETS.map((a) => ({ ...a, icon: assetIcon(a.id) }))} />;
}
