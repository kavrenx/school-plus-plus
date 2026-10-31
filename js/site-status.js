function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

function normalizeStatus(value) {
  return Object.freeze({
    maintenanceEnabled: value?.maintenanceEnabled === true,
    updatedAt: value?.updatedAt || null,
  });
}

function createSiteStatusRepository(client) {
  return Object.freeze({
    async get() {
      return normalizeStatus(unwrap(await client.rpc("get_public_site_status")));
    },
  });
}

function createSiteStatusWatcher({
  repository,
  windowRef,
  intervalMs = 15_000,
  onChange = () => {},
}) {
  let timerId = null;
  let running = false;
  let checking = false;
  let maintenanceEnabled = false;
  let suspended = false;
  let generation = 0;

  function clearTimer() {
    if (timerId === null) return;
    windowRef.clearTimeout(timerId);
    timerId = null;
  }

  function schedule() {
    clearTimer();
    if (!running || suspended || checking || windowRef.document.hidden) return;
    timerId = windowRef.setTimeout(() => void check(), intervalMs);
  }

  async function check() {
    if (!running || suspended || checking || windowRef.document.hidden) return null;
    const currentGeneration = generation;
    checking = true;
    clearTimer();
    try {
      const status = await repository.get();
      if (!running || currentGeneration !== generation) return null;
      if (status.maintenanceEnabled !== maintenanceEnabled) {
        maintenanceEnabled = status.maintenanceEnabled;
        onChange(status);
      }
      return status;
    } catch {
      return null;
    } finally {
      if (currentGeneration === generation) {
        checking = false;
        schedule();
      }
    }
  }

  function handleVisibilityChange() {
    clearTimer();
    if (!windowRef.document.hidden) void check();
  }

  function handlePageHide() {
    suspended = true;
    generation++;
    checking = false;
    clearTimer();
  }

  function handlePageShow(event) {
    if (!event.persisted) return;
    suspended = false;
    void check();
  }

  function start(initialStatus = {}) {
    if (running) return;
    running = true;
    maintenanceEnabled = initialStatus.maintenanceEnabled === true;
    windowRef.document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );
    windowRef.addEventListener("pagehide", handlePageHide);
    windowRef.addEventListener("pageshow", handlePageShow);
    windowRef.addEventListener("online", handleVisibilityChange);
    schedule();
  }

  function stop() {
    if (!running) return;
    running = false;
    suspended = false;
    generation++;
    checking = false;
    clearTimer();
    windowRef.document.removeEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );
    windowRef.removeEventListener("pagehide", handlePageHide);
    windowRef.removeEventListener("pageshow", handlePageShow);
    windowRef.removeEventListener("online", handleVisibilityChange);
  }

  return Object.freeze({ check, start, stop });
}

export {
  createSiteStatusRepository,
  createSiteStatusWatcher,
  normalizeStatus,
};
