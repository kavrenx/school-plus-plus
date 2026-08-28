function createSafeStorage(storage, { onError = () => {} } = {}) {
  const pendingValues = new Map();
  const pendingRemovals = new Set();
  const reportedOperations = new Set();
  let persistent = Boolean(storage);

  function report(operation, error) {
    persistent = false;
    if (reportedOperations.has(operation)) return;
    reportedOperations.add(operation);
    onError({ operation, error });
  }

  function getItem(key) {
    if (pendingRemovals.has(key)) return null;
    if (pendingValues.has(key)) return pendingValues.get(key);

    try {
      if (!storage?.getItem) throw new Error("Persistent storage is unavailable");
      return storage.getItem(key) ?? null;
    } catch (error) {
      report("read", error);
      return null;
    }
  }

  function setItem(key, value) {
    const normalizedValue = String(value);

    try {
      if (!storage?.setItem) throw new Error("Persistent storage is unavailable");
      storage.setItem(key, normalizedValue);
      pendingValues.delete(key);
      pendingRemovals.delete(key);
      return true;
    } catch (error) {
      pendingValues.set(key, normalizedValue);
      pendingRemovals.delete(key);
      report("write", error);
      return false;
    }
  }

  function removeItem(key) {
    pendingValues.delete(key);

    try {
      if (!storage?.removeItem)
        throw new Error("Persistent storage is unavailable");
      storage.removeItem(key);
      pendingRemovals.delete(key);
      return true;
    } catch (error) {
      pendingRemovals.add(key);
      report("remove", error);
      return false;
    }
  }

  function isPersistent() {
    return persistent;
  }

  return { getItem, isPersistent, removeItem, setItem };
}

function getBrowserStorage(browserWindow) {
  try {
    return browserWindow.localStorage;
  } catch {
    return null;
  }
}

export { createSafeStorage, getBrowserStorage };
