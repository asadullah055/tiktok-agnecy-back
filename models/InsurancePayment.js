const mongoose = require("mongoose");

const insurancePaymentSchema = new mongoose.Schema(
  {
    paymentId: { type: String, required: true, trim: true, index: true },
    policyNumber: { type: String, trim: true, index: true },
    paymentAmount: { type: Number, default: 0, min: 0 },
    paymentDate: { type: Date },
    paymentMethod: { type: String, trim: true },
    paymentStatus: { type: String, trim: true },
    invoiceNumber: { type: String, trim: true },
    outstandingBalance: { type: Number, default: 0, min: 0 },
    lateFees: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model("InsurancePayment", insurancePaymentSchema);
