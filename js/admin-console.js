import { registerIcons } from "./icons.js";
import { createSupabaseServices } from "./supabase-services.js";

const ADMIN_EMAIL = "support@schoolpp.com";
const NUMBER = new Intl.NumberFormat("ru-RU");
const DATE = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
});
const DATE_TIME = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

registerIcons();

document.addEventListener("DOMContentLoaded", async () => {
  const login = document.getElementById("adminLogin");
  const workspace = document.getElementById("adminWorkspace");
  const form = document.getElementById("adminLoginForm");
  const loginInput = document.getElementById("adminLoginInput");
  const passwordInput = document.getElementById("adminPassword");
  const loginError = document.getElementById("adminLoginError");
  const logout = document.getElementById("adminLogout");
  const refresh = document.getElementById("adminRefresh");
  const error = document.getElementById("adminError");
  const services = createSupabaseServices(import.meta.env, {
    storageKey: "schoolpp_admin_session",
  });
  let refreshTimer = 0;

  if (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("preview") === "dashboard"
  ) {
    login.hidden = true;
    workspace.hidden = false;
    renderDashboard(createPreviewDashboard());
    return;
  }

  if (!services) {
    showLoginError("Подключение сервера не настроено.");
    form.querySelector("button").disabled = true;
    return;
  }

  async function loadDashboard() {
    refresh.disabled = true;
    refresh.classList.add("is-loading");
    error.hidden = true;
    try {
      const dashboard = await services.admin.getDashboard(14);
      renderDashboard(dashboard);
      scheduleRefresh();
    } catch {
      error.textContent = "Не удалось обновить статистику. Попробуй ещё раз.";
      error.hidden = false;
    } finally {
      refresh.disabled = false;
      refresh.classList.remove("is-loading");
    }
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => void loadDashboard(), 60_000);
  }

  async function showWorkspace() {
    const user = await services.auth.getUser();
    if (!user || !(await services.admin.isAdmin())) {
      if (user) await services.auth.signOut();
      throw new Error("ADMIN_REQUIRED");
    }
    login.hidden = true;
    workspace.hidden = false;
    await loadDashboard();
  }

  try {
    if (await services.auth.getUser()) await showWorkspace();
  } catch {
    login.hidden = false;
    workspace.hidden = true;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    loginError.hidden = true;
    try {
      const enteredLogin = loginInput.value.trim().toLowerCase();
      if (enteredLogin !== "support" && enteredLogin !== ADMIN_EMAIL)
        throw new Error("INVALID_LOGIN");
      await services.auth.signIn(ADMIN_EMAIL, passwordInput.value);
      passwordInput.value = "";
      await showWorkspace();
    } catch {
      try {
        if (await services.auth.getUser()) await services.auth.signOut();
      } catch {
        /* Preserve the useful login error. */
      }
      showLoginError("Неверный логин или пароль либо нет доступа администратора.");
    } finally {
      button.disabled = false;
    }
  });

  refresh.addEventListener("click", () => void loadDashboard());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !workspace.hidden) void loadDashboard();
  });
  logout.addEventListener("click", async () => {
    logout.disabled = true;
    window.clearTimeout(refreshTimer);
    try {
      await services.auth.signOut();
      workspace.hidden = true;
      login.hidden = false;
      loginInput.focus();
    } finally {
      logout.disabled = false;
    }
  });

  function showLoginError(message) {
    loginError.textContent = message;
    loginError.hidden = false;
  }
});

function renderDashboard(data = {}) {
  const summary = data.summary || {};
  const funnel = data.funnel || {};
  setText("metricViews", number(summary.viewsToday));
  setText("metricVisitors", `${number(summary.visitorsToday)} посетителей`);
  setText("metricSyncs", number(summary.syncsToday));
  setText("metricLastSync", `Последняя: ${relativeTime(summary.lastSyncAt)}`);
  setText("metricSnapshots", number(summary.totalSnapshots));
  setText("metricFresh", `${number(summary.freshSnapshots)} обновлено за сутки`);
  const attention =
    Number(summary.openConversations || 0) + Number(summary.newRequests || 0);
  setText("metricAttention", number(attention));
  setText(
    "metricAttentionDetail",
    `${number(summary.openConversations)} обращений · ${number(summary.newRequests)} заявок`,
  );
  setText("statusVisitors7d", number(summary.visitors7d));
  setText("statusFresh", number(summary.freshSnapshots));
  setText("statusStale", number(summary.staleSnapshots));
  setText("statusMessages", number(summary.messagesToday));
  setText("queueConversations", number(summary.openConversations));
  setText("queueRequests", number(summary.newRequests));
  setText("queueReview", number(summary.requestsInReview));
  setText(
    "queueLastMessage",
    `Последнее сообщение: ${relativeTime(summary.lastSupportAt)}`,
  );
  setText(
    "adminUpdatedAt",
    `Данные обновлены ${data.generatedAt ? DATE_TIME.format(new Date(data.generatedAt)) : "сейчас"}`,
  );
  renderChart(data.series || []);
  renderFunnel(funnel);
  renderBreakdown("adminDevices", data.devices || [], {
    desktop: "Компьютеры",
    mobile: "Телефоны и планшеты",
    unknown: "Не определено",
  });
  renderBreakdown("adminBrowsers", data.browsers || [], {
    chrome: "Chrome",
    firefox: "Firefox",
    brave: "Brave",
    opera: "Opera",
    edge: "Edge",
    other: "Другие",
    unknown: "Не определено",
  });
}

