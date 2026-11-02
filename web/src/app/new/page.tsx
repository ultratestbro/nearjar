import { CreateJar } from "@/components/CreateJar";
import { RECEIVE_ASSETS } from "@/lib/assets";

export default function NewJarPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">Create a jar</h1>
      <CreateJar assets={RECEIVE_ASSETS} />
    </div>
  );
}
