import Link from "next/link";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Household OS
          </Link>
          <h1 className="mt-4 text-2xl font-semibold">Welcome back</h1>
          <p className="text-sm text-muted-foreground">Log in to your household</p>
        </div>
        <LoginForm next={next} />
        <p className="text-center text-sm text-muted-foreground">
          No account yet?{" "}
          <Link href="/signup" className="font-medium text-foreground underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
