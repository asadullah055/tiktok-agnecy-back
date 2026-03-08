const IncomeRecord = require("../models/IncomeRecord");
const IncomeSource = require("../models/IncomeSource");
const Profile = require("../models/Profile");
const asyncHandler = require("../middlewares/asyncHandler");
const { logActivity } = require("../services/activityService");

const DEFAULT_INCOME_SOURCES = ["Gift Revenue", "Live Bonus", "Agency Commission", "Sponsorship"];
const FIXED_EXPENSES = [
  { key: "office_rent", title: "Office Rent", amount: 150 },
  { key: "team_salary", title: "Team Salary", amount: 280 },
  { key: "tools", title: "Software Tools", amount: 90 }
];

const hasValue = (value) => value !== undefined && value !== null && value !== "";
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const fixedExpenseTotal = () => FIXED_EXPENSES.reduce((sum, item) => sum + Number(item.amount || 0), 0);

const ensureDefaultIncomeSources = async () => {
  const count = await IncomeSource.countDocuments();
  if (count > 0) return;

  try {
    await IncomeSource.insertMany(DEFAULT_INCOME_SOURCES.map((name) => ({ name })));
  } catch (error) {
    if (error.code !== 11000) {
      throw error;
    }
  }
};

const findIncomeSourceByName = async (name) => {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;
  const pattern = new RegExp(`^${escapeRegex(trimmed)}$`, "i");
  return IncomeSource.findOne({ name: pattern });
};

const listIncomeRecords = asyncHandler(async (req, res) => {
  const { type, expenseMode } = req.query;
  const filters = {};

  if (type === "expense") {
    filters.type = "expense";
  } else if (type === "income") {
    filters.$or = [{ type: "income" }, { type: { $exists: false } }];
  }

  if (expenseMode && filters.type === "expense") {
    filters.expenseMode = expenseMode;
  }

  const records = await IncomeRecord.find(filters)
    .populate("profile", "name tiktokData.creatorName")
    .sort({ date: -1, createdAt: -1 });

  const normalizedRecords = records.map((record) => {
    const row = record.toObject();
    const fallbackAmount = Number(row.amount ?? row.totalRevenue ?? 0);
    return {
      ...row,
      type: row.type || "income",
      expenseMode: row.expenseMode || "variable",
      title: row.title || row.incomeType || "General",
      incomeType: row.incomeType || "General",
      amount: Math.abs(fallbackAmount),
      totalRevenue: Number(row.totalRevenue ?? fallbackAmount)
    };
  });

  res.json({ success: true, data: normalizedRecords });
});

const addIncomeRecord = asyncHandler(async (req, res) => {
  const { profile, date, incomeType, amount, creatorIncome, agencyCommission, type, expenseMode, title } = req.body;

  const recordType = type === "expense" ? "expense" : "income";
  const providedAmount = hasValue(amount)
    ? Number(amount)
    : Number(creatorIncome || 0) + Number(agencyCommission || 0);

  if (!Number.isFinite(providedAmount) || providedAmount <= 0) {
    res.status(400);
    throw new Error("Amount must be greater than 0");
  }

  if (recordType === "expense") {
    const expenseTitle = String(title || incomeType || "").trim();
    if (!expenseTitle) {
      res.status(400);
      throw new Error("Expense title is required");
    }

    const mode = expenseMode === "fixed" ? "fixed" : "variable";
    const expensePayload = {
      type: "expense",
      expenseMode: mode,
      title: expenseTitle,
      incomeType: expenseTitle,
      amount: providedAmount,
      date,
      creatorIncome: 0,
      agencyCommission: 0,
      totalRevenue: providedAmount * -1
    };

    if (profile) {
      expensePayload.profile = profile;
    }

    const record = await IncomeRecord.create(expensePayload);

    await logActivity({
      type: "expense_record_created",
      module: "tiktok",
      profile,
      message: `${mode} expense added: ${expenseTitle}`
    });

    res.status(201).json({ success: true, data: record });
    return;
  }

  const sourceInput = String(incomeType || "Partner Revenew").trim();
  const creatorIncomeNumber = Number(creatorIncome || providedAmount);
  const agencyCommissionNumber = Number(agencyCommission || 0);

  const existingSource = await findIncomeSourceByName(sourceInput);
  const sourceName = existingSource?.name || sourceInput;
  if (!existingSource) {
    await IncomeSource.create({ name: sourceInput });
  }

  const payload = {
    type: "income",
    incomeType: sourceName,
    title: sourceName,
    amount: providedAmount,
    date,
    creatorIncome: Number.isFinite(creatorIncomeNumber) ? creatorIncomeNumber : providedAmount,
    agencyCommission: Number.isFinite(agencyCommissionNumber) ? agencyCommissionNumber : 0,
    totalRevenue: providedAmount
  };

  if (profile) {
    payload.profile = profile;
  }

  const record = await IncomeRecord.create(payload);

  await logActivity({
    type: "income_record_created",
    module: "tiktok",
    profile,
    message: `Revenew record created for ${sourceName}`
  });

  res.status(201).json({ success: true, data: record });
});

