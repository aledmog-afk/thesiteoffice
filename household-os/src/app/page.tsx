import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  CalendarDays,
  ListChecks,
  ShoppingCart,
  Home as HomeIcon,
  PiggyBank,
  Sparkles,
} from "lucide-react";

const FEATURES = [
  {
    icon: CalendarDays,
    title: "Shared calendar",
    description: "Month, week, and day views with per-member color coding and calendar sync.",
  },
  {
    icon: ListChecks,
    title: "Tasks & routines",
    description: "One-off tasks and recurring chores that fairly rotate between members.",
  },
  {
    icon: ShoppingCart,
    title: "Shopping & recipes",
    description: "Real-time shared lists, auto-sorted by aisle, with a recipe box.",
  },
  {
    icon: HomeIcon,
    title: "Home reference",
    description: "Appliances, warranties, and maintenance reminders in one place.",
  },
  {
    icon: PiggyBank,
    title: "Shared finances",
    description: "Lightweight budget visibility and expense splitting, not full accounting.",
  },
  {
    icon: Sparkles,
    title: "One household, one app",
    description: "Everything Cozi, Todoist, and a chore chart do — without six different apps.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-4 sm:px-10">
        <span className="text-lg font-semibold tracking-tight">Household OS</span>
        <nav className="flex items-center gap-2">
          <Button variant="ghost" asChild>
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild>
            <Link href="/signup">Get started</Link>
          </Button>
        </nav>
      </header>

      <main className="flex flex-1 flex-col items-center px-6 py-16 text-center sm:px-10">
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
          Run your household from one place
        </h1>
        <p className="mt-4 max-w-xl text-lg text-muted-foreground">
          Calendar, chores, shopping lists, home admin, and finances — for every member of the
          household, in real time.
        </p>
        <div className="mt-8 flex gap-3">
          <Button size="lg" asChild>
            <Link href="/signup">Create your household</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/login">I already have an account</Link>
          </Button>
        </div>

        <div className="mt-20 grid w-full max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <Card key={feature.title} className="text-left">
              <CardContent className="flex flex-col gap-2 pt-6">
                <feature.icon className="h-6 w-6 text-primary" />
                <h3 className="font-semibold">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>

      <footer className="px-6 py-8 text-center text-sm text-muted-foreground sm:px-10">
        &copy; {new Date().getFullYear()} Household OS
      </footer>
    </div>
  );
}
