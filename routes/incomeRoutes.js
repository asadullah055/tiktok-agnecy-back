const express = require("express");
const {
  listIncomeRecords,
  addIncomeRecord,
  getIncomeSummary,
  listIncomeSources,
  addIncomeSource,
  listFixedExpenses,
  addFixedExpense
} = require("../controllers/incomeController");

const router = express.Router();

router.route("/records").get(listIncomeRecords).post(addIncomeRecord);
router.get("/summary", getIncomeSummary);
router.route("/sources").get(listIncomeSources).post(addIncomeSource);
router.route("/fixed-expenses").get(listFixedExpenses).post(addFixedExpense);

module.exports = router;
