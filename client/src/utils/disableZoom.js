/**
 * disableZoom — stop pinch-to-zoom and double-tap-to-zoom so the installed
 * PWA feels native, especially in full-screen Cooking Mode.
 *
 * WHY THIS FILE EXISTS (don't "simplify" it away):
 * `user-scalable=no` / `maximum-scale=1` in the viewport <meta> (see
 * client/index.html) is enough on Android Chrome, but iOS Safari has
 * IGNORED those viewport hints since iOS 10 — on purpose, including for
 * home-screen PWAs. On iPhone the meta tag alone does nothing. Killing
 * zoom there requires intercepting WebKit's proprietary gesture events at
 * the JS layer as well. All three pieces (meta tag, CSS touch-action, and
 * this module) work together: the meta tag covers Android, these listeners
 * cover iOS pinch, and the CSS covers double-tap. Removing this module
 * re-enables pinch-zoom on iPhone.
 *
 * What each listener below does:
 * - gesturestart/gesturechange/gestureend: WebKit-only events fired for the
 *   two-finger pinch gesture. preventDefault() on all three stops iOS from
 *   ever starting the pinch-zoom, regardless of the viewport meta.
 * - touchmove with more than one touch point: a second, older iOS path to
 *   pinch-zoom that doesn't always fire gesture* events. We ONLY
 *   preventDefault when `e.touches.length > 1` — a single-finger touchmove
 *   is left completely alone so normal scrolling, swipes, and drag-to-
 *   reorder (see .chip--draggable) keep working.
 *
 * These must be registered with { passive: false }, or the browser ignores
 * preventDefault() inside them (it assumes passive listeners never call it).
 */
export function disableZoom() {
  const preventGesture = (e) => e.preventDefault();

  document.addEventListener('gesturestart', preventGesture, { passive: false });
  document.addEventListener('gesturechange', preventGesture, { passive: false });
  document.addEventListener('gestureend', preventGesture, { passive: false });

  document.addEventListener(
    'touchmove',
    (e) => {
      // Only block multi-touch (pinch) moves. Never block single-finger
      // touchmove — that's normal scrolling/panning/swiping.
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    },
    { passive: false }
  );
}
