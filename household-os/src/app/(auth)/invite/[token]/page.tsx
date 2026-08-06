import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AcceptInviteForm } from "./accept-invite-form";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_invite_by_token", { p_token: token });
  const invite = data?.[0];
  const user = await getAuthedUser();

  if (!invite) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <Card className="w-full max-w-sm text-center">
          <CardHeader>
            <CardTitle>Invite not found</CardTitle>
            <CardDescription>This invite link is invalid.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle>Join {invite.household_name}</CardTitle>
          <CardDescription>
            You&apos;ve been invited as {invite.role === "child" ? "a child account" : "an adult"}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {invite.status !== "pending" ? (
            <p className="text-sm text-muted-foreground">This invite has already been used.</p>
          ) : !user ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Log in or create an account with <strong>{invite.email}</strong> to accept.
              </p>
              <div className="flex justify-center gap-2">
                <Button asChild>
                  <Link href={`/signup?next=/invite/${token}`}>Sign up</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/login?next=/invite/${token}`}>Log in</Link>
                </Button>
              </div>
            </div>
          ) : (
            <AcceptInviteForm token={token} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
