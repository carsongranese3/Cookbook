// Shared helper for the video-extraction error shape (`{ error, code }`,
// see docs/api.md §8/§9 and `api.js`'s `request`/`upload` helpers).
//
// `api.js` mirrors the server's `body.error` onto `e.message` whenever the
// server actually sent a response — but if the JSON body was missing or
// unparseable it falls back to a generic "Request/Upload failed (N)" string,
// and if `fetch` itself threw (offline, DNS failure, etc.) there's no HTTP
// response at all, so no `.status`. Only trust `e.message` as the server's
// own wording in the former case; callers should fall back to a hardcoded
// string otherwise (network failure, an opaque response, or an empty body).
export function serverErrorMessage(e) {
  if (typeof e?.status !== 'number') return null; // no HTTP response at all
  const msg = e?.message;
  if (!msg) return null;
  if (/^(Request|Upload) failed \(\d+\)$/.test(msg)) return null; // api.js's own generic fallback, not the server's
  return msg;
}
