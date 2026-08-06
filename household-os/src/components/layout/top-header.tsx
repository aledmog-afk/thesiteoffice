import Link from "next/link";
import { logOut } from "@/actions/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Household, Member } from "@/lib/types";

export function TopHeader({ household, member }: { household: Household; member: Member }) {
  const initials = member.display_name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
      <Link href="/dashboard" className="flex items-center gap-2">
        <span className="font-semibold tracking-tight">{household.name}</span>
        {household.plan === "free" && (
          <Badge variant="secondary" className="text-[10px]">
            Free plan
          </Badge>
        )}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger className="outline-none">
          <Avatar style={{ backgroundColor: member.color }}>
            <AvatarFallback className="bg-transparent text-white">{initials}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>
            {member.display_name}
            <div className="text-xs font-normal capitalize text-muted-foreground">{member.role}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/dashboard/settings/household">Household settings</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <form action={logOut}>
            <DropdownMenuItem asChild>
              <button type="submit" className="w-full text-left">
                Log out
              </button>
            </DropdownMenuItem>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
