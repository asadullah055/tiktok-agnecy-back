const asyncHandler = require("../middlewares/asyncHandler");
const crypto = require("crypto");
const TelegramIntegration = require("../models/TelegramIntegration");
const { transcribeAudio } = require("../services/openAiService");
const {
  extractTelegramMessage,
  getTelegramFile,
  sendTelegramMessage,
  setTelegramWebhook
} = require("../services/telegramBotService");
const { generateTelegramAssistantReply, buildMetricsSnapshot } = require("../services/telegramInsightsService");

const LINK_CODE_TTL_MINUTES = Number(process.env.TELEGRAM_LINK_CODE_TTL_MINUTES || 15);

const getTelegramBotUsername = () => String(process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "").trim();

const generateLinkCode = () => `ET-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

const extractStartPayload = (text) => {
  const value = String(text || "").trim();
  if (!value.toLowerCase().startsWith("/start")) return "";
  const parts = value.split(/\s+/);
  return String(parts[1] || "").trim();
};

const normalizeLinkCodePayload = (payload) => String(payload || "").replace(/^link_/i, "").trim().toUpperCase();

const resolveDisplayName = (from = {}) => {
  const first = String(from.first_name || "").trim();
  const last = String(from.last_name || "").trim();
  const full = `${first} ${last}`.trim();
  return full || String(from.username || "").trim() || `User ${from.id || ""}`.trim();
};

const buildDeepLink = (linkCode) => {
  const username = getTelegramBotUsername();
  if (!username || !linkCode) return "";
  return `https://t.me/${username}?start=${encodeURIComponent(`link_${linkCode}`)}`;
};

const linkTelegramChatWithCode = async (message, rawPayload) => {
  const payload = normalizeLinkCodePayload(rawPayload);
  if (!payload) return null;

  const now = new Date();
  const integration = await TelegramIntegration.findOne({
    linkCode: payload,
    linkCodeExpiresAt: { $gt: now }
  });

  if (!integration) {
    return { linked: false };
  }

  integration.status = "linked";
  integration.chatId = Number(message.chatId);
  integration.telegramUserId = Number(message.from?.id || 0) || undefined;
  integration.telegramUsername = String(message.from?.username || "").trim() || undefined;
  integration.telegramDisplayName = resolveDisplayName(message.from);
  integration.linkedAt = now;
  integration.lastInteractionAt = now;
  integration.linkCode = undefined;
  integration.linkCodeExpiresAt = undefined;
  await integration.save();

  return { linked: true, integration };
};

const verifyWebhookSecret = (req) => {
  const expected = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  if (!expected) return true;
  const incoming = String(req.headers["x-telegram-bot-api-secret-token"] || "").trim();
  return incoming && incoming === expected;
};

const processTelegramUpdate = async (update) => {
  const message = extractTelegramMessage(update);
  if (!message) return;
  const startPayload = extractStartPayload(message.text);

  if (startPayload) {
    const linkResult = await linkTelegramChatWithCode(message, startPayload);
    if (linkResult?.linked) {
      await sendTelegramMessage({
        chatId: message.chatId,
        replyToMessageId: message.messageId,
        text: "Telegram account linked successfully. You can now ask CRM questions in natural language."
      });
      return;
    }

    await sendTelegramMessage({
      chatId: message.chatId,
      replyToMessageId: message.messageId,
      text: "Link code invalid or expired. Generate a new link code from Settings page and use /start link_<code>."
    });
    return;
  }

  const integration = await TelegramIntegration.findOne({
    chatId: Number(message.chatId),
    status: "linked"
  });

  if (!integration) {
    await sendTelegramMessage({
      chatId: message.chatId,
      replyToMessageId: message.messageId,
      text: "This Telegram chat is not linked yet. Please generate a link code from Settings and send /start link_<code>."
    });
    return;
  }

  integration.lastInteractionAt = new Date();
  await integration.save();

  let userText = message.text;
  const voiceFileId = message.voiceFileId;

  if (!userText && voiceFileId) {
    const file = await getTelegramFile(voiceFileId);
    userText = await transcribeAudio({
      audioBuffer: file.buffer,
      filename: file.filePath?.split("/").pop() || "voice.ogg",
      mimeType: "audio/ogg"
    });
  }

  if (!userText) {
    await sendTelegramMessage({
      chatId: message.chatId,
      replyToMessageId: message.messageId,
      text: "Please send a text or voice message."
    });
    return;
  }

  const reply = await generateTelegramAssistantReply(userText, {
    displayName: integration.telegramDisplayName || resolveDisplayName(message.from)
  });
  await sendTelegramMessage({
    chatId: message.chatId,
    replyToMessageId: message.messageId,
    text: reply
  });
};

