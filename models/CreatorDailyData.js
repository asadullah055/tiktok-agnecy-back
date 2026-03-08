const mongoose = require("mongoose");

const creatorDailyDataSchema = new mongoose.Schema(
  {
    profile: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Profile",
      required: true,
      index: true
    },
    date: { type: Date, required: true, index: true },
    gifts: { type: Number, default: 0, min: 0 },
    diamonds: { type: Number, default: 0, min: 0 },
    income: { type: Number, default: 0, min: 0 },
    liveHours: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }
);

creatorDailyDataSchema.index({ profile: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("CreatorDailyData", creatorDailyDataSchema);
