function getSupabaseConfig(env = {}) {
  const url = String(env.VITE_SUPABASE_URL || "").trim();
  const publishableKey = String(env.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim();
  if (!url && !publishableKey) return null;
  if (!url || !publishableKey) {
    throw new Error(
      "Укажите адрес Supabase и публичный ключ в настройках проекта.",
    );
  }
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  ) {
    throw new Error(
      "Адрес Supabase должен быть корневым HTTPS-адресом проекта.",
    );
  }
  if (!publishableKey.startsWith("sb_publishable_")) {
    throw new Error(
      "Для браузера нужен publishable key. Секретные ключи использовать нельзя.",
    );
  }
  return Object.freeze({ url: parsed.origin, publishableKey });
}

export { getSupabaseConfig };
