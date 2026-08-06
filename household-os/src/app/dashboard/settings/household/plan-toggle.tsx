"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { setPlanAction } from "@/actions/households";
import type { Plan } from "@/lib/types";

export function PlanToggle({ plan }: { plan: Plan }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-3">
      <Badge variant={plan === "paid" ? "default" : "secondary"} className="capitalize">
        {plan}
      </Badge>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => startTransition(() => setPlanAction(plan === "free" ? "paid" : "free"))}
      >
        {plan === "free" ? "Simulate upgrade to paid" : "Downgrade to free"}
      </Button>
    </div>
  );
}
