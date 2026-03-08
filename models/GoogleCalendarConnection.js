const mongoose = require("mongoose");

const googleCalendarConnectionSchema = new mongoose.Schema(
  {
    connectionKey: { type: String, required: true, trim: true, unique: true, index: true },
    googleAccountEmail: { type: String, trim: true, lowercase: true },
    accessToken: { type: String, trim: true },
    refreshToken: { type: String, trim: true },
    tokenType: { type: String, trim: true },
    scope: { type: String, trim: true },
    expiresAt: { type: Date }
  },
  { timestamps: true }
);

module.exports = mongoose.model("GoogleCalendarConnection", googleCalendarConnectionSchema);
