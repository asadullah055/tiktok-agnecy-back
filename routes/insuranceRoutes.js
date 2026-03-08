const express = require("express");
const {
  listInsuranceCustomers,
  createInsuranceCustomer,
  updateInsuranceCustomer,
  deleteInsuranceCustomer,
  listInsurancePolicies,
  createInsurancePolicy,
  listInsuranceClaims,
  createInsuranceClaim,
  listInsurancePayments,
  createInsurancePayment
} = require("../controllers/insuranceController");

const router = express.Router();

router.route("/customers").get(listInsuranceCustomers).post(createInsuranceCustomer);
router.route("/customers/:id").put(updateInsuranceCustomer).delete(deleteInsuranceCustomer);
router.route("/policies").get(listInsurancePolicies).post(createInsurancePolicy);
router.route("/claims").get(listInsuranceClaims).post(createInsuranceClaim);
router.route("/payments").get(listInsurancePayments).post(createInsurancePayment);

module.exports = router;
