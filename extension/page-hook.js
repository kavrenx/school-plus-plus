(function installSchoolppNetworkHook() {
  if (window.__schoolppNetworkHookInstalled) return;
  window.__schoolppNetworkHookInstalled = true;
  const SOURCE = "schoolpp-e-schools-hook";
  const BLOCKED_URL = /(?:auth|login|logout|password|token|session|captcha)/i;
  const SENSITIVE_KEY = /(?:password|pass|token|secret|cookie|authorization)/i;
  const MAX_BODY_LENGTH = 450_000;
  const ALLOWED_URL =
    /^\/api\/v1\/(?:education\/|institution\/schools\/[^/]+\/premises(?:\/|$))/;
  const FORWARDED_HEADER = /^(?:authorization|x-.*(?:csrf|xsrf|token).*)$/i;
  const forwardedHeaders = new Headers({ Accept: "application/json" });
  const observedResourceUrls = new Set();

  try {
    const observer = new PerformanceObserver((list) => {
      list
        .getEntries()
        .forEach((entry) => observedResourceUrls.add(entry.name));
    });
    observer.observe({ type: "resource", buffered: true });
  } catch {
    /* The current resource list remains available in older browsers. */
  }

  function publish(url, method, status, body) {
    try {
      const target = new URL(url, location.href);
      if (
        target.origin !== location.origin ||
        !ALLOWED_URL.test(target.pathname) ||
        BLOCKED_URL.test(target.href)
      )
        return;
      const safeBody = redact(body);
      const serialized = JSON.stringify(safeBody);
      if (serialized.length > MAX_BODY_LENGTH) return;
      window.postMessage(
        {
          source: SOURCE,
          type: "SCHOOLPP_NETWORK_RECORD",
          record: {
            key: `${String(method || "GET").toUpperCase()}:${target.pathname}${target.search}`,
            url: `${target.pathname}${target.search}`,
            method: String(method || "GET").toUpperCase(),
            status,
            capturedAt: new Date().toISOString(),
            body: safeBody,
          },
        },
        location.origin,
      );
    } catch {
      /* A failed diagnostic capture must never affect the source site. */
    }
  }

  function redact(value, depth = 0) {
    if (depth > 16) return "[depth-limited]";
    if (Array.isArray(value))
      return value.map((item) => redact(item, depth + 1));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[redacted]" : redact(item, depth + 1),
      ]),
    );
  }

  function rememberHeaders(headers) {
    if (!headers) return;
    try {
      for (const [name, value] of new Headers(headers)) {
        if (FORWARDED_HEADER.test(name)) forwardedHeaders.set(name, value);
      }
    } catch {
      /* Ignore malformed request headers from the source application. */
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function schoolppFetch(input, init) {
    rememberHeaders(
      init?.headers || (typeof input === "object" && input.headers),
    );
    const response = await originalFetch.apply(this, arguments);
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("json")) {
      response
        .clone()
        .json()
        .then((body) =>
          publish(
            typeof input === "string" ? input : input.url,
            init?.method || (typeof input === "object" && input.method),
            response.status,
            body,
          ),
        )
        .catch(() => {});
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function schoolppOpen(method, url) {
    this.__schoolppRequest = { method, url };
    this.__schoolppHeaders = {};
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function schoolppSetHeader(
    name,
    value,
  ) {
    if (FORWARDED_HEADER.test(String(name))) {
      this.__schoolppHeaders[name] = value;
      forwardedHeaders.set(name, value);
    }
    return originalSetRequestHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function schoolppSend() {
    this.addEventListener(
      "load",
      () => {
        const contentType = this.getResponseHeader("content-type") || "";
        if (!contentType.includes("json") || !this.__schoolppRequest) return;
        try {
          const body =
            this.responseType === "json"
              ? this.response
              : JSON.parse(this.responseText);
          publish(
            this.__schoolppRequest.url,
            this.__schoolppRequest.method,
            this.status,
            body,
          );
        } catch {
          /* Ignore non-JSON responses. */
        }
      },
      { once: true },
    );
    return originalSend.apply(this, arguments);
  };

  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.source !== "schoolpp-e-schools-content"
    )
      return;
    if (event.data?.type === "SCHOOLPP_FETCH_REQUEST") {
      void fetchForExtension(event.data.requestId, event.data.url);
      return;
    }
    if (event.data?.type === "SCHOOLPP_RESOURCE_REQUEST") {
      publishResourceUrls(event.data.requestId);
    }
  });

  function publishResourceUrls(requestId) {
    performance
      .getEntriesByType("resource")
      .forEach((entry) => observedResourceUrls.add(entry.name));
    window.postMessage(
      {
        source: SOURCE,
        type: "SCHOOLPP_RESOURCE_RESPONSE",
        requestId,
        urls: [...observedResourceUrls].filter(Boolean),
      },
      location.origin,
    );
  }

  async function fetchForExtension(requestId, url) {
    let result;
    try {
      const target = new URL(url, location.origin);
      if (
        target.origin !== location.origin ||
        !ALLOWED_URL.test(target.pathname)
      )
        throw new Error("BLOCKED_URL");
      const response = await originalFetch(target, {
        credentials: "include",
        cache: "no-store",
        headers: forwardedHeaders,
      });
      const body = await response.json();
      result = { status: response.status, body: redact(body) };
    } catch (error) {
      result = { error: error.message || "FETCH_FAILED" };
    }
    window.postMessage(
      {
        source: SOURCE,
        type: "SCHOOLPP_FETCH_RESPONSE",
        requestId,
        result,
      },
      location.origin,
    );
  }
})();
