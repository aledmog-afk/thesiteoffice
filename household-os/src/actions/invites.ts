"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOwner, getAuthedUser } from "@/lib/session";
import { sendInviteEmail } from "@/lib/email";

export type FormState = { error?: string } | undefined;

export async function createInviteAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "adult") as "adult" | "child";

  if (!email) return { error: "Enter an email address to invite." };

  const { member, household } = await requireOwner();
  const supabase = await createClient();

  const { data: invite, error } = await supabase
    .from("invites")
    .insert({ household_id: household.id, email, role, invited_by: member.user_id })
    .select()
    .single();

  if (error) return { error: error.message };

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  await sendInviteEmail({
    to: email,
    householdName: household.name,
    inviterName: member.display_name,
    acceptUrl: `${origin}/invite/${invite.token}`,
  });

  revalidatePath("/dashboard/settings/household");
}

export async function revokeInviteAction(inviteId: string) {
  const { household } = await requireOwner();
  const supabase = await createClient();
  await supabase
    .from("invites")
    .update({ status: "revoked" })
    .eq("id", inviteId)
    .eq("household_id", household.id);
  revalidatePath("/dashboard/settings/household");
}

export async function acceptInviteAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const user = await getAuthedUser();
  if (!user) redirect(`/login?next=/invite/${token}`);

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_invite", { p_token: token });
  if (error) return { error: error.message };

  redirect("/dashboard");
}
