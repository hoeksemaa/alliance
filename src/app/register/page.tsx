import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { pageUser } from "@/lib/http";
import AuthForm from "@/client/AuthForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Make an account · Alliance" };

export default async function Register() {
  if (await pageUser()) redirect("/");
  return <AuthForm mode="register" />;
}
