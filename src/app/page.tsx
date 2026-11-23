import { redirect } from "next/navigation";
import { pageUser } from "@/lib/http";
import GameClient from "@/client/GameClient";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await pageUser();
  if (!user) redirect("/login");
  return <GameClient />;
}
