const mongoose = require("mongoose");

const insurancePolicySchema = new mongoose.Schema(
  {
    policyNumber: { type: String, required: true, trim: true, index: true },
    policyType: { type: String, trim: true },
    insuranceProvider: { type: String, trim: true },
    policyStartDate: { type: Date },
    policyEndDate: { type: Date },
    coverageAmount: { type: Number, default: 0, min: 0 },
    deductibleAmount: { type: Number, default: 0, min: 0 },
    premiumAmount: { type: Number, default: 0, min: 0 },
    paymentFrequency: { type: String, trim: true },
    policyStatus: { type: String, trim: true },
    customerId: { type: String, trim: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("InsurancePolicy", insurancePolicySchema);
