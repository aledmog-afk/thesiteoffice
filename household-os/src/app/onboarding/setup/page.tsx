import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InviteMemberForm } from "./invite-member-form";
import { AddPropertyForm } from "./add-property-form";

export default async function OnboardingSetupPage() {
  const membership = await getCurrentMembership();
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();
  const [{ data: invites }, { data: properties }] = await Promise.all([
    supabase
      .from("invites")
      .select("*")
      .eq("household_id", membership.household.id)
      .eq("status", "pending"),
    supabase.from("properties").select("*").eq("household_id", membership.household.id),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold">Welcome to {membership.household.name}</h1>
        <p className="text-muted-foreground">A couple of quick steps before you dive in.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invite your household</CardTitle>
          <CardDescription>
            Adults get full access. Children see only their own tasks — no finances.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <InviteMemberForm />
          {invites && invites.length > 0 && (
            <ul className="space-y-1 text-sm">
              {invites.map((invite) => (
                <li key={invite.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span>{invite.email}</span>
                  <Badge variant="secondary">{invite.role}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add your first property</CardTitle>
          <CardDescription>
            You can add appliances, warranties, and maintenance reminders here later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AddPropertyForm />
          {properties && properties.length > 0 && (
            <ul className="space-y-1 text-sm">
              {properties.map((property) => (
                <li key={property.id} className="rounded-md border px-3 py-2">
                  {property.name}
                  {property.address ? ` — ${property.address}` : ""}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Button size="lg" asChild className="self-end">
        <Link href="/dashboard">Go to dashboard</Link>
      </Button>
    </div>
  );
}
