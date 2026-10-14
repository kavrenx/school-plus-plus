// Happy DOM combines comma-separated queries containing "and" incorrectly.
// Evaluate each native branch separately so phone tests use browser OR semantics.
function supportMediaQueryLists(window) {
  const match = window.matchMedia.bind(window);
  window.matchMedia = (query) => {
    if (!query.includes(",")) return match(query);
    const branches = query.split(",").map((part) => match(part.trim()));
    const handlers = new Map();
    const list = {
      get matches() {
        return branches.some((branch) => branch.matches);
      },
      addEventListener(type, callback) {
        let previous = list.matches;
        const handler = () => {
          if (previous === list.matches) return;
          previous = list.matches;
          callback({ matches: previous });
        };
        handlers.set(callback, handler);
        window.addEventListener("resize", handler);
      },
      removeEventListener(type, callback) {
        window.removeEventListener("resize", handlers.get(callback));
        handlers.delete(callback);
      },
    };
    return list;
  };
}

export { supportMediaQueryLists };
