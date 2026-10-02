import { ASSETS } from "./generated/assets";

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const cache = new Map<string, Uint8Array>();

/** Serves the embedded client bundle with an SPA fallback to index.html. Returns null when nothing is embedded (dev). */
export function serveStatic(pathname: string): Response | null {
  if (!Object.keys(ASSETS).length) return null;
  const hit = ASSETS[pathname] ? pathname : ASSETS["/index.html"] ? "/index.html" : null;
  if (!hit) return null;
  let body = cache.get(hit);
  if (!body) {
    body = decode(ASSETS[hit].data);
    cache.set(hit, body);
  }
  const immutable = hit.startsWith("/assets/");
  const media = /\.(png|jpe?g|webp|svg|ico|woff2)$/.test(hit);
  return new Response(body, {
    headers: {
      "Content-Type": ASSETS[hit].type,
      "Cache-Control": immutable
        ? "public, max-age=31536000, immutable"
        : media
          ? "public, max-age=86400"
          : "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
