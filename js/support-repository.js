function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

function createSupportRepository(client) {
  async function getUser() {
    const result = await client.auth.getUser();
    if (result.error) throw result.error;
    if (!result.data.user) throw new Error("SUPPORT_AUTH_REQUIRED");
    return result.data.user;
  }

  return Object.freeze({
    async isAgent() {
      await getUser();
      return Boolean(unwrap(await client.rpc("is_support_agent")));
    },
    async listConversations() {
      await getUser();
      return (
        unwrap(
          await client
            .from("support_conversations")
            .select("id, owner_id, owner_label, subject, status, created_at, updated_at")
            .order("updated_at", { ascending: false }),
        ) || []
      );
    },
    async createConversation(subject = "Новый вопрос", ownerLabel = "Пользователь") {
      const user = await getUser();
      return unwrap(
        await client
          .from("support_conversations")
          .insert({
            owner_id: user.id,
            owner_label: String(ownerLabel || "Пользователь").trim().slice(0, 80),
            subject: String(subject).slice(0, 120),
          })
          .select("id, owner_id, owner_label, subject, status, created_at, updated_at")
          .single(),
      );
    },
    async listMessages(conversationId) {
      await getUser();
      return (
        unwrap(
          await client
            .from("support_messages")
            .select("id, conversation_id, sender_id, body, created_at, read_at")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: true }),
        ) || []
      );
    },
    async sendMessage(conversationId, body) {
      const user = await getUser();
      return unwrap(
        await client
          .from("support_messages")
          .insert({
            conversation_id: conversationId,
            sender_id: user.id,
            body: String(body).trim().slice(0, 2000),
          })
          .select("id, conversation_id, sender_id, body, created_at, read_at")
          .single(),
      );
    },
    async markConversationRead(conversationId) {
      await getUser();
      unwrap(
        await client.rpc("mark_support_messages_read", {
          p_conversation_id: conversationId,
        }),
      );
    },
    async closeConversation(conversationId) {
      await getUser();
      return unwrap(
        await client
          .from("support_conversations")
          .update({ status: "closed" })
          .eq("id", conversationId)
          .select("id, owner_id, owner_label, subject, status, created_at, updated_at")
          .single(),
      );
    },
    async createDiaryRequest({ name, diaryUrl, contact }) {
      const user = await getUser();
      return unwrap(
        await client
          .from("diary_requests")
          .insert({
            owner_id: user.id,
            requester_name: String(name || "").trim().slice(0, 80),
            diary_url: String(diaryUrl || "").trim().slice(0, 300),
            contact: String(contact || "").trim().slice(0, 200),
          })
          .select(
            "id, owner_id, requester_name, diary_url, contact, status, created_at, updated_at",
          )
          .single(),
      );
    },
    async listDiaryRequests() {
      await getUser();
      return (
        unwrap(
          await client
            .from("diary_requests")
            .select(
              "id, owner_id, requester_name, diary_url, contact, status, created_at, updated_at",
            )
            .order("created_at", { ascending: false }),
        ) || []
      );
    },
    async updateDiaryRequestStatus(requestId, nextStatus) {
      await getUser();
      return unwrap(
        await client
          .from("diary_requests")
          .update({ status: nextStatus })
          .eq("id", requestId)
          .select(
            "id, owner_id, requester_name, diary_url, contact, status, created_at, updated_at",
          )
          .single(),
      );
    },
    subscribe(onChange) {
      const channel = client
        .channel(`schoolpp-support-${crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "support_conversations" },
          onChange,
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "support_messages" },
          onChange,
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "diary_requests" },
          onChange,
        )
        .subscribe();
      return () => client.removeChannel(channel);
    },
    getUser,
  });
}

export { createSupportRepository };
