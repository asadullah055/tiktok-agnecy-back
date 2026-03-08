const mongoose = require("mongoose");

const telegramIntegrationSchema = new mongoose.Schema(
  {
    workspaceKey: { type: String, required: true, trim: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["unlinked", "pending", "linked"],
      default: "unlinked"
    },
    linkCode: { type: String, trim: true, index: true },
    linkCodeExpiresAt: { type: Date },
    chatId: { type: Number, index: true },
    telegramUserId: { type: Number },
    telegramUsername: { type: String, trim: true },
    telegramDisplayName: { type: String, trim: true },
    linkedAt: { type: Date },
    lastInteractionAt: { type: Date }
  },
  { timestamps: true }
);

module.exports = mongoose.model("TelegramIntegration", telegramIntegrationSchema);
