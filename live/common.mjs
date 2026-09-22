import {
  ConfigValidationError,
  HttpResponseError,
  NetworkRequestError,
  PayloadValidationError,
  RequestTimeoutError,
  ResultUnknownError,
  redact,
} from "./errors.mjs";

export const DEFAULT_META_GRAPH_BASE_URL = "https://graph.facebook.com/v26.0";
export const DEFAULT_THREADS_GRAPH_BASE_URL = "https://graph.threads.com";
export const DEFAULT_X_API_BASE_URL = "https://api.x.com";

export function requireFetch(fetchImpl, platform) {
  if (typeof fetchImpl !== "function") {
    throw new ConfigValidationError(platform, "fetch", "must be dependency-injected");
  }
  return fetchImpl;
}

export function requireString(value, platform, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigValidationError(platform, field);
  }
  return value.trim();
}

export function requireIdentifier(value, platform, field) {
  const identifier = requireString(value, platform, field);
  if (!/^[A-Za-z0-9._-]+$/.test(identifier)) {
    throw new ConfigValidationError(platform, field, "contains invalid characters");
  }
  return identifier;
}

export function normalizeHttpsBaseUrl(value, fallback, platform, field = "base_url") {
  const candidate = value == null ? fallback : requireString(value, platform, field);
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ConfigValidationError(platform, field, "must be an absolute HTTPS URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ConfigValidationError(platform, field, "must be a credential-free HTTPS base URL");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function readText(payload, platform) {
  const text = payload?.text ?? payload?.body;
  if (typeof text !== "string" || text.trim() === "") {
    throw new PayloadValidationError(platform, "text", "is required");
  }
  return text;
}

export function requirePublicHttpsUrl(value, platform, field = "media_url") {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new PayloadValidationError(platform, field, "must be a public HTTPS URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname) {
    throw new PayloadValidationError(platform, field, "must be a public HTTPS URL");
  }
  return parsed.toString();
}

export function formBody(values) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value != null) body.set(key, String(value));
  }
  return body;
}

async function safeResponseSummary(response, secrets) {
  try {
    const value = await response.clone().json();
    const error = value?.error;
    if (!error || typeof error !== "object") return null;
    return redact({
      type: error.type ?? null,
      code: error.code ?? null,
      subcode: error.error_subcode ?? null,
    }, secrets);
  } catch {
    return null;
  }
}

export async function requestJson({
  fetch: fetchImpl,
  platform,
  url,
  method = "GET",
  accessToken,
  body = undefined,
  contentType = null,
  extraHeaders = {},
  timeoutMs = 15_000,
  operation,
  outcomeMayHaveCommitted = false,
}) {
  requireFetch(fetchImpl, platform);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let response;
  try {
    const headers = { ...extraHeaders, Accept: "application/json", Authorization: `Bearer ${accessToken}` };
    if (contentType) headers["Content-Type"] = contentType;
    response = await fetchImpl(url, { method, headers, body, signal: controller.signal });
  } catch {
    if (outcomeMayHaveCommitted) throw new ResultUnknownError(platform, operation);
    if (timedOut) throw new RequestTimeoutError(platform, operation);
    throw new NetworkRequestError(platform, operation);
  } finally {
    clearTimeout(timeout);
  }

  if (!response || typeof response.ok !== "boolean") {
    if (outcomeMayHaveCommitted) throw new ResultUnknownError(platform, operation);
    throw new NetworkRequestError(platform, operation);
  }
  if (!response.ok) {
    if (outcomeMayHaveCommitted && Number(response.status) >= 500) {
      throw new ResultUnknownError(platform, operation);
    }
    throw new HttpResponseError(
      platform,
      Number(response.status) || 0,
      await safeResponseSummary(response, [accessToken]),
    );
  }

  try {
    return await response.json();
  } catch {
    if (outcomeMayHaveCommitted) throw new ResultUnknownError(platform, operation);
    throw new NetworkRequestError(platform, operation);
  }
}

export function requireRemoteId(value, platform, operation) {
  const id = value?.id ?? value?.data?.id;
  if (typeof id !== "string" && typeof id !== "number") {
    throw new ResultUnknownError(platform, operation);
  }
  return String(id);
}

export function publishedResult(platform, remoteId, rawSummary = {}) {
  return {
    status: "published",
    remote_id: String(remoteId),
    permalink: null,
    published_at: null,
    raw_summary: redact({ platform, ...rawSummary }),
  };
}