const telegramWebhook = async (req, res) => {
  if (!verifyWebhookSecret(req)) {
    res.status(401).json({ success: false, message: "Invalid Telegram webhook secret" });
    return;
  }

  try {
    // Await processing so serverless runtimes do not terminate before reply is sent.
    await processTelegramUpdate(req.body);
  } catch (error) {
    console.error("Telegram webhook processing failed:", error);

    const fallbackMessage = extractTelegramMessage(req.body);
    const fallbackText = `Could not process your request: ${error.message || "Unknown error"}`;

    if (fallbackMessage?.chatId) {
      try {
        await sendTelegramMessage({
          chatId: fallbackMessage.chatId,
          replyToMessageId: fallbackMessage.messageId,
          text: fallbackText
        });
      } catch (nestedError) {
        console.error("Telegram fallback reply failed:", nestedError);
        try {
          await sendTelegramMessage({
            chatId: fallbackMessage.chatId,
            text: fallbackText
          });
        } catch (finalError) {
          console.error("Telegram fallback without reply-to also failed:", finalError);
        }
      }
    }
  }

  res.json({ success: true });
};

const getTelegramIntegrationStatus = asyncHandler(async (req, res) => {
  const workspaceKey = String(req.query.workspaceKey || "").trim();
  if (!workspaceKey) {
    res.status(400);
    throw new Error("workspaceKey is required");
  }

  const integration = await TelegramIntegration.findOne({ workspaceKey }).lean();
  if (!integration) {
    res.json({
      success: true,
      data: {
        status: "unlinked",
        linked: false,
        chatId: null
      }
    });
    return;
  }

  const hasActiveLinkCode =
    Boolean(integration.linkCode) &&
    Boolean(integration.linkCodeExpiresAt) &&
    new Date(integration.linkCodeExpiresAt).getTime() > Date.now();

  res.json({
    success: true,
    data: {
      status: integration.status || "unlinked",
      linked: integration.status === "linked" && Boolean(integration.chatId),
      chatId: integration.chatId || null,
      telegramUsername: integration.telegramUsername || "",
      telegramDisplayName: integration.telegramDisplayName || "",
      linkedAt: integration.linkedAt || null,
      linkCode: hasActiveLinkCode ? integration.linkCode : "",
      linkCodeExpiresAt: hasActiveLinkCode ? integration.linkCodeExpiresAt : null,
      deepLink: hasActiveLinkCode ? buildDeepLink(integration.linkCode) : "",
      botUsername: getTelegramBotUsername()
    }
  });
});

const generateTelegramLinkCode = asyncHandler(async (req, res) => {
  const workspaceKey = String(req.body?.workspaceKey || req.query?.workspaceKey || "").trim();
  if (!workspaceKey) {
    res.status(400);
    throw new Error("workspaceKey is required");
  }

  const linkCode = generateLinkCode();
  const linkCodeExpiresAt = new Date(Date.now() + LINK_CODE_TTL_MINUTES * 60 * 1000);

  const integration = await TelegramIntegration.findOneAndUpdate(
    { workspaceKey },
    {
      $set: {
        status: "pending",
        linkCode,
        linkCodeExpiresAt,
        chatId: null,
        telegramUserId: null,
        telegramUsername: "",
        telegramDisplayName: "",
        linkedAt: null
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const deepLink = buildDeepLink(linkCode);

  res.json({
    success: true,
    data: {
      workspaceKey,
      status: integration.status,
      linkCode,
      linkCodeExpiresAt,
      deepLink,
      botUsername: getTelegramBotUsername()
    }
  });
});

const unlinkTelegramIntegration = asyncHandler(async (req, res) => {
  const workspaceKey = String(req.body?.workspaceKey || req.query?.workspaceKey || "").trim();
  if (!workspaceKey) {
    res.status(400);
    throw new Error("workspaceKey is required");
  }

  await TelegramIntegration.findOneAndUpdate(
    { workspaceKey },
    {
      $set: {
        status: "unlinked",
        linkCode: "",
        linkCodeExpiresAt: null,
        chatId: null,
        telegramUserId: null,
        telegramUsername: "",
        telegramDisplayName: "",
        linkedAt: null
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.json({ success: true, data: { status: "unlinked" } });
});

const getTelegramBotStatus = asyncHandler(async (req, res) => {
  const snapshot = await buildMetricsSnapshot();
  res.json({
    success: true,
    data: {
      configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.OPENAI_API_KEY),
      hasTelegramToken: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
      metricsPreview: snapshot
    }
  });
});

const registerTelegramWebhook = asyncHandler(async (req, res) => {
  const webhookUrl = String(req.body?.url || process.env.TELEGRAM_WEBHOOK_URL || "").trim();
  if (!webhookUrl) {
    res.status(400);
    throw new Error("Webhook URL is required (send body.url or set TELEGRAM_WEBHOOK_URL)");
  }

  const result = await setTelegramWebhook({
    webhookUrl,
    secretToken: String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim() || undefined
  });

  res.json({ success: true, data: result });
});

const queryTelegramAssistant = asyncHandler(async (req, res) => {
  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) {
    res.status(400);
    throw new Error("prompt is required");
  }

  const reply = await generateTelegramAssistantReply(prompt);
  res.json({ success: true, data: { prompt, reply } });
});

module.exports = {
  telegramWebhook,
  getTelegramIntegrationStatus,
  generateTelegramLinkCode,
  unlinkTelegramIntegration,
  getTelegramBotStatus,
  registerTelegramWebhook,
  queryTelegramAssistant
};
