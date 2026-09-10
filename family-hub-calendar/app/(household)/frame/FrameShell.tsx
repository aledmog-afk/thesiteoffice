'use client';

import { useRouter } from 'next/navigation';
import { ClockOverlay } from '@/components/kiosk/ClockOverlay';

export function FrameShell({
  timeZone,
  nextEvent,
}: {
  timeZone: string;
  nextEvent: { title: string; when: string; color: string } | null;
}) {
  const router = useRouter();

  return (
    // The exit tap is captured here and goes no further, so it cannot also
    // activate whatever it happens to land on once the app is back (§2.6).
    <div
      role="presentation"
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        router.push('/display');
      }}
      className="kiosk-nosel fixed inset-0 z-30 bg-slate-950"
    >
      <ClockOverlay timeZone={timeZone} nextEvent={nextEvent} />

      {/* Step 10 replaces this ground with the photo slideshow; the idle
          handoff and the exit behaviour are already what they will be then. */}
      <span className="absolute bottom-4 left-0 right-0 text-center text-xs text-white/30">
        Touch to wake · photo slideshow arrives in step 10
      </span>
    </div>
  );
}
