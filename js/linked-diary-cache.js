const CACHE_KEY = "schoolpp_linked_diary_cache_v1";

function createLinkedDiaryCache(storage) {
  return {
    read(userId) {
      try {
        const data = JSON.parse(storage.getItem(CACHE_KEY) || "null");
        return userId &&
          data?.userId === userId &&
          data.access?.role === "linked" &&
          data.snapshot?.payload?.source === "e-schools.by"
          ? data
          : null;
      } catch {
        return null;
      }
    },
    save(userId, access, snapshot) {
      if (!userId || access?.role !== "linked") return;
      storage.setItem(CACHE_KEY, JSON.stringify({ userId, access, snapshot }));
    },
    clear() {
      storage.removeItem(CACHE_KEY);
    },
  };
}

export { createLinkedDiaryCache };
