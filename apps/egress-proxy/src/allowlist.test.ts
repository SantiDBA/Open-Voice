import { describe, expect, it } from "vitest";

import {
  isBlockedAddress,
  isDomainAllowed,
  normalizeHost,
  parseIpv6
} from "./allowlist.js";
import { parseAuthority } from "./proxy.js";

describe("normalizeHost", () => {
  it("lowercases, strips URL brackets and a trailing root dot", () => {
    expect(normalizeHost("Example.COM")).toBe("example.com");
    expect(normalizeHost("[::1]")).toBe("::1");
    expect(normalizeHost("example.com.")).toBe("example.com");
    expect(normalizeHost("  api.example.com  ")).toBe("api.example.com");
  });
});

describe("isDomainAllowed", () => {
  it("denies everything when the allowlist is empty", () => {
    expect(isDomainAllowed("example.com", [])).toBe(false);
  });

  it("matches an exact name only", () => {
    expect(isDomainAllowed("example.com", ["example.com"])).toBe(true);
    expect(isDomainAllowed("api.example.com", ["example.com"])).toBe(false);
  });

  it("matches subdomains for a wildcard, but never the apex", () => {
    const allowlist = ["*.example.com"];
    expect(isDomainAllowed("api.example.com", allowlist)).toBe(true);
    expect(isDomainAllowed("a.b.example.com", allowlist)).toBe(true);
    expect(isDomainAllowed("example.com", allowlist)).toBe(false);
    expect(isDomainAllowed("notexample.com", allowlist)).toBe(false);
    expect(isDomainAllowed("example.com.evil.test", allowlist)).toBe(false);
  });

  it("treats a bare star as allow-everything", () => {
    expect(isDomainAllowed("anything.test", ["*"])).toBe(true);
  });

  it("normalizes both sides of the comparison", () => {
    expect(isDomainAllowed("API.Example.com", ["*.EXAMPLE.com"])).toBe(true);
  });

  it("refuses an empty host", () => {
    expect(isDomainAllowed("", ["*"])).toBe(false);
  });
});

describe("parseIpv6", () => {
  it("expands the compressed form", () => {
    expect([...parseIpv6("::1")!]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect([...parseIpv6("2606:4700:4700::1111")!]).toEqual([
      0x26, 0x06, 0x47, 0x00, 0x47, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0x11, 0x11
    ]);
  });

  it("folds an embedded IPv4 address", () => {
    expect([...parseIpv6("::ffff:127.0.0.1")!]).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 127, 0, 0, 1
    ]);
  });

  it("rejects a malformed address", () => {
    expect(parseIpv6("12345::")).toBeNull();
    expect(parseIpv6("::1::2")).toBeNull();
    expect(parseIpv6("example.com")).toBeNull();
  });
});

describe("isBlockedAddress", () => {
  it("blocks loopback, private, link-local and metadata", () => {
    for (const address of [
      "127.0.0.1",
      "0.0.0.0",
      "10.1.2.3",
      "172.16.5.5",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "224.0.0.1"
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("blocks the IPv6 equivalents", () => {
    for (const address of [
      "::",
      "::1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:169.254.169.254",
      "64:ff9b::127.0.0.1",
      "2002:7f00:1::1"
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const address of [
      "8.8.8.8",
      "1.1.1.1",
      "93.184.216.34",
      "151.101.1.140",
      "2606:4700:4700::1111",
      "2a00:1450:4001:800::200e"
    ]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it("refuses anything that is not an address at all", () => {
    expect(isBlockedAddress("example.com")).toBe(true);
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });
});

describe("parseAuthority", () => {
  it("reads host:port and defaults a bare host to 443", () => {
    expect(parseAuthority("example.com")).toEqual({ host: "example.com", port: 443 });
    expect(parseAuthority("example.com:8443")).toEqual({
      host: "example.com",
      port: 8443
    });
  });

  it("handles bracketed IPv6", () => {
    expect(parseAuthority("[::1]:8080")).toEqual({ host: "::1", port: 8080 });
  });

  it("rejects a malformed authority", () => {
    expect(parseAuthority("")).toBeNull();
    expect(parseAuthority("example.com:0")).toBeNull();
    expect(parseAuthority("example.com:70000")).toBeNull();
    expect(parseAuthority(":443")).toBeNull();
  });
});
