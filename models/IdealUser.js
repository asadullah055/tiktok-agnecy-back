const mongoose = require("mongoose");

const idealUserDaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, trim: true },
    income: { type: Number, default: 0, min: 0 },
    diamonds: { type: Number, default: 0, min: 0 }
  },
  { _id: false }
);

const idealUserSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "" },
    username: { type: String, required: true, trim: true },
    daysCount: { type: Number, default: 30, min: 0 },
    totalIncome: { type: Number, default: 0, min: 0 },
    totalDiamonds: { type: Number, default: 0, min: 0 },
    days: { type: [idealUserDaySchema], default: [] },
    diamonds: { type: Number, default: 0, min: 0 },
    revenew: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }
);

idealUserSchema.index({ username: 1, createdAt: -1 });

module.exports = mongoose.model("IdealUser", idealUserSchema);
