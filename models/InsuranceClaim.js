const mongoose = require("mongoose");

const insuranceClaimSchema = new mongoose.Schema(
  {
    claimNumber: { type: String, required: true, trim: true, index: true },
    policyNumber: { type: String, trim: true, index: true },
    claimDate: { type: Date },
    incidentDate: { type: Date },
    claimType: { type: String, trim: true },
    claimDescription: { type: String, trim: true },
    claimStatus: { type: String, trim: true },
    claimAmountRequested: { type: Number, default: 0, min: 0 },
    claimAmountApproved: { type: Number, default: 0, min: 0 },
    adjusterDetails: { type: String, trim: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("InsuranceClaim", insuranceClaimSchema);
