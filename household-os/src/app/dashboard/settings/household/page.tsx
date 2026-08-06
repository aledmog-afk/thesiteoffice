import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { InviteMemberForm } from "@/app/onboarding/setup/invite-member-form";
import { AddPropertyForm } from "@/app/onboarding/setup/add-property-form";
import { RevokeInviteButton } from "./revoke-invite-button";
import { HouseholdNameForm } from "./household-name-form";
import { PlanToggle } from "./plan-toggle";

export default async function HouseholdSettingsPage() {
  const { member, household } = await requireMembership();
  const supabase = await createClient();

  const [{ data: members }, { data: invites }, { data: properties }] = await Promise.all([
    supabase.from("household_members").select("*").eq("household_id", household.id).order("created_at"),
    supabase
      .from("invites")
      .select("*")
      .eq("household_id", household.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase.from("properties").select("*").eq("household_id", household.id),
  ]);

  const isOwner = member.role === "owner";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Household settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Household name</CardTitle>
        </CardHeader>
        <CardContent>
          {isOwner ? <HouseholdNameForm defaultName={household.name} /> : <p>{household.name}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(members ?? []).map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
              <Avatar style={{ backgroundColor: m.color }} className="h-7 w-7">
                <AvatarFallback className="bg-transparent text-[10px] text-white">
                  {m.display_name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 font-medium">{m.display_name}</span>
              <Badge variant="secondary" className="capitalize">
                {m.role}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invite members</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InviteMemberForm />
            {invites && invites.length > 0 && (
              <ul className="space-y-1 text-sm">
                {invites.map((invite) => (
                  <li key={invite.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <span>
                      {invite.email} <span className="text-xs text-muted-foreground">({invite.role})</span>
                    </span>
                    <RevokeInviteButton inviteId={invite.id} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Properties</CardTitle>
          <CardDescription>
            {household.plan === "free" ? "Free plan: 1 property, limited storage." : "Unlimited properties."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <AddPropertyForm />
          <ul className="space-y-1 text-sm">
            {(properties ?? []).map((p) => (
              <li key={p.id} className="rounded-md border px-3 py-2">
                {p.name}
                {p.address ? ` — ${p.address}` : ""}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plan</CardTitle>
            <CardDescription>
              Billing isn&apos;t wired up yet — this toggle just flips the gate for testing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PlanToggle plan={household.plan} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
