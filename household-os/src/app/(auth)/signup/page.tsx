import Link from "next/link";
import { SignupForm } from "./signup-form";

export default async function SignupPage({
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
          <h1 className="mt-4 text-2xl font-semibold">Create your account</h1>
          <p className="text-sm text-muted-foreground">
            You&apos;ll set up your household right after.
          </p>
        </div>
        <SignupForm next={next} />
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-foreground underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
