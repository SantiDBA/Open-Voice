/**
 * What the egress proxy will and will not connect to.
 *
 * Two independent checks, both required:
 *
 * 1. **The name is on the allowlist.** The allowlist starts empty, so the
 *    default is no egress at all.
 * 2. **The address it resolves to is public.** An allowed name that resolves to
 *    loopback, a private range or the cloud metadata address is refused. This
 *    is what stops an allowlisted name — or a DNS entry that changed, or a
 *    name the caller controls — from being used to reach the host's own
 *    services or the machine's metadata endpoint.
 */

/** Lowercases a host, strips a URL's IPv6 brackets and a trailing root dot. */
export function normalizeHost(value: string): string {
  let host = value.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  if (host.endsWith(".") && host.length > 1) {
    host = host.slice(0, -1);
  }
  return host;
}

/**
 * A host matches when it is listed exactly, or when a `*.suffix` entry covers a
 * subdomain of `suffix`.
 *
 * `*.example.com` matches `api.example.com` and `a.b.example.com`, but **not**
 * `example.com` — the apex has to be listed on its own. That is deliberate: a
 * wildcard that also matched the apex would quietly widen every entry.
 * A bare `*` allows everything and is documented as such.
 */
export function isDomainAllowed(
  host: string,
  patterns: readonly string[]
): boolean {
  const name = normalizeHost(host);
  if (name.length === 0) {
    return false;
  }

  for (const raw of patterns) {
    const pattern = normalizeHost(raw);
    if (pattern.length === 0) {
      continue;
    }
    if (pattern === "*") {
      return true;
    }
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(2);
      if (suffix.length > 0 && name.length > suffix.length + 1 && name.endsWith(`.${suffix}`)) {
        return true;
      }
      continue;
    }
    if (name === pattern) {
      return true;
    }
  }

  return false;
}

/** Parse a dotted quad into four bytes, or null when it is not one. */
export function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) {
      return null;
    }
    const parsed = Number(part);
    if (parsed > 255) {
      return null;
    }
    bytes.push(parsed);
  }
  return bytes;
}

/** Parse an IPv6 address (any text form, including `::` and embedded IPv4). */
export function parseIpv6(value: string): Uint8Array | null {
  const withoutZone = value.split("%")[0] ?? "";
  if (withoutZone.length === 0 || !withoutZone.includes(":")) {
    return null;
  }

  // `::ffff:1.2.3.4` and `64:ff9b::1.2.3.4` carry a dotted quad in the last
  // two groups; fold it into hex so one parser handles every form.
  const folded = foldEmbeddedIpv4(withoutZone);
  if (folded === null) {
    return null;
  }

  const halves = folded.split("::");
  if (halves.length > 2) {
    return null;
  }

  const left = parseGroups(halves[0] ?? "");
  if (left === null) {
    return null;
  }

  let groups: number[];
  if (halves.length === 2) {
    const right = parseGroups(halves[1] ?? "");
    if (right === null) {
      return null;
    }
    const missing = 8 - left.length - right.length;
    if (missing < 1) {
      return null;
    }
    groups = [...left, ...new Array<number>(missing).fill(0), ...right];
  } else {
    if (left.length !== 8) {
      return null;
    }
    groups = left;
  }

  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = (group >> 8) & 0xff;
    bytes[index * 2 + 1] = group & 0xff;
  });
  return bytes;
}

function parseGroups(text: string): number[] | null {
  if (text === "") {
    return [];
  }
  const out: number[] = [];
  for (const group of text.split(":")) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) {
      return null;
    }
    out.push(parseInt(group, 16));
  }
  return out;
}

function foldEmbeddedIpv4(value: string): string | null {
  const match = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match) {
    return value;
  }
  const quad = match.slice(2, 6).map(Number);
  if (quad.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  const high = ((quad[0]! << 8) | quad[1]!).toString(16);
  const low = ((quad[2]! << 8) | quad[3]!).toString(16);
  return `${match[1]}${high}:${low}`;
}

/** [network, prefix bits] pairs, as byte arrays. */
const BLOCKED_V4: ReadonlyArray<readonly [number[], number]> = [
  [[0, 0, 0, 0], 8], // "this network"
  [[10, 0, 0, 0], 8], // private
  [[100, 64, 0, 0], 10], // carrier-grade NAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local and the cloud metadata endpoint
  [[172, 16, 0, 0], 12], // private
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // TEST-NET-1
  [[192, 168, 0, 0], 16], // private
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // TEST-NET-2
  [[203, 0, 113, 0], 24], // TEST-NET-3
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4] // reserved
];

/** IPv6 prefixes, as a 16-byte network and a prefix length. */
const BLOCKED_V6: ReadonlyArray<readonly [number[], number]> = [
  [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 128], // ::
  [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 128], // ::1
  [[0xfc, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 7], // unique local
  [[0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 10], // link-local
  [[0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 8], // multicast
  [[0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 96], // NAT64
  [[0x20, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 16] // 6to4
];

function hasPrefix(
  bytes: Uint8Array | number[],
  network: readonly number[],
  bits: number
): boolean {
  const wholeBytes = Math.floor(bits / 8);
  for (let index = 0; index < wholeBytes; index += 1) {
    if (bytes[index] !== network[index]) {
      return false;
    }
  }
  const remainder = bits % 8;
  if (remainder === 0) {
    return true;
  }
  const mask = (0xff << (8 - remainder)) & 0xff;
  return (bytes[wholeBytes]! & mask) === (network[wholeBytes]! & mask);
}

/** True for loopback, private, link-local, multicast and metadata addresses. */
export function isBlockedAddress(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4) {
    return isBlockedIpv4(v4);
  }

  const v6 = parseIpv6(address);
  if (!v6) {
    // Not an address at all: refuse it rather than let it through unchecked.
    return true;
  }

  // `::ffff:a.b.c.d` and `::a.b.c.d` are IPv4 in IPv6 clothing; judge the v4.
  const isMapped = v6.subarray(0, 10).every((byte) => byte === 0);
  if (isMapped && v6[10] === 0xff && v6[11] === 0xff) {
    return isBlockedIpv4([v6[12]!, v6[13]!, v6[14]!, v6[15]!]);
  }
  if (isMapped && v6[10] === 0 && v6[11] === 0 && !(v6[12] === 0 && v6[13] === 0 && v6[14] === 0 && v6[15] === 0)) {
    return isBlockedIpv4([v6[12]!, v6[13]!, v6[14]!, v6[15]!]);
  }

  return BLOCKED_V6.some(([network, bits]) => hasPrefix(v6, network, bits));
}

function isBlockedIpv4(bytes: number[]): boolean {
  return BLOCKED_V4.some(([network, bits]) => hasPrefix(bytes, network, bits));
}
