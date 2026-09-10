import { signIn } from './actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Family Hub</h1>
        <p className="mt-1 text-sm text-slate-600">Sign in with the household account.</p>

        <form action={signIn} className="mt-6 space-y-4">
          <input type="hidden" name="next" value={next ?? '/display'} />

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Email</span>
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              className="mt-1 block h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-slate-900"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1 block h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-slate-900"
            />
          </label>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="h-12 w-full rounded-xl bg-slate-900 text-base font-semibold text-white active:bg-slate-700"
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
