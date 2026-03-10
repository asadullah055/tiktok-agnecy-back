const FixedExpense = require("../models/FixedExpense");

const DEFAULT_FIXED_EXPENSES = [
  { key: "office_rent", title: "Office Rent", amount: 150 },
  { key: "team_salary", title: "Team Salary", amount: 280 },
  { key: "tools", title: "Software Tools", amount: 90 }
];

const slugifyKey = (value) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

const ensureDefaultFixedExpenses = async () => {
  const count = await FixedExpense.countDocuments({});
  if (count > 0) return;

  await FixedExpense.insertMany(DEFAULT_FIXED_EXPENSES);
};

const toPlain = (doc) => ({
  key: String(doc.key || "").trim(),
  title: String(doc.title || "").trim(),
  amount: Number(doc.amount || 0)
});

const getFixedExpenses = async () => {
  await ensureDefaultFixedExpenses();
  const docs = await FixedExpense.find({ active: true }).sort({ createdAt: 1 }).lean();
  return docs.map(toPlain);
};

const getFixedExpenseTotal = async () => {
  const items = await getFixedExpenses();
  return items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
};

const getFixedExpenseSnapshot = async () => {
  const items = await getFixedExpenses();
  return {
    items,
    monthlyTotal: items.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  };
};

const upsertFixedExpense = async ({ title, amount }) => {
  const normalizedTitle = String(title || "").trim();
  const normalizedAmount = Number(amount || 0);
  if (!normalizedTitle) {
    throw new Error("Fixed expense title is required");
  }
  if (!Number.isFinite(normalizedAmount) || normalizedAmount < 0) {
    throw new Error("Fixed expense amount must be a valid number");
  }

  await ensureDefaultFixedExpenses();

  const titlePattern = new RegExp(`^${normalizedTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  const existing = await FixedExpense.findOne({ title: titlePattern });

  if (existing) {
    existing.amount = normalizedAmount;
    existing.active = true;
    await existing.save();
    return { item: toPlain(existing.toObject()), created: false };
  }

  const keyBase = slugifyKey(normalizedTitle) || "fixed_expense";
  let key = keyBase;
  let suffix = 1;
  while (await FixedExpense.exists({ key })) {
    suffix += 1;
    key = `${keyBase}_${suffix}`;
  }

  const created = await FixedExpense.create({
    key,
    title: normalizedTitle,
    amount: normalizedAmount,
    active: true
  });

  return { item: toPlain(created.toObject()), created: true };
};

module.exports = {
  getFixedExpenses,
  getFixedExpenseTotal,
  getFixedExpenseSnapshot,
  upsertFixedExpense
};
