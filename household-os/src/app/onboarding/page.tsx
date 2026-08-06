import { redirect } from "next/navigation";
import { getCurrentMembership } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CreateHouseholdForm } from "./create-household-form";

export default async function OnboardingPage() {
  const membership = await getCurrentMembership();
  if (membership) redirect("/onboarding/setup");

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Set up your household</CardTitle>
          <CardDescription>
            This creates your household&apos;s shared space. You can invite the rest of the family next.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateHouseholdForm />
        </CardContent>
      </Card>
    </div>
  );
}
