import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Household, Member } from "@/lib/types";

export async function getAuthedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Current user's membership + household. Assumes one household per member (MVP). */
export async function getCurrentMembership(): Promise<{
  member: Member;
  household: Household;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("household_members")
    .select("*, households(*)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const { households, ...member } = data as unknown as Member & { households: Household };
  return { member, household: households };
}

export async function requireMembership() {
  const membership = await getCurrentMembership();
  if (!membership) redirect("/onboarding");
  return membership;
}

export async function requireAdult() {
  const membership = await requireMembership();
  if (membership.member.role === "child") redirect("/dashboard");
  return membership;
}

export async function requireOwner() {
  const membership = await requireMembership();
  if (membership.member.role !== "owner") redirect("/dashboard");
  return membership;
}
