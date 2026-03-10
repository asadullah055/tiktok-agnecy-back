const mongoose = require("mongoose");

const fixedExpenseSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    title: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

fixedExpenseSchema.index({ key: 1 }, { unique: true });
fixedExpenseSchema.index({ title: 1 });

module.exports = mongoose.model("FixedExpense", fixedExpenseSchema);
