import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { isBlockedAddress, isDomainAllowed, normalizeHost } from "@open-voice/egress-proxy";
import { parseBoolean, parseNumber, parsePort } from "./config.js";
import { checkSsrF, validateUrl } from "./server.js";

import type { BrowserbotConfig } from "./config.js";

const baseConfig: BrowserbotConfig = {
  host: "127.0.0.1",
  port: 8792,
  width: 1280,
  height: 800,
  dryRun: false,
  egressAllowlist: ["html.duckduckgo.com"],
  timeoutMs: 30_000
};

describe("checkSsrF", () => {
  test("refuses an allowlisted domain that resolves to a private IP (localhost)", async () => {
    // localhost is on the allowlist but resolves to 127.0.0.1 (loopback),
    // which must be rejected by the SSRF check even though it passes the
    // egress allowlist.
    await assert.rejects(
      () => checkSsrF("localhost", ["localhost"]),
      /SSRF protection/
    );
  });

  test("refuses the cloud metadata endpoint", async () => {
    await assert.rejects(
      () => checkSsrF("169.254.169.254", ["169.254.169.254"]),
      /SSRF protection/
    );
  });

  test("refuses a domain not on the egress allowlist (no DNS lookup, fail fast)", async () => {
    // evil.example.com is not on the allowlist, so it is rejected before any
    // DNS lookup is attempted — no DNS leak.
    await assert.rejects(
      () => checkSsrF("evil.example.com", ["html.duckduckgo.com"]),
      /not on the egress allowlist/
    );
  });

  test("allows a public domain on the egress allowlist", async () => {
    // example.com is on the allowlist and resolves to a public IP (93.184.216.34).
    // This requires real DNS to resolve, so we mark it as needing network.
    await checkSsrF("example.com", ["example.com"]);
  });
});

describe("validateUrl", () => {
  test("rejects non-https URLs", async () => {
    await assert.rejects(
      () => validateUrl("http://example.com", baseConfig),
      /only https/
    );
  });

  test("rejects invalid URLs", async () => {
    await assert.rejects(
      () => validateUrl("not-a-url", baseConfig),
      /invalid URL/
    );
  });

  test("rejects empty URLs", async () => {
    await assert.rejects(
      () => validateUrl("", baseConfig),
      /url must be a non-empty string/
    );
  });

  // SSRF tests use a config with empty egress allowlist so the SSRF check
  // (not the allowlist) is what runs for these IP-based hostnames.
  const ssrfConfig: BrowserbotConfig = { ...baseConfig, egressAllowlist: [] };

  test("rejects localhost (SSRF)", async () => {
    await assert.rejects(
      () => validateUrl("https://localhost/", ssrfConfig),
      /SSRF protection/
    );
  });

  test("rejects the metadata endpoint (SSRF)", async () => {
    await assert.rejects(
      () => validateUrl("https://169.254.169.254/", ssrfConfig),
      /SSRF protection/
    );
  });
});

describe("config parsing", () => {
  test("parseBoolean accepts canonical forms", () => {
    assert.equal(parseBoolean("true", false), true);
    assert.equal(parseBoolean("false", true), false);
    assert.equal(parseBoolean("1", false), true);
    assert.equal(parseBoolean("0", true), false);
    assert.equal(parseBoolean("yes", false), true);
    assert.equal(parseBoolean("no", true), false);
    assert.equal(parseBoolean(undefined, true), true);
    assert.equal(parseBoolean(undefined, false), false);
  });

  test("parseBoolean rejects invalid values", () => {
    assert.throws(() => parseBoolean("maybe", false), /invalid boolean/);
  });

  test("parsePort accepts valid ports", () => {
    assert.equal(parsePort("8792", 0), 8792);
    assert.equal(parsePort(undefined, 8792), 8792);
  });

  test("parsePort rejects invalid ports", () => {
    assert.throws(() => parsePort("abc", 0), /invalid port/);
    assert.throws(() => parsePort("0", 0), /invalid port/);
    assert.throws(() => parsePort("70000", 0), /invalid port/);
  });

  test("parseNumber accepts positive integers", () => {
    assert.equal(parseNumber("4096", 100), 4096);
    assert.equal(parseNumber(undefined, 100), 100);
  });

  test("parseNumber rejects non-positive or non-integer", () => {
    assert.throws(() => parseNumber("abc", 100), /invalid numeric/);
    assert.throws(() => parseNumber("0", 100), /invalid numeric/);
    assert.throws(() => parseNumber("-5", 100), /invalid numeric/);
    assert.throws(() => parseNumber("1.5", 100), /invalid numeric/);
  });
});

describe("egress-proxy functions", () => {
  test("normalizeHost strips brackets and trailing dots", () => {
    assert.equal(normalizeHost("[::1]"), "::1");
    assert.equal(normalizeHost("example.com."), "example.com");
    assert.equal(normalizeHost("  EXAMPLE.COM  "), "example.com");
  });

  test("isBlockedAddress rejects loopback and private ranges", () => {
    assert.equal(isBlockedAddress("127.0.0.1"), true);
    assert.equal(isBlockedAddress("::1"), true);
    assert.equal(isBlockedAddress("10.0.0.1"), true);
    assert.equal(isBlockedAddress("192.168.1.1"), true);
    assert.equal(isBlockedAddress("169.254.169.254"), true);
    assert.equal(isBlockedAddress("172.16.0.1"), true);
    assert.equal(isBlockedAddress("8.8.8.8"), false);
  });

  test("isDomainAllowed supports wildcards", () => {
    assert.equal(isDomainAllowed("api.example.com", ["*.example.com"]), true);
    assert.equal(isDomainAllowed("a.b.example.com", ["*.example.com"]), true);
    assert.equal(isDomainAllowed("example.com", ["*.example.com"]), false);
    assert.equal(isDomainAllowed("evil.com", ["*.example.com"]), false);
  });
});
