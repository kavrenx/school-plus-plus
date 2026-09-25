function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

function validateRedirect(redirectTo) {
  const url = new URL(redirectTo);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  ) {
    throw new Error(
      "Ссылка возврата должна вести на HTTPS-сайт или локальный сервер.",
    );
  }
  return url.href;
}

function createCloudAuth(client) {
  return Object.freeze({
    async signIn(email, password) {
      return unwrap(
        await client.auth.signInWithPassword({ email: email.trim(), password }),
      );
    },
    async signInAnonymously() {
      return unwrap(await client.auth.signInAnonymously());
    },
    async signUp(email, password, redirectTo) {
      return unwrap(
        await client.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: validateRedirect(redirectTo) },
        }),
      );
    },
    async getUser() {
      const result = await client.auth.getUser();
      if (
        result.error?.name === "AuthSessionMissingError" ||
        result.error?.code === "session_not_found"
      )
        return null;
      return unwrap(result).user;
    },
    async signOut() {
      // A failed logout must not be shown as successful by the interface.
      unwrap(await client.auth.signOut());
    },
    async requestPasswordReset(email, redirectTo) {
      return unwrap(
        await client.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: validateRedirect(redirectTo),
        }),
      );
    },
    async updatePassword(password) {
      return unwrap(await client.auth.updateUser({ password }));
    },
    onChange(listener) {
      const { data } = client.auth.onAuthStateChange(listener);
      return () => data.subscription.unsubscribe();
    },
  });
}

export { createCloudAuth };
