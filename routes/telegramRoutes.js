const express = require("express");
const {
  telegramWebhook,
  getTelegramIntegrationStatus,
  generateTelegramLinkCode,
  unlinkTelegramIntegration,
  getTelegramBotStatus,
  registerTelegramWebhook,
  queryTelegramAssistant
} = require("../controllers/telegramController");

const router = express.Router();

router.post("/webhook", telegramWebhook);
router.get("/integration/status", getTelegramIntegrationStatus);
router.post("/integration/generate-link-code", generateTelegramLinkCode);
router.post("/integration/unlink", unlinkTelegramIntegration);
router.get("/status", getTelegramBotStatus);
router.post("/set-webhook", registerTelegramWebhook);
router.post("/ask", queryTelegramAssistant);

module.exports = router;
