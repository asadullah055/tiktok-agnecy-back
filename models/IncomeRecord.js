const mongoose = require("mongoose");

const incomeRecordSchema = new mongoose.Schema(
  {
    profile: { type: mongoose.Schema.Types.ObjectId, ref: "Profile" },
    type: { type: String, enum: ["income", "expense"], default: "income", index: true },
    expenseMode: { type: String, enum: ["fixed", "variable"], default: "variable" },
    title: { type: String, trim: true },
    incomeType: { type: String, default: "General", trim: true, index: true },
    amount: { type: Number, default: 0, min: 0 },
    date: { type: Date, default: Date.now, index: true },
    creatorIncome: { type: Number, default: 0, min: 0 },
    agencyCommission: { type: Number, default: 0, min: 0 },
    totalRevenue: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model("IncomeRecord", incomeRecordSchema);
