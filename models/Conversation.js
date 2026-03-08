const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    profile: { type: mongoose.Schema.Types.ObjectId, ref: "Profile" },
    module: { type: String, enum: ["insurance", "tiktok", "global"], default: "global" },
    transcript: { type: String, trim: true, required: true },
    outcome: {
      type: String,
      enum: ["successful", "failed", "follow_up"],
      default: "successful",
      index: true
    },
    channel: { type: String, enum: ["call", "chat"], default: "call" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Conversation", conversationSchema);
