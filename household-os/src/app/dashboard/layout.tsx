import { requireMembership } from "@/lib/session";
import { TopHeader } from "@/components/layout/top-header";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { BottomTabBar } from "@/components/layout/bottom-tab-bar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { member, household } = await requireMembership();

  return (
    <div className="flex flex-1 flex-col">
      <TopHeader household={household} member={member} />
      <div className="flex flex-1">
        <SidebarNav role={member.role} />
        <main className="flex-1 overflow-x-hidden pb-20 md:pb-0">{children}</main>
      </div>
      <BottomTabBar role={member.role} />
    </div>
  );
}
