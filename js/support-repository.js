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
            .select(
              "id, conversation_id, sender_id, body, created_at, read_at, support_attachments(id, kind, file_name, content_type, size_bytes, storage_path, expires_at, deleted_at)",
            )
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
    async sendMessageWithAttachments(conversationId, body, attachments) {
      const user = await getUser();
      const bucket = client.storage.from("support-attachments");
      const uploaded = [];
      try {
        for (const attachment of attachments || []) {
          const { file, kind } = attachment;
          const storageName = createStorageObjectName(file?.name);
          const storagePath = `${conversationId}/${user.id}/${storageName}`;
          const contentType = inferContentType(file, kind);
          unwrap(
            await bucket.upload(storagePath, file, {
              contentType,
              upsert: false,
            }),
          );
          uploaded.push({
            kind,
            file_name: truncateFileName(file?.name || "attachment", 180),
            content_type: contentType.slice(0, 120),
            size_bytes: Number(file?.size) || 0,
            storage_path: storagePath,
          });
        }
        return unwrap(
          await client.rpc("send_support_message_with_attachments", {
            p_conversation_id: conversationId,
            p_body: String(body || "").trim(),
            p_attachments: uploaded,
          }),
        );
      } catch (error) {
        if (uploaded.length)
          await bucket
            .remove(uploaded.map((item) => item.storage_path))
            .catch(() => {});
        throw error;
      }
    },
    async getAttachmentUrl(attachment) {
      await getUser();
      if (
        attachment?.deleted_at ||
        Date.parse(attachment?.expires_at || "") <= Date.now()
      )
        return "";
      const result = await client.storage
        .from("support-attachments")
        .createSignedUrl(attachment.storage_path, 60);
      const data = unwrap(result);
      return data?.signedUrl || data?.signedURL || "";
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
          { event: "*", schema: "public", table: "support_attachments" },
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

function sanitizeFileName(value) {
  const normalized = String(value || "attachment")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\p{Cc}+/gu, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || "attachment").slice(-120);
}

function createStorageObjectName(fileName) {
  const extension = String(fileName || "")
    .normalize("NFKC")
    .match(/\.([a-z0-9]{1,12})$/i)?.[1]
    ?.toLowerCase();
  return `${crypto.randomUUID()}${extension ? `.${extension}` : ""}`;
}

function truncateFileName(fileName, maxLength = 180) {
  const value = String(fileName || "attachment").normalize("NFKC");
  if (value.length <= maxLength) return value;
  const match = value.match(/(\.[^./\\]{1,16})$/);
  const extension = match?.[1] || "";
  const available = Math.max(1, maxLength - extension.length - 1);
  return `${value.slice(0, available)}…${extension}`;
}

function inferContentType(file, kind = "file") {
  const declared = String(file?.type || "").trim().toLowerCase();
  if (declared) return declared;
  const extension = String(file?.name || "")
    .split(".")
    .pop()
    ?.toLowerCase();
  const known = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
    heic: "image/heic",
    heif: "image/heif",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
  };
  return known[extension] || `${kind === "photo" ? "image" : kind === "video" ? "video" : "application"}/${kind === "file" ? "octet-stream" : "unknown"}`;
}

export {
  createStorageObjectName,
  createSupportRepository,
  inferContentType,
  sanitizeFileName,
  truncateFileName,
};
