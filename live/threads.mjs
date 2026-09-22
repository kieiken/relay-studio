import {
  DEFAULT_THREADS_GRAPH_BASE_URL,
  formBody,
  normalizeHttpsBaseUrl,
  publishedResult,
  readText,
  requestJson,
  requireFetch,
  requireIdentifier,
  requireRemoteId,
  requireString,
} from "./common.mjs";

function threadsClient({ fetch, config = {}, timeoutMs } = {}) {
  const platform = "threads";
  return {
    platform,
    fetchImpl: requireFetch(fetch, platform),
    userId: requireIdentifier(config.threads_user_id ?? "me", platform, "threads_user_id"),
    accessToken: requireString(config.access_token, platform, "access_token"),
    baseUrl: normalizeHttpsBaseUrl(
      config.graph_base_url,
      DEFAULT_THREADS_GRAPH_BASE_URL,
      platform,
      "graph_base_url",
    ),
    timeoutMs,
  };
}

function threadsUrl(baseUrl, resource, fields = null) {
  const url = new URL(`${baseUrl}/${resource}`);
  if (fields) url.searchParams.set("fields", fields.join(","));
  return url.toString();
}

export async function fetchThreadsProfile(options = {}) {
  const client = threadsClient(options);
  return requestJson({
    fetch: client.fetchImpl,
    platform: client.platform,
    url: threadsUrl(client.baseUrl, encodeURIComponent(client.userId), ["id", "username", "name"]),
    accessToken: client.accessToken,
    timeoutMs: client.timeoutMs,
    operation: "reading authenticated Threads profile",
  });
}

export function matchesThreadsProfile(profile, expected) {
  const actualUsername = typeof profile?.username === "string"
    ? profile.username.replace(/^@/, "").toLowerCase()
    : "";
  const expectedUsername = typeof expected?.username === "string"
    ? expected.username.replace(/^@/, "").toLowerCase()
    : "";
  return actualUsername !== "" && actualUsername === expectedUsername;
}

export async function fetchThreadsPublishingLimit(options = {}) {
  const client = threadsClient(options);
  return requestJson({
    fetch: client.fetchImpl,
    platform: client.platform,
    url: threadsUrl(
      client.baseUrl,
      `${encodeURIComponent(client.userId)}/threads_publishing_limit`,
      ["quota_usage", "config"],
    ),
    accessToken: client.accessToken,
    timeoutMs: client.timeoutMs,
    operation: "reading Threads publishing quota",
  });
}

export async function fetchThreadsPost(remoteId, options = {}) {
  const client = threadsClient(options);
  const id = requireIdentifier(remoteId, client.platform, "remote_id");
  return requestJson({
    fetch: client.fetchImpl,
    platform: client.platform,
    url: threadsUrl(
      client.baseUrl,
      encodeURIComponent(id),
      ["id", "media_type", "permalink", "username", "text", "timestamp"],
    ),
    accessToken: client.accessToken,
    timeoutMs: client.timeoutMs,
    operation: "reading published Threads post",
  });
}

export function createThreadsLiveAdapter({ fetch, config = {}, timeoutMs } = {}) {
  const client = threadsClient({ fetch, config, timeoutMs });
  const { platform, fetchImpl, userId, accessToken, baseUrl } = client;

  return Object.freeze({
    platform,
    capabilities: Object.freeze({ live: true, media: ["text"] }),
    async publish(payload) {
      const containerResponse = await requestJson({
        fetch: fetchImpl,
        platform,
        url: `${baseUrl}/${encodeURIComponent(userId)}/threads`,
        method: "POST",
        accessToken,
        body: formBody({ media_type: "TEXT", text: readText(payload, platform) }),
        contentType: "application/x-www-form-urlencoded;charset=UTF-8",
        timeoutMs,
        operation: "creating text container",
        outcomeMayHaveCommitted: true,
      });
      const containerId = requireRemoteId(containerResponse, platform, "creating text container");
      const publishResponse = await requestJson({
        fetch: fetchImpl,
        platform,
        url: `${baseUrl}/${encodeURIComponent(userId)}/threads_publish`,
        method: "POST",
        accessToken,
        body: formBody({ creation_id: containerId }),
        contentType: "application/x-www-form-urlencoded;charset=UTF-8",
        timeoutMs,
        operation: "publishing text container",
        outcomeMayHaveCommitted: true,
      });
      const remoteId = requireRemoteId(publishResponse, platform, "publishing text container");
      return publishedResult(platform, remoteId, { container_id: containerId });
    },
  });
}
