import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../js/api-client.js";

function createResponse({
  status = 200,
  payload = null,
  contentType = "application/json",
} = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    async json() {
      return payload;
    },
    async text() {
      return typeof payload === "string" ? payload : JSON.stringify(payload);
    },
  };
}

test("sends JSON requests with same-origin session credentials", async () => {
  const calls = [];
  const client = createApiClient({
    baseUrl: "/api/",
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return createResponse({ payload: { saved: true } });
    },
  });

  const result = await client.request("journal/entry", {
    method: "PUT",
    body: { grade: "10" },
  });

  assert.deepEqual(result, { saved: true });
  assert.equal(calls[0].url, "/api/journal/entry");
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.equal(calls[0].options.body, JSON.stringify({ grade: "10" }));
});

test("turns server and network failures into typed API errors", async () => {
  const serverClient = createApiClient({
    fetchImpl: async () =>
      createResponse({
        status: 422,
        payload: { message: "Некорректная оценка", code: "INVALID_GRADE" },
      }),
  });

  await assert.rejects(serverClient.request("journal"), (error) => {
    assert.equal(error instanceof ApiError, true);
    assert.equal(error.status, 422);
    assert.equal(error.code, "INVALID_GRADE");
    return true;
  });

  const networkClient = createApiClient({
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  await assert.rejects(networkClient.request("journal"), {
    name: "ApiError",
    code: "NETWORK_ERROR",
  });
});

test("reports malformed JSON as an invalid server response", async () => {
  const client = createApiClient({
    fetchImpl: async () => ({
      ...createResponse(),
      async json() {
        throw new SyntaxError("broken json");
      },
    }),
  });

  await assert.rejects(client.request("journal"), {
    name: "ApiError",
    status: 200,
    code: "INVALID_RESPONSE",
  });
});
