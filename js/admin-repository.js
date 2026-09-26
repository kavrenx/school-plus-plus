function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

function createAdminRepository(client) {
  async function getUser() {
    const result = await client.auth.getUser();
    if (result.error) throw result.error;
    return result.data.user;
  }

  return Object.freeze({
    async isAdmin() {
      if (!(await getUser())) return false;
      return Boolean(unwrap(await client.rpc("is_schoolpp_admin")));
    },
    async recordActivity(event, context = {}) {
      if (!(await getUser())) throw new Error("ADMIN_AUTH_REQUIRED");
      unwrap(
        await client.rpc("record_site_activity", {
          p_event: String(event || ""),
          p_device: context.device || "unknown",
          p_browser: context.browser || "unknown",
        }),
      );
    },
    async getDashboard(days = 14) {
      if (!(await getUser())) throw new Error("ADMIN_AUTH_REQUIRED");
      return unwrap(
        await client.rpc("get_admin_dashboard", {
          p_days: Math.max(7, Math.min(Number(days) || 14, 31)),
        }),
      );
    },
    async getSiteStatus() {
      return unwrap(await client.rpc("get_public_site_status"));
    },
    async setMaintenanceMode(enabled) {
      if (!(await getUser())) throw new Error("ADMIN_AUTH_REQUIRED");
      return unwrap(
        await client.rpc("set_maintenance_mode", {
          p_enabled: enabled === true,
        }),
      );
    },
  });
}

export { createAdminRepository };
