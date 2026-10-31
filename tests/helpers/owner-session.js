function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function createOwnerSession(initial = "owner-a") {
  let identity = initial;
  const listeners = new Set();
  return {
    getIdentity: async () => identity,
    subscribeIdentity(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    change(next, event = next ? "SIGNED_IN" : "SIGNED_OUT") {
      identity = next;
      for (const listener of listeners)
        listener(event, next ? { user: { id: next } } : null);
    },
    get active() {
      return listeners.size;
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
export { createOwnerSession, deferred, flush };
