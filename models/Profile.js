const mongoose = require("mongoose");

const insuranceDataSchema = new mongoose.Schema(
  {
    customerId: { type: String, trim: true },
    dateOfBirth: { type: Date },
    gender: { type: String, trim: true },
    addressStreet: { type: String, trim: true },
    addressCity: { type: String, trim: true },
    addressState: { type: String, trim: true },
    addressZip: { type: String, trim: true },
    ssn: { type: String, trim: true },
    driverLicenseNumber: { type: String, trim: true },
    maritalStatus: { type: String, trim: true },
    occupation: { type: String, trim: true },
    preferredCommunicationMethod: { type: String, trim: true },
    policyType: { type: String, trim: true },
    policyNumber: { type: String, trim: true },
    insuranceProvider: { type: String, trim: true },
    policyStartDate: { type: Date },
    policyEndDate: { type: Date },
    coverageAmount: { type: Number, default: 0, min: 0 },
    deductibleAmount: { type: Number, default: 0, min: 0 },
    premiumAmount: { type: Number, default: 0, min: 0 },
    paymentFrequency: { type: String, trim: true },
    status: {
      type: String,
      enum: ["lead", "active", "pending", "inactive"],
      default: "lead"
    },
    notes: { type: String, trim: true },
    lastContactedAt: { type: Date }
  },
  { _id: false }
);

const tiktokDataSchema = new mongoose.Schema(
  {
    creatorName: { type: String, trim: true },
    tiktokUsername: { type: String, trim: true },
    country: { type: String, trim: true },
    manager: { type: String, trim: true },
    partnerRevenue: { type: Number, default: 0, min: 0 },
    partnerRevenueDate: { type: Date },
    notes: { type: String, trim: true }
  },
  { _id: false }
);

const profileSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, index: true },
    email: { type: String, trim: true, lowercase: true, index: true },
    notes: { type: String, trim: true },
    tags: [{ type: String, trim: true }],
    status: {
      type: String,
      enum: ["lead", "active", "inactive", "archived"],
      default: "lead"
    },
    moduleMembership: {
      type: [{ type: String, enum: ["insurance", "tiktok"] }],
      default: []
    },
    insuranceData: insuranceDataSchema,
    tiktokData: tiktokDataSchema
  },
  { timestamps: true }
);

profileSchema.index({ name: "text", email: "text", phone: "text" });

module.exports = mongoose.model("Profile", profileSchema);