const getIncomeSummary = asyncHandler(async (req, res) => {
  const [partnerIncomeAgg, variableExpenseAgg, variableExpenseByType] = await Promise.all([
    Profile.aggregate([
      { $match: { moduleMembership: "tiktok" } },
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ["$tiktokData.partnerRevenue", 0] } },
          count: {
            $sum: {
              $cond: [{ $gt: [{ $ifNull: ["$tiktokData.partnerRevenue", 0] }, 0] }, 1, 0]
            }
          }
        }
      }
    ]),
    IncomeRecord.aggregate([
      { $match: { type: "expense", expenseMode: { $ne: "fixed" } } },
      { $group: { _id: null, total: { $sum: { $ifNull: ["$amount", 0] } }, count: { $sum: 1 } } }
    ]),
    IncomeRecord.aggregate([
      { $match: { type: "expense", expenseMode: { $ne: "fixed" } } },
      { $group: { _id: "$title", total: { $sum: { $ifNull: ["$amount", 0] } }, count: { $sum: 1 } } },
      { $sort: { total: -1 } }
    ])
  ]);

  const partnerIncomeTotal = Number(partnerIncomeAgg[0]?.total || 0);
  const partnerPaidCount = Number(partnerIncomeAgg[0]?.count || 0);
  const fixedExpense = fixedExpenseTotal();
  const variableExpense = Number(variableExpenseAgg[0]?.total || 0);
  const variableCount = Number(variableExpenseAgg[0]?.count || 0);
  const totalExpense = fixedExpense + variableExpense;
  const netRevenew = partnerIncomeTotal - totalExpense;

  res.json({
    success: true,
    data: {
      totalIncome: partnerIncomeTotal,
      totalExpense,
      fixedExpense,
      variableExpense,
      totalRevenue: netRevenew,
      netRevenew,
      creatorIncome: partnerIncomeTotal,
      agencyCommission: 0,
      recordCount: variableCount,
      incomeCount: partnerPaidCount,
      byType: variableExpenseByType.map((entry) => ({
        incomeType: entry._id || "Variable Expense",
        total: entry.total,
        count: entry.count
      }))
    }
  });
});

const listIncomeSources = asyncHandler(async (req, res) => {
  await ensureDefaultIncomeSources();
  const sources = await IncomeSource.find().sort({ name: 1 });
  res.json({ success: true, data: sources });
});

const addIncomeSource = asyncHandler(async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) {
    res.status(400);
    throw new Error("Revenew source name is required");
  }

  const existing = await findIncomeSourceByName(name);
  if (existing) {
    res.status(200).json({ success: true, data: existing });
    return;
  }

  const source = await IncomeSource.create({ name });
  await logActivity({
    type: "income_source_created",
    module: "tiktok",
    message: `Revenew source created: ${source.name}`
  });

  res.status(201).json({ success: true, data: source });
});

const listFixedExpenses = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      items: FIXED_EXPENSES,
      monthlyTotal: fixedExpenseTotal()
    }
  });
});

module.exports = {
  listIncomeRecords,
  addIncomeRecord,
  getIncomeSummary,
  listIncomeSources,
  addIncomeSource,
  listFixedExpenses
};
