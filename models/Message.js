const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    profile: { type: mongoose.Schema.Types.ObjectId, ref: "Profile", required: true },
    platform: { type: String, enum: ["telegram"], default: "telegram" },
    content: { type: String, required: true, trim: true },
    deliveryStatus: {
      type: String,
      // `queued` and `failed` are kept as legacy values for older records.
      enum: ["sent", "delivered", "delivery_failed", "reply", "queued", "failed"],
      default: "sent",
      index: true
    },
    sentAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Message", messageSchema);
