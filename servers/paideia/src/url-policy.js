import { isIP } from "node:net";

function policyError(message, details = {}) {
  const error = new Error(message);
  error.code = "url_not_allowed";
  error.details = details;
  return error;
}

function privateAddress(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (isIP(host) === 4) {
    const parts = host.split(".").map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 0
    );
  }
  if (isIP(host) === 6) {
    return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8");
  }
  return false;
}

function exactOrigin(value) {
  const candidate = value.includes("://") ? value : `https://${value}`;
  const url = new URL(candidate);
  if (url.protocol !== "https:" || privateAddress(url.hostname)) {
    throw policyError("Paideia origins must use public HTTPS hosts");
  }
  return url.origin;
}

const SAFE_PATHS = [
  { pattern: /^\/my\/courses\.php$/, params: [] },
  { pattern: /^\/course\/view\.php$/, params: ["id"] },
  { pattern: /^\/mod\/(?:assign|quiz|resource|folder|url|forum)\/view\.php$/, params: ["id"] },
  { pattern: /^\/mod\/forum\/discuss\.php$/, params: ["d"] },
  { pattern: /^\/grade\/report\/user\/index\.php$/, params: ["id"] },
  { pattern: /^\/(?:webservice\/)?pluginfile\.php(?:\/|$)/, params: ["forcedownload"] },
  { pattern: /^\/mod\/[^/]+\/content(?:\/|$)/, params: ["forcedownload"] }
];

const FILE_PATHS = [
  /^\/(?:webservice\/)?pluginfile\.php(?:\/|$)/,
  /^\/mod\/resource\/view\.php$/,
  /^\/mod\/folder\/view\.php$/,
  /^\/mod\/[^/]+\/content(?:\/|$)/
];

function assertSafeQuery(url, allowed) {
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key)) {
      throw policyError("Paideia URL contains an unsafe action parameter", {
        parameter: key
      });
    }
  }
}

export function createPaideiaUrlPolicy({
  baseUrl,
  readOrigins = [],
  authHosts = ["pandora.pucp.edu.pe"]
}) {
  const base = new URL(baseUrl);
  const baseOrigin = exactOrigin(base.origin);
  const allowedReadOrigins = new Set([
    baseOrigin,
    ...readOrigins.filter(Boolean).map(exactOrigin)
  ]);
  const authOrigins = new Set([
    ...allowedReadOrigins,
    ...authHosts.filter(Boolean).map(exactOrigin)
  ]);

  function parse(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw policyError("Paideia URL is invalid");
    }
    if (url.protocol !== "https:" || privateAddress(url.hostname)) {
      throw policyError("Paideia URL must use a public HTTPS host");
    }
    return url;
  }

  function assertNavigation(value, { allowAuth = false } = {}) {
    const url = parse(value);
    if (allowAuth && authOrigins.has(url.origin)) {
      return url;
    }
    if (!allowedReadOrigins.has(url.origin)) {
      throw policyError("Paideia URL origin is not allowlisted");
    }
    const registration = SAFE_PATHS.find(({ pattern }) => pattern.test(url.pathname));
    if (!registration) {
      throw policyError("Paideia URL path is not a safe read endpoint", {
        path: url.pathname
      });
    }
    assertSafeQuery(url, registration.params);
    return url;
  }

  function assertCredentialOrigin(value) {
    const url = parse(value);
    if (!authOrigins.has(url.origin)) {
      throw policyError("Credentials may only be filled on an allowlisted auth origin");
    }
    return url;
  }

  function assertOrigin(value) {
    const url = parse(value);
    if (!authOrigins.has(url.origin)) {
      throw policyError("Paideia request origin is not allowlisted");
    }
    return url.origin;
  }

  function assertFileEndpoint(value) {
    const url = assertNavigation(value);
    if (!FILE_PATHS.some((pattern) => pattern.test(url.pathname))) {
      throw policyError("Wrapper link is not a known Moodle file endpoint");
    }
    return url;
  }

  return {
    baseOrigin,
    readOrigins: [...allowedReadOrigins],
    authOrigins: [...authOrigins],
    assertCredentialOrigin,
    assertFileEndpoint,
    assertNavigation,
    assertOrigin
  };
}
