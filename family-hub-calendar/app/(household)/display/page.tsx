import Link from 'next/link';
import { RosterStrip } from './RosterStrip';

// Placeholder wall dashboard. Calendar, chores, meals and weather land here in
// build order steps 5, 6, 9 and 13; for now it proves the roster renders live.
export default function DisplayPage() {
  return (
    <main className="kiosk-nosel flex h-full flex-col gap-4 p-4">
      <RosterStrip />

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-2">
        <Link
          href="/calendar"
          className="flex flex-col items-start justify-center rounded-2xl bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-slate-800">Calendar</h2>
          <p className="text-sm text-slate-500">Day, week and month, colour-coded by member.</p>
        </Link>

        <Link
          href="/lists"
          className="flex flex-col items-start justify-center rounded-2xl bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-slate-800">Lists</h2>
          <p className="text-sm text-slate-500">Shopping and to-dos, shared live.</p>
        </Link>

        <Link
          href="/chores"
          className="flex flex-col items-start justify-center rounded-2xl bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-slate-800">Chores</h2>
          <p className="text-sm text-slate-500">This week&apos;s chart, with points.</p>
        </Link>

        {[
          { title: 'Weather', note: 'Step 9' },
          { title: 'Meals', note: 'Step 13' },
        ].map((panel) => (
          <section
            key={panel.title}
            className="flex flex-col items-start justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6"
          >
            <h2 className="text-lg font-semibold text-slate-700">{panel.title}</h2>
            <p className="text-sm text-slate-500">Not built yet — {panel.note}.</p>
          </section>
        ))}
      </div>

      <Link
        href="/settings/members"
        className="self-start rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
      >
        Manage family
      </Link>
    </main>
  );
}
