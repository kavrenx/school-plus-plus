function createCloudSession({
  auth,
  onUser,
  onSignedOut,
  onRecovery,
  onError,
  schedule = globalThis.setTimeout,
}) {
  let version = 0;
  let recovery = false;
  let disposed = false;

  async function refresh({ recover = recovery } = {}) {
    recovery = recover;
    const requestVersion = ++version;
    try {
      const user = await auth.getUser();
      if (disposed || requestVersion !== version) return;
      if (!user) {
        onSignedOut();
        return;
      }
      if (recovery) onRecovery(user);
      else onUser(user);
    } catch (error) {
      if (disposed || requestVersion !== version) return;
      if (error.name === "AuthSessionMissingError") onSignedOut();
      else onError(error);
    }
  }

  const unsubscribe = auth.onChange((event) => {
    if (event === "SIGNED_OUT") {
      version++;
      recovery = false;
      onSignedOut();
    } else if (
      [
        "INITIAL_SESSION",
        "SIGNED_IN",
        "PASSWORD_RECOVERY",
        "TOKEN_REFRESHED",
        "USER_UPDATED",
      ].includes(event)
    ) {
      if (event === "PASSWORD_RECOVERY") recovery = true;
      // SDK calls must run outside its synchronous auth-event callback.
      schedule(() => {
        if (!disposed) void refresh();
      }, 0);
    }
  });

  return {
    refresh,
    finishRecovery() {
      return refresh({ recover: false });
    },
    dispose() {
      disposed = true;
      version++;
      unsubscribe();
    },
  };
}

function getCloudErrorMessage(
  error,
  fallback = "Не удалось выполнить запрос. Попробуйте ещё раз.",
) {
  const messages = {
    invalid_credentials: "Неверная почта или пароль.",
    email_not_confirmed: "Подтвердите почту по ссылке из письма.",
    over_email_send_rate_limit:
      "Письма отправляются слишком часто. Попробуйте позже.",
    over_request_rate_limit: "Слишком много попыток. Попробуйте позже.",
    email_address_not_authorized:
      "Отправка писем на этот адрес пока не настроена.",
    weak_password: "Пароль не соответствует требованиям безопасности.",
    same_password: "Новый пароль должен отличаться от предыдущего.",
    otp_expired: "Ссылка устарела. Запросите новое письмо.",
  };
  if (error?.name === "AuthRetryableFetchError" || error instanceof TypeError)
    return "Не удалось связаться с сервером. Проверьте соединение.";
  return messages[error?.code] || fallback;
}

export { createCloudSession, getCloudErrorMessage };
