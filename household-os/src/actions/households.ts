"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireMembership, requireOwner } from "@/lib/session";

export type FormState = { error?: string } | undefined;

export async function createHouseholdAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const householdName = String(formData.get("household_name") ?? "").trim();
  const displayName = String(formData.get("display_name") ?? "").trim();

  if (!householdName || !displayName) {
    return { error: "Household name and your name are both required." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("create_household", {
    p_name: householdName,
    p_display_name: displayName,
  });
  if (error) return { error: error.message };

  redirect("/onboarding/setup");
}

export async function addPropertyAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  if (!name) return { error: "Give the property a name, e.g. \"Home\"." };

  const { household } = await requireMembership();
  const supabase = await createClient();

  const { count } = await supabase
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("household_id", household.id);

  if (household.plan === "free" && (count ?? 0) >= 1) {
    return { error: "Free plan is limited to 1 property. Upgrade to add more." };
  }

  const { error } = await supabase.from("properties").insert({
    household_id: household.id,
    name,
    address: address || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/onboarding/setup");
}

export async function updateHouseholdNameAction(formData: FormData) {
  const { household } = await requireOwner();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const supabase = await createClient();
  await supabase.from("households").update({ name }).eq("id", household.id);
  revalidatePath("/dashboard/settings/household");
}

/** Billing gate stub: flips the plan flag only, no real payment processing. */
export async function setPlanAction(plan: "free" | "paid") {
  const { household } = await requireOwner();
  const supabase = await createClient();
  await supabase.from("households").update({ plan }).eq("id", household.id);
  revalidatePath("/dashboard/settings/household");
}
