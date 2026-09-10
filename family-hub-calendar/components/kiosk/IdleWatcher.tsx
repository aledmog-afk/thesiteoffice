'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const FRAME_PATH = '/frame';

/**
 * Sends the wall display to the photo frame after inactivity, and brings it
 * back on the first touch.
 *
 * §2.6: the frame is the *default* state of a wall tablet, not a screensaver
 * bolted on, so the first tap exits it and lands on something useful rather
 * than merely dismissing an overlay. That exit tap is swallowed by the frame
 * itself so it cannot also activate whatever was underneath.
 */
export function IdleWatcher({ idleSeconds }: { idleSeconds: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Where to return to when someone touches the frame.
  const lastActivePathRef = useRef<string>('/display');

  useEffect(() => {
    if (pathname !== FRAME_PATH) lastActivePathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (idleSeconds <= 0) return; // 0 disables idle mode entirely

    function schedule() {
      if (timerRef.current) clearTimeout(timerRef.current);
      // No point counting down while already on the frame.
      if (pathname === FRAME_PATH) return;
      timerRef.current = setTimeout(() => {
        router.push(FRAME_PATH);
      }, idleSeconds * 1000);
    }

    function onActivity() {
      schedule();
    }

    schedule();

    // pointerdown rather than click: a scroll or a long press is activity too.
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    window.addEventListener('wheel', onActivity, { passive: true });

    // A tablet returning to the foreground has been idle by definition, so the
    // countdown restarts rather than continuing from where it froze.
    const onVisible = () => {
      if (document.visibilityState === 'visible') schedule();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('wheel', onActivity);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [idleSeconds, pathname, router]);

  return null;
}

/** Where the frame should return to. Exported so the frame can use it. */
export const DEFAULT_EXIT_PATH = '/display';
