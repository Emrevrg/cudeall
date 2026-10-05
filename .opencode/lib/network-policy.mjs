import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isPublicIPv4(address) {
  const p = address.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && ((b === 0 && (p[2] === 0 || p[2] === 2)) || b === 168)) ||
    (a === 198 && ((b === 18 || b === 19) || (b === 51 && p[2] === 100))) ||
    (a === 203 && b === 0 && p[2] === 113)
  );
}

function isPublicIPv6(address) {
  const ip = address.toLowerCase().split("%")[0];
  if (ip.startsWith("::ffff:")) return isPublicIPv4(ip.slice(7));
  // Permit global-unicast 2000::/3 only. This excludes loopback, link-local,
  // unique-local, multicast, documentation, and transition ranges.
  return /^2[0-9a-f]{3}:/.test(ip) && !ip.startsWith("2001:db8:");
}

function assertPublicAddress(address) {
  const version = isIP(address);
  const allowed = version === 4 ? isPublicIPv4(address) : version === 6 && isPublicIPv6(address);
  if (!allowed) throw new Error("Guvenlik: yerel/ozel ag adreslerine web istegi engellendi.");
}

export async function assertPublicHttpUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error("Gecerli bir URL ver."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Guvenlik: yalnizca kimlik bilgisi icermeyen http(s) URL'leri desteklenir.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Guvenlik: yerel ag adreslerine web istegi engellendi.");
  }
  const directIp = isIP(host);
  const addresses = directIp ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length) throw new Error("DNS adresi bulunamadi.");
  for (const item of addresses) assertPublicAddress(item.address);
  return url;
}

export async function fetchPublicHttp(input, init = {}, maxRedirects = 5) {
  let url = await assertPublicHttpUrl(input);
  let headers = new Headers(init.headers || {});
  for (let hop = 0; hop <= maxRedirects; hop++) {
    // Resolve and validate every hop, including redirects, before connecting.
    await assertPublicHttpUrl(url.href);
    const response = await fetch(url, { ...init, headers, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    if (hop === maxRedirects) throw new Error("Yonlendirme siniri asildi.");
    const next = new URL(location, url);
    await assertPublicHttpUrl(next.href);
    await response.body?.cancel().catch(() => {});
    if (next.origin !== url.origin) {
      headers = new Headers(headers);
      headers.delete("authorization");
      headers.delete("cookie");
    }
    url = next;
  }
  throw new Error("Yonlendirme siniri asildi.");
}

export async function readLimitedText(response, maxBytes = 2_000_000) {
  const cap = Math.max(1, Math.floor(Number(maxBytes) || 2_000_000));
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) {
    throw new Error("Web yaniti guvenli boyut sinirini asti.");
  }
  const reader = response.body?.getReader();
  if (!reader) return { text: "", truncated: false };
  const chunks = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = cap - total;
    if (value.byteLength > remaining) {
      if (remaining > 0) chunks.push(value.subarray(0, remaining));
      total += Math.max(remaining, 0);
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { text: new TextDecoder().decode(bytes), truncated };
}
