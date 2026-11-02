import { MyJars } from "@/components/MyJars";

export default function MyJarsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">My jars</h1>
      <MyJars />
    </div>
  );
}
