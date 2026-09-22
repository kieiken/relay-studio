import {
  DEFAULT_META_GRAPH_BASE_URL,
  formBody,
  normalizeHttpsBaseUrl,
  publishedResult,
  readText,
  requestJson,
  requireFetch,
  requireIdentifier,
  requirePublicHttpsUrl,
  requireRemoteId,
  requireString,
} from "./common.mjs";
import { RemoteStateError, ResultUnknownError } from "./errors.mjs";

const READY = "FINISHED";
const TERMINAL_FAILURES = new Set(["ERROR", "EXPIRED"]);

function instagramClient({ fetch, config = {}, timeoutMs } = {}) {
  const platform = "instagram";
  return {
    platform,
    fetchImpl: requireFetch(fetch, platform),
    userId: requireIdentifier(config.ig_user_id ?? "me", platform, "ig_user_id"),
    accessToken: requireString(config.access_token, platform, "access_token"),
    baseUrl: normalizeHttpsBaseUrl(
      config.graph_base_url,
      DEFAULT_META_GRAPH_BASE_URL,
      platform,
      "graph_base_url",
    ),
    timeoutMs,
  };
}

function instagramUrl(baseUrl, resource, fields = null) {
  const url = new URL(`${baseUrl}/${resource}`);
  if (fields) url.searchParams.set("fields", fields.join(","));
  return url.toString();
}

export async function fetchInstagramProfile(options = {}) {
  const client = instagramClient(options);
  return requestJson({
    fetch: client.fetchImpl,
    platform: client.platform,
    url: instagramUrl(
      client.baseUrl,
      encodeURIComponent(client.userId),
      ["id", "user_id", "username", "name", "account_type"],
    ),
    accessToken: client.accessToken,
    timeoutMs: client.timeoutMs,
    operation: "reading authenticated Instagram profile",
  });
}

export function matchesInstagramProfile(profile, expected) {
  const actualUsername = typeof profile?.username === "string"
    ? profile.username.replace(/^@/, "").toLowerCase()
    : "";
  const expectedUsername = typeof expected?.username === "string"
    ? expected.username.replace(/^@/, "").toLowerCase()
    : "";
  return actualUsername !== "" && actualUsername === expectedUsername;
}

export async function fetchInstagramPublishingLimit(options = {}) {
  const client = instagramClient(options);
  return requestJson({
    fetch: client.fetchImpl,
    platform: client.platform,
    url: instagramUrl(
      client.baseUrl,
      `${encodeURIComponent(client.userId)}/content_publishing_limit`,
      ["quota_usage", "config"],
    ),
    accessToken: client.accessToken,
    timeoutMs: client.timeoutMs,
    operation: "reading Instagram publishing quota",
  });
}

export async function fetchInstagramMedia(remoteId, options = {}) {
  const client = instagramClient(options);
  const id = requireIdentifier(remoteId, client.platform, "remote_id");
  return requestJson({
    fetch: client.fetchImpl,
    platform: client.platform,
    url: instagramUrl(
      client.baseUrl,
      encodeURIComponent(id),
      ["id", "caption", "media_type", "media_product_type", "permalink", "timestamp", "username"],
    ),
    accessToken: client.accessToken,
    timeoutMs: client.timeoutMs,
    operation: "reading published Instagram media",
  });
}

export function createInstagramLiveAdapter({
  fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  config = {},
  timeoutMs,
  pollIntervalMs = 60_000,
  maxPollAttempts = 5,
} = {}) {
  const client = instagramClient({ fetch, config, timeoutMs });
  const {
    platform,
    fetchImpl,
    userId: igUserId,
    accessToken,
    baseUrl,
  } = client;

  return Object.freeze({
    platform,
    capabilities: Object.freeze({ live: true, media: ["single_image", "reels"] }),
    async publish(payload) {
      const mediaType = String(payload?.instagram_media_type ?? "IMAGE").toUpperCase();
      if (!new Set(["IMAGE", "REELS"]).has(mediaType)) {
        throw new TypeError(`Unsupported Instagram media type: ${mediaType}`);
      }
      const mediaUrl = requirePublicHttpsUrl(
        payload?.media_url ?? (mediaType === "REELS" ? payload?.video_url : payload?.image_url),
        platform,
      );
      const caption = readText(payload, platform);
      const createBody = mediaType === "REELS"
        ? {
            media_type: "REELS",
            video_url: mediaUrl,
            caption,
            share_to_feed: "false",
            thumb_offset: "0",
          }
        : { image_url: mediaUrl, caption };
      const label = mediaType === "REELS" ? "Reel" : "image";
      const containerResponse = await requestJson({
        fetch: fetchImpl,
        platform,
        url: `${baseUrl}/${encodeURIComponent(igUserId)}/media`,
        method: "POST",
        accessToken,
        body: formBody(createBody),
        contentType: "application/x-www-form-urlencoded;charset=UTF-8",
        timeoutMs,
        operation: `creating ${label} container`,
        outcomeMayHaveCommitted: true,
      });
      const containerId = requireRemoteId(containerResponse, platform, `creating ${label} container`);

      let statusCode = null;
      for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
        const statusResponse = await requestJson({
          fetch: fetchImpl,
          platform,
          url: `${baseUrl}/${encodeURIComponent(containerId)}?fields=status_code`,
          accessToken,
          timeoutMs,
          operation: `checking ${label} container status`,
        });
        statusCode = String(statusResponse?.status_code ?? "UNKNOWN").toUpperCase();
        if (statusCode === READY) break;
        if (TERMINAL_FAILURES.has(statusCode)) throw new RemoteStateError(platform, statusCode);
        if (attempt + 1 < maxPollAttempts) await sleep(pollIntervalMs);
      }
      if (statusCode !== READY) {
        throw new RemoteStateError(platform, `NOT_READY:${statusCode ?? "UNKNOWN"}`);
      }

      const publishResponse = await requestJson({
        fetch: fetchImpl,
        platform,
        url: `${baseUrl}/${encodeURIComponent(igUserId)}/media_publish`,
        method: "POST",
        accessToken,
        body: formBody({ creation_id: containerId }),
        contentType: "application/x-www-form-urlencoded;charset=UTF-8",
        timeoutMs,
        operation: `publishing ${label} container`,
        outcomeMayHaveCommitted: true,
      });
      const remoteId = requireRemoteId(publishResponse, platform, `publishing ${label} container`);
      if (!remoteId) throw new ResultUnknownError(platform, `publishing ${label} container`);
      return publishedResult(platform, remoteId, {
        container_id: containerId,
        status_code: statusCode,
        media_type: mediaType,
      });
    },
  });
}
