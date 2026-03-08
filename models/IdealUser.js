const mongoose = require("mongoose");

const idealUserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true },
    diamonds: { type: Number, default: 0, min: 0 },
    revenew: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }
);

idealUserSchema.index({ username: 1, createdAt: -1 });

module.exports = mongoose.model("IdealUser", idealUserSchema);
