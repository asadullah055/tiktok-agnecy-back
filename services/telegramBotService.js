const getTelegramBotToken = () => {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }
  return token;
};

const getTelegramApiBase = () => `https://api.telegram.org/bot${getTelegramBotToken()}`;
const getTelegramFileBase = () => `https://api.telegram.org/file/bot${getTelegramBotToken()}`;

const parseTelegramResponse = async (response) => {
  const data = await response.json();
  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || "Telegram API request failed");
  }
  return data.result;
};

const telegramRequest = async (method, payload = {}) => {
  const response = await fetch(`${getTelegramApiBase()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  return parseTelegramResponse(response);
};

const sendTelegramMessage = async ({ chatId, text, replyToMessageId }) => {
  if (!chatId) {
    throw new Error("chatId is required");
  }

  return telegramRequest("sendMessage", {
    chat_id: chatId,
    text: String(text || "").trim() || "I could not generate a response.",
    reply_to_message_id: replyToMessageId || undefined
  });
};

const getTelegramFile = async (fileId) => {
  if (!fileId) {
    throw new Error("fileId is required");
  }

  const file = await telegramRequest("getFile", { file_id: fileId });
  if (!file?.file_path) {
    throw new Error("Telegram did not return file_path");
  }

  const fileResponse = await fetch(`${getTelegramFileBase()}/${file.file_path}`);
  if (!fileResponse.ok) {
    throw new Error("Failed to download Telegram voice file");
  }

  const arrayBuffer = await fileResponse.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    filePath: file.file_path
  };
};

const extractTelegramMessage = (update) => {
  const message = update?.message || update?.edited_message;
  if (!message?.chat?.id) return null;

  return {
    chatId: message.chat.id,
    messageId: message.message_id,
    text: String(message.text || message.caption || "").trim(),
    voiceFileId: message.voice?.file_id || "",
    from: message.from || {}
  };
};

const setTelegramWebhook = async ({ webhookUrl, secretToken }) => {
  if (!webhookUrl) {
    throw new Error("webhookUrl is required");
  }

  return telegramRequest("setWebhook", {
    url: webhookUrl,
    secret_token: secretToken || undefined,
    allowed_updates: ["message", "edited_message"]
  });
};

module.exports = {
  getTelegramBotToken,
  sendTelegramMessage,
  getTelegramFile,
  extractTelegramMessage,
  setTelegramWebhook
};
