import {
  DEFAULT_META_GRAPH_BASE_URL,
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
import { RemoteStateError, ResultUnknownError, PayloadValidationError } from "./errors.mjs";

function facebookConfig(config, fetch, timeoutMs) {
  const platform = "facebook";
  return {
    platform,
    fetchImpl: requireFetch(fetch, platform),
    pageId: requireIdentifier(config.page_id, platform, "page_id"),
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

export async function fetchFacebookPageIdentity({ fetch, config = {}, timeoutMs } = {}) {
  const { platform, fetchImpl, pageId, accessToken, baseUrl } = facebookConfig(
    config,
    fetch,
    timeoutMs,
  );
  const response = await requestJson({
    fetch: fetchImpl,
    platform,
    url: `${baseUrl}/${encodeURIComponent(pageId)}?fields=id%2Cname%2Clink`,
    method: "GET",
    accessToken,
    timeoutMs,
    operation: "reading Page identity",
  });
  const remoteId = requireRemoteId(response, platform, "reading Page identity");
  if (typeof response?.name !== "string" || typeof response?.link !== "string") {
    throw new RemoteStateError(platform, "PAGE_IDENTITY_INCOMPLETE");
  }
  return Object.freeze({ id: remoteId, name: response.name, link: response.link });
}

export async function fetchFacebookPost(remoteId, { fetch, config = {}, timeoutMs } = {}) {
  const { platform, fetchImpl, accessToken, baseUrl } = facebookConfig(config, fetch, timeoutMs);
  const id = requireIdentifier(remoteId, platform, "remote_id");
  return requestJson({
    fetch: fetchImpl,
    platform,
    url: `${baseUrl}/${encodeURIComponent(id)}?fields=id%2Cmessage%2Ccreated_time%2Cpermalink_url`,
    method: "GET",
    accessToken,
    timeoutMs,
    operation: "reading published Page post",
  });
}

export async function fetchFacebookReel(remoteId, { fetch, config = {}, timeoutMs } = {}) {
  const { platform, fetchImpl, accessToken, baseUrl } = facebookConfig(config, fetch, timeoutMs);
  const id = requireIdentifier(remoteId, platform, "remote_id");
  return requestJson({ fetch: fetchImpl, platform, url: `${baseUrl}/${id}?fields=id,description,permalink_url,created_time,from,status`, accessToken, timeoutMs, operation: "reading Facebook Reel" });
}

export async function findFacebookReelCandidates(post, { fetch, config = {}, timeoutMs } = {}) {
  const { platform, fetchImpl, pageId, accessToken, baseUrl } = facebookConfig(config, fetch, timeoutMs);
  const response = await requestJson({ fetch: fetchImpl, platform, url: `${baseUrl}/${pageId}/video_reels?fields=id,description,created_time&limit=100`, accessToken, timeoutMs, operation: "finding the submitted Facebook Reel" });
  const started = Date.parse(post.publish?.attempt_started_at);
  return (response.data ?? []).filter(item => item.description === post.body && Number.isFinite(started) && Math.abs(Date.parse(item.created_time) - started) <= 30 * 60000).map(item => String(item.id));
}

function normalizedFacebookPageUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (hostname !== "facebook.com") return null;
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `https://facebook.com${pathname}`;
  } catch {
    return null;
  }
}

export function matchesFacebookPageIdentity(identity, expected) {
  if (String(identity?.id ?? "") !== String(expected?.id ?? "")) return false;
  if (identity?.name !== expected?.name) return false;
  const actualUrl = normalizedFacebookPageUrl(identity?.link);
  const expectedUrl = normalizedFacebookPageUrl(expected?.url);
  const numericUrl = normalizedFacebookPageUrl(`https://www.facebook.com/${expected.id}`);
  return actualUrl !== null && (actualUrl === expectedUrl || actualUrl === numericUrl);
}

function canCreatePageContent(tasks) {
  return Array.isArray(tasks)
    && tasks.some((task) => typeof task === "string"
      && (task === "CREATE_CONTENT" || task.endsWith("_CREATE_CONTENT")));
}

export async function fetchFacebookPageAccessToken({ fetch, config = {}, timeoutMs } = {}) {
  const { platform, fetchImpl, pageId, accessToken, baseUrl } = facebookConfig(
    config,
    fetch,
    timeoutMs,
  );
  const response = await requestJson({
    fetch: fetchImpl,
    platform,
    url: `${baseUrl}/me/accounts?fields=id%2Cname%2Caccess_token%2Ctasks&limit=100`,
    method: "GET",
    accessToken,
    timeoutMs,
    operation: "resolving assigned Page access token",
  });
  const pages = Array.isArray(response?.data) ? response.data : [];
  const page = pages.find((candidate) => String(candidate?.id ?? "") === pageId);
  if (!page) throw new RemoteStateError(platform, "ASSIGNED_PAGE_NOT_FOUND");
  if (!canCreatePageContent(page.tasks)) {
    throw new RemoteStateError(platform, "PAGE_CREATE_CONTENT_TASK_MISSING");
  }
  return requireString(page.access_token, platform, "page_access_token");
}

export function createFacebookLiveAdapter({ fetch, config = {}, timeoutMs, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), pollIntervalMs = 10000, maxPollAttempts = 12 } = {}) {
  const { platform, fetchImpl, pageId, accessToken, baseUrl } = facebookConfig(
    config,
    fetch,
    timeoutMs,
  );

  return Object.freeze({
    platform,
    capabilities: Object.freeze({ live: true, media: ["text", "reels"] }),
    async publish(payload, context = {}) {
      if (payload.media?.length) {
        if (payload.media.length !== 1 || !String(payload.media[0]).endsWith(".mp4") || !payload.media_url) {
          throw new PayloadValidationError(platform, "media", "Only one validated MP4 Reel is supported");
        }
        const call = (resource, options = {}) => requestJson({ fetch: fetchImpl, platform, url: `${baseUrl}/${resource}`, accessToken, timeoutMs, operation: "Facebook Reel", ...options });
        const start = await call(`${pageId}/video_reels`, { method: "POST", body: formBody({ upload_phase: "start" }), contentType: "application/x-www-form-urlencoded" });
        const videoId = requireIdentifier(String(start.video_id ?? ""), platform, "video_id");
        await context.onProgress?.({ remote_id: videoId, phase: "created" });
        const unknown = (operation, cause = null) => {
          const error = new ResultUnknownError(platform, operation);
          error.details = { operation, remote_id: videoId, ...(cause ? { cause_code: cause.code ?? "STATUS_CHECK_FAILED", cause_http_status: cause.http_status ?? null } : {}) };
          return error;
        };
        const uploadUrl = new URL(start.upload_url);
        if (uploadUrl.protocol !== "https:" || uploadUrl.hostname !== "rupload.facebook.com" || uploadUrl.username || uploadUrl.password) throw new RemoteStateError(platform, "INVALID_UPLOAD_URL");
        const uploaded = await requestJson({ fetch: fetchImpl, platform, url: uploadUrl.toString(), method: "POST", accessToken, extraHeaders: { file_url: payload.media_url }, timeoutMs: 60000, operation: "uploading Facebook Reel" });
        if (uploaded.success !== true) throw new RemoteStateError(platform, "REEL_UPLOAD_FAILED");
        // Save the remote handle before the irreversible finish request.
        await context.onProgress?.({ remote_id: videoId, phase: "publish_requested" });
        let finished;
        try {
          finished = await call(`${pageId}/video_reels`, { method: "POST", body: formBody({ upload_phase: "finish", video_id: videoId, video_state: "PUBLISHED", description: readText(payload, platform) }), contentType: "application/x-www-form-urlencoded", outcomeMayHaveCommitted: true });
        } catch (error) { if (error.result_unknown) throw unknown("publishing Facebook Reel", error); throw error; }
        if (finished.success !== true) throw unknown("publishing Facebook Reel");
        // Once finish was sent, never retry automatically, even if processing is slow.
        let lastError = null;
        for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
          try {
            const state = await call(`${videoId}?fields=status`);
            if (state.status?.publishing_phase?.status === "complete") return { ...publishedResult(platform, videoId, { endpoint: "video_reels" }), permalink: `https://www.facebook.com/reel/${videoId}` };
          } catch (error) {
            lastError = error;
            if (!error.retryable) break;
          }
          if (attempt + 1 < maxPollAttempts) await sleep(pollIntervalMs);
        }
        throw unknown("confirming Facebook Reel", lastError);
      }
      const response = await requestJson({
        fetch: fetchImpl,
        platform,
        url: `${baseUrl}/${encodeURIComponent(pageId)}/feed`,
        method: "POST",
        accessToken,
        body: formBody({ message: readText(payload, platform) }),
        contentType: "application/x-www-form-urlencoded;charset=UTF-8",
        timeoutMs,
        operation: "creating Page post",
        outcomeMayHaveCommitted: true,
      });
      const remoteId = requireRemoteId(response, platform, "creating Page post");
      return {
        ...publishedResult(platform, remoteId, { endpoint: "feed" }),
        permalink: `https://www.facebook.com/${encodeURIComponent(remoteId)}`,
      };
    },
  });
}
