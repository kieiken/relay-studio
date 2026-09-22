const SECRET_KEY = /(access[_-]?token|authorization|api[_-]?key|client[_-]?secret|password|secret)/i;

export class LiveAdapterError extends Error {
  constructor(message, {
    code = "LIVE_ADAPTER_ERROR",
    platform = null,
    retryable = false,
    resultUnknown = false,
    httpStatus = null,
    details = null,
  } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.platform = platform;
    this.retryable = retryable;
    this.result_unknown = resultUnknown;
    this.http_status = httpStatus;
    this.details = redact(details);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      platform: this.platform,
      retryable: this.retryable,
      result_unknown: this.result_unknown,
      http_status: this.http_status,
      details: this.details,
    };
  }
}

export class ConfigValidationError extends LiveAdapterError {
  constructor(platform, field, reason = "is required") {
    super(`Invalid ${platform} live adapter configuration: ${field} ${reason}`, {
      code: "CONFIG_INVALID",
      platform,
      details: { field },
    });
  }
}

export class PayloadValidationError extends LiveAdapterError {
  constructor(platform, field, reason) {
    super(`Invalid ${platform} publish payload: ${field} ${reason}`, {
      code: "PAYLOAD_INVALID",
      platform,
      details: { field },
    });
  }
}

export class HttpResponseError extends LiveAdapterError {
  constructor(platform, status, responseSummary = null) {
    super(`${platform} API returned HTTP ${status}`, {
      code: "HTTP_NON_2XX",
      platform,
      retryable: status === 429 || status >= 500,
      httpStatus: status,
      details: responseSummary ? { response: responseSummary } : null,
    });
  }
}

export class RequestTimeoutError extends LiveAdapterError {
  constructor(platform, operation) {
    super(`${platform} API request timed out while ${operation}`, {
      code: "REQUEST_TIMEOUT",
      platform,
      retryable: true,
      details: { operation },
    });
  }
}

export class NetworkRequestError extends LiveAdapterError {
  constructor(platform, operation) {
    super(`${platform} API request failed while ${operation}`, {
      code: "NETWORK_ERROR",
      platform,
      retryable: true,
      details: { operation },
    });
  }
}

export class ResultUnknownError extends LiveAdapterError {
  constructor(platform, operation) {
    super(`${platform} API result is unknown after ${operation}; do not retry automatically`, {
      code: "RESULT_UNKNOWN",
      platform,
      retryable: false,
      resultUnknown: true,
      details: { operation },
    });
  }
}

export class RemoteStateError extends LiveAdapterError {
  constructor(platform, state) {
    super(`${platform} remote container entered state ${state}`, {
      code: "REMOTE_STATE_ERROR",
      platform,
      details: { state },
    });
  }
}

export class UnsupportedLivePostingError extends LiveAdapterError {
  constructor(platform) {
    super(`Official live posting is unsupported for ${platform}`, {
      code: "LIVE_POSTING_UNSUPPORTED",
      platform,
    });
  }
}

export function redact(value, secrets = []) {
  const secretValues = secrets.filter((item) => typeof item === "string" && item.length > 0);
  if (value == null) return value;
  if (typeof value === "string") {
    let safe = value;
    for (const secret of secretValues) safe = safe.split(secret).join("[REDACTED]");
    return safe;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, secretValues));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SECRET_KEY.test(key) ? "[REDACTED]" : redact(item, secretValues),
      ]),
    );
  }
  return value;
}
