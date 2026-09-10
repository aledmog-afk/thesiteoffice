import Link from 'next/link';
import { ensureHousehold } from '@/lib/household';
import { DisplayForm } from './DisplayForm';

export default async function DisplaySettingsPage() {
  const { settings } = await ensureHousehold();

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link href="/display" className="text-sm font-medium text-slate-600">
        ← Back
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Display</h1>
      <p className="mt-1 mb-6 text-sm text-slate-600">
        Wall tablet behaviour. Weather location arrives with the weather widget in step 9.
      </p>

      <DisplayForm settings={settings} />
    </main>
  );
}
