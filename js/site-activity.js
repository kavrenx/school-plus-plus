function describeClient(navigatorRef = {}) {
  const agent = String(navigatorRef.userAgent || "");
  const device =
    navigatorRef.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(agent)
      ? "mobile"
      : "desktop";
  let browser = "other";
  if (/Firefox\//i.test(agent)) browser = "firefox";
  else if (/Edg\//i.test(agent)) browser = "edge";
  else if (/OPR\//i.test(agent)) browser = "opera";
  else if (navigatorRef.brave || /Brave/i.test(agent)) browser = "brave";
  else if (/Chrome\//i.test(agent)) browser = "chrome";
  return { browser, device };
}

function createActivityReporter({ services, ensureUser, navigatorRef }) {
  const context = describeClient(navigatorRef);
  return async function reportActivity(event) {
    if (!services?.admin) return false;
    try {
      await ensureUser();
      await services.admin.recordActivity(event, context);
      return true;
    } catch (error) {
      console.warn("Не удалось записать обезличенное событие School++.", error);
      return false;
    }
  };
}

export { createActivityReporter, describeClient };
