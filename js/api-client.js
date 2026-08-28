class ApiError extends Error {
  constructor(message, { status = 0, code = "API_ERROR", details, cause } = {}) {
    super(message, { cause });
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function createApiClient({ baseUrl = "/api", fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required");
  }
  const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, "");

  async function request(path, { method = "GET", body, signal, headers = {} } = {}) {
    const requestHeaders = {
      Accept: "application/json",
      ...headers,
    };
    const options = {
      method,
      credentials: "include",
      headers: requestHeaders,
      signal,
    };

    if (body !== undefined) {
      requestHeaders["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetchImpl(
        `${normalizedBaseUrl}/${String(path).replace(/^\/+/, "")}`,
        options,
      );
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new ApiError("Не удалось связаться с сервером", {
        code: "NETWORK_ERROR",
        cause: error,
      });
    }

    let payload;
    try {
      payload = await readResponsePayload(response);
    } catch (error) {
      throw new ApiError("Сервер вернул некорректный ответ", {
        status: response.status,
        code: "INVALID_RESPONSE",
        cause: error,
      });
    }
    if (!response.ok) {
      throw new ApiError(
        payload?.message || payload?.error || `Ошибка сервера: ${response.status}`,
        {
          status: response.status,
          code: payload?.code || "API_ERROR",
          details: payload?.details,
        },
      );
    }
    return payload;
  }

  return Object.freeze({ request });
}

async function readResponsePayload(response) {
  if (response.status === 204) return null;
  const contentType = response.headers?.get?.("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  const text = await response.text();
  return text || null;
}

export { ApiError, createApiClient };
