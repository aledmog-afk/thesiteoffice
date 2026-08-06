import { CalendarDays, ListChecks, ShoppingCart, Home, Settings } from "lucide-react";
import type { Role } from "@/lib/types";

export interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
  hideFor?: Role[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Today", icon: Home },
  { href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/dashboard/tasks", label: "Tasks", icon: ListChecks },
  { href: "/dashboard/shopping", label: "Shopping", icon: ShoppingCart },
  { href: "/dashboard/settings/household", label: "Settings", icon: Settings, hideFor: ["child"] },
];