function renderChart(series) {
  const root = document.getElementById("adminChart");
  root.replaceChildren();
  const maximum = Math.max(1, ...series.map((item) => Number(item.views || 0)));
  series.forEach((item) => {
    const column = document.createElement("div");
    column.className = "admin-chart-column";
    const bars = document.createElement("div");
    bars.className = "admin-chart-bars";
    const views = document.createElement("i");
    views.style.height = `${Math.max(3, (Number(item.views || 0) / maximum) * 100)}%`;
    views.title = `${number(item.views)} посещений`;
    const visitors = document.createElement("i");
    visitors.style.height = `${Math.max(3, (Number(item.visitors || 0) / maximum) * 100)}%`;
    visitors.title = `${number(item.visitors)} посетителей`;
    bars.append(views, visitors);
    const label = document.createElement("span");
    label.textContent = DATE.format(new Date(`${item.date}T12:00:00`));
    column.append(bars, label);
    root.append(column);
  });
}

function renderFunnel(funnel) {
  const root = document.getElementById("adminFunnel");
  root.replaceChildren();
  const visitors = Number(funnel.visitors30d || 0);
  const rows = [
    ["Посетили за 30 дней", visitors],
    ["Завершили подключение", Number(funnel.onboarded30d || 0)],
    ["Расширение найдено", Number(funnel.extensions30d || 0)],
    ["Передали дневник", Number(funnel.synced30d || 0)],
  ];
  rows.forEach(([label, value], index) => {
    const row = document.createElement("div");
    const heading = document.createElement("span");
    const text = document.createElement("span");
    text.textContent = label;
    const count = document.createElement("strong");
    count.textContent = number(value);
    heading.append(text, count);
    const track = document.createElement("i");
    const fill = document.createElement("b");
    const percent = index === 0 ? 100 : visitors ? (value / visitors) * 100 : 0;
    fill.style.width = `${Math.max(value ? 3 : 0, Math.min(percent, 100))}%`;
    track.append(fill);
    row.append(heading, track);
    root.append(row);
  });
}

function renderBreakdown(id, items, labels) {
  const root = document.getElementById(id);
  root.replaceChildren();
  const total = items.reduce((sum, item) => sum + Number(item.count || 0), 0);
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "Данных пока нет.";
    root.append(empty);
    return;
  }
  items.forEach((item) => {
    const row = document.createElement("div");
    const heading = document.createElement("span");
    heading.textContent = labels[item.name] || item.name;
    const count = document.createElement("strong");
    const percent = total ? Math.round((Number(item.count || 0) / total) * 100) : 0;
    count.textContent = `${percent}%`;
    const track = document.createElement("i");
    const fill = document.createElement("b");
    fill.style.width = `${percent}%`;
    track.append(fill);
    row.append(heading, count, track);
    root.append(row);
  });
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function number(value) {
  return NUMBER.format(Number(value) || 0);
}

function relativeTime(value) {
  if (!value) return "ещё не было";
  const distance = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(distance)) return "—";
  const minutes = Math.max(0, Math.floor(distance / 60_000));
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return DATE_TIME.format(new Date(value));
}

function createPreviewDashboard() {
  const today = new Date();
  const series = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (13 - index));
    return {
      date: date.toISOString().slice(0, 10),
      views: [9, 14, 12, 19, 21, 17, 28, 24, 31, 36, 33, 44, 39, 52][index],
      visitors: [5, 8, 7, 11, 12, 10, 17, 15, 19, 22, 20, 28, 24, 34][index],
      syncs: [2, 3, 3, 5, 4, 5, 8, 7, 9, 11, 8, 14, 12, 16][index],
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      viewsToday: 52,
      visitorsToday: 34,
      visitors7d: 126,
      syncsToday: 16,
      totalSnapshots: 184,
      freshSnapshots: 43,
      staleSnapshots: 11,
      openConversations: 4,
      messagesToday: 17,
      newRequests: 3,
      requestsInReview: 2,
      lastSyncAt: new Date(Date.now() - 7 * 60_000).toISOString(),
      lastSupportAt: new Date(Date.now() - 19 * 60_000).toISOString(),
    },
    funnel: {
      visitors30d: 418,
      onboarded30d: 302,
      extensions30d: 247,
      synced30d: 218,
    },
    series,
    devices: [
      { name: "desktop", count: 341 },
      { name: "mobile", count: 77 },
    ],
    browsers: [
      { name: "chrome", count: 278 },
      { name: "firefox", count: 91 },
      { name: "brave", count: 31 },
      { name: "other", count: 18 },
    ],
  };
}

export { ADMIN_EMAIL, renderDashboard };
