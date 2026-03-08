const mongoose = require("mongoose");

const appointmentSchema = new mongoose.Schema(
  {
    profile: { type: mongoose.Schema.Types.ObjectId, ref: "Profile" },
    source: {
      type: String,
      enum: ["ai_receptionist", "insurance", "tiktok"],
      default: "ai_receptionist"
    },
    scheduledFor: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ["scheduled", "completed", "cancelled", "no_show"],
      default: "scheduled"
    },
    notes: { type: String, trim: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Appointment", appointmentSchema);
