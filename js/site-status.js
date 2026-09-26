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

  function clearTimer() {
    if (timerId === null) return;
    windowRef.clearTimeout(timerId);
    timerId = null;
  }

  function schedule() {
    clearTimer();
    if (!running) return;
    timerId = windowRef.setTimeout(() => void check(), intervalMs);
  }

  async function check() {
    if (!running || checking) return null;
    checking = true;
    clearTimer();
    try {
      const status = await repository.get();
      if (status.maintenanceEnabled !== maintenanceEnabled) {
        maintenanceEnabled = status.maintenanceEnabled;
        onChange(status);
      }
      return status;
    } catch {
      return null;
    } finally {
      checking = false;
      schedule();
    }
  }

  function handleVisibilityChange() {
    if (!windowRef.document.hidden) void check();
  }

  function start(initialStatus = {}) {
    if (running) return;
    running = true;
    maintenanceEnabled = initialStatus.maintenanceEnabled === true;
    windowRef.document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );
    schedule();
  }

  function stop() {
    if (!running) return;
    running = false;
    clearTimer();
    windowRef.document.removeEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );
  }

  return Object.freeze({ check, start, stop });
}

export {
  createSiteStatusRepository,
  createSiteStatusWatcher,
  normalizeStatus,
};
