const mongoose = require("mongoose");

const incomeSourceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true, index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("IncomeSource", incomeSourceSchema);
