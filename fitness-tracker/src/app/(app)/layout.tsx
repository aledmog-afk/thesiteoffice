import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/bottom-nav";
import { logout } from "../(auth)/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) {
    redirect("/login");
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Fitness Tracker</span>
        <form action={logout}>
          <button
            type="submit"
            aria-label="Log out"
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            <LogOut size={16} />
            Log out
          </button>
        </form>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-24 pt-4">{children}</main>

      <BottomNav />
    </div>
  );
}
