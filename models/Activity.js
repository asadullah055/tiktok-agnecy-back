const mongoose = require("mongoose");

const activitySchema = new mongoose.Schema(
  {
    type: { type: String, required: true, trim: true },
    module: { type: String, enum: ["insurance", "tiktok", "global"], default: "global" },
    message: { type: String, required: true, trim: true },
    profile: { type: mongoose.Schema.Types.ObjectId, ref: "Profile" },
    metadata: { type: Object, default: {} }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Activity", activitySchema);
