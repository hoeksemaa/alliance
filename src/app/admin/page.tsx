import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { pageUser } from "@/lib/http";
import AdminPanel from "@/client/AdminPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Alliance" };

export default async function Admin() {
  const user = await pageUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") notFound();
  return <AdminPanel />;
}
