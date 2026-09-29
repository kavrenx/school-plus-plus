(function connectSchoolppPage() {
  const api = globalThis.browser || globalThis.chrome;

  window.addEventListener("message", async (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.source !== "schoolpp-web"
    )
      return;
    if (event.data.type === "SCHOOLPP_EXTENSION_REQUEST") {
      const result = await api.runtime.sendMessage({
        type: "SCHOOLPP_GET_SNAPSHOT",
      });
      window.postMessage(
        {
          source: "schoolpp-extension",
          type: "SCHOOLPP_EXTENSION_RESPONSE",
          requestId: event.data.requestId,
          snapshot: result?.ok && result.stats.ready ? result.snapshot : null,
        },
        location.origin,
      );
    }
    if (event.data.type === "SCHOOLPP_EXTENSION_PING") {
      window.postMessage(
        {
          source: "schoolpp-extension",
          type: "SCHOOLPP_EXTENSION_PONG",
          requestId: event.data.requestId,
        },
        location.origin,
      );
    }
    if (event.data.type === "SCHOOLPP_LESSON_MATERIALS_REQUEST") {
      const result = await api.runtime.sendMessage({
        type: "SCHOOLPP_GET_LESSON_MATERIALS",
        lessons: event.data.lessons,
      });
      window.postMessage(
        {
          source: "schoolpp-extension",
          type: "SCHOOLPP_LESSON_MATERIALS_RESPONSE",
          requestId: event.data.requestId,
          materials: result?.ok ? result.materials : {},
        },
        location.origin,
      );
    }
    if (event.data.type === "SCHOOLPP_EXTENSION_IMPORTED") {
      await api.runtime.sendMessage({
        type: "SCHOOLPP_CLOUD_IMPORT_COMPLETE",
      });
    }
    if (event.data.type === "SCHOOLPP_MATERIAL_REQUEST") {
      const result = await api.runtime.sendMessage({
        type: "SCHOOLPP_RESOLVE_MATERIAL",
        material: event.data.material,
      });
      window.postMessage(
        {
          source: "schoolpp-extension",
          type: "SCHOOLPP_MATERIAL_RESPONSE",
          requestId: event.data.requestId,
          result,
        },
        location.origin,
      );
    }
  });

  api.runtime.onMessage.addListener((message) => {
    if (
      message?.type !== "SCHOOLPP_SNAPSHOT_UPDATED" &&
      message?.type !== "SCHOOLPP_EXTENSION_WAKE"
    )
      return;
    void publishSnapshot(
      message.type === "SCHOOLPP_SNAPSHOT_UPDATED"
        ? "SCHOOLPP_EXTENSION_UPDATED"
        : "SCHOOLPP_EXTENSION_READY",
    );
  });

  async function publishSnapshot(type) {
    const result = await api.runtime.sendMessage({
      type: "SCHOOLPP_GET_SNAPSHOT",
    });
    window.postMessage(
      {
        source: "schoolpp-extension",
        type,
        snapshot: result?.ok && result.stats.ready ? result.snapshot : null,
      },
      location.origin,
    );
  }

  window.postMessage(
    { source: "schoolpp-extension", type: "SCHOOLPP_EXTENSION_READY" },
    location.origin,
  );
})();
