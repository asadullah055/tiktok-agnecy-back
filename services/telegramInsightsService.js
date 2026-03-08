const dayjs = require("dayjs");
const Profile = require("../models/Profile");
const Message = require("../models/Message");
const Appointment = require("../models/Appointment");
const InsurancePolicy = require("../models/InsurancePolicy");
const InsuranceClaim = require("../models/InsuranceClaim");
const InsurancePayment = require("../models/InsurancePayment");
const { currency } = require("./formatService");
const { isOpenAiConfigured, chatWithOpenAi } = require("./openAiService");

const normalizeText = (value) => String(value || "").toLowerCase().trim();

const includesAny = (text, keywords) => keywords.some((key) => text.includes(key));

const identifyIntent = (rawText) => {
  const text = normalizeText(rawText);

  const asksPartnerIncome = includesAny(text, ["partner", "parner", "পার্টনার"]) && includesAny(text, ["income", "revenew", "revenue", "ইনকাম"]);
  const asksBreakdown = includesAny(text, ["kon", "which", "breakdown", "list", "from", "কোন"]);
  if (asksPartnerIncome && asksBreakdown) return "partner_income_breakdown";
  if (asksPartnerIncome) return "partner_income_total";

  if (includesAny(text, ["creator", "creatro", "interest", "interrest", "ইন্টারেস্ট"])) {
    return "interested_creators";
  }

  if (includesAny(text, ["upcoming", "appointment", "appint", "আগামী"])) {
    return "upcoming_appointments";
  }

  if (includesAny(text, ["insurance statistics", "insurance stats", "insurance overview", "insurance", "ইনস্যুরেন্স"])) {
    return "insurance_statistics";
  }

  return "general";
};

const getPartnerIncomeBreakdown = async (limit = 15) => {
  const rows = await Profile.find({
    moduleMembership: "tiktok",
    "tiktokData.partnerRevenue": { $gt: 0 }
  })
    .select("name tiktokData.creatorName tiktokData.partnerRevenue")
    .sort({ "tiktokData.partnerRevenue": -1 })
    .limit(limit)
    .lean();

  return rows.map((row) => ({
    name: row.tiktokData?.creatorName || row.name || "-",
    income: Number(row.tiktokData?.partnerRevenue || 0)
  }));
};

const getPartnerIncomeTotal = async () => {
  const agg = await Profile.aggregate([
    { $match: { moduleMembership: "tiktok" } },
    { $group: { _id: null, total: { $sum: { $ifNull: ["$tiktokData.partnerRevenue", 0] } } } }
  ]);

  return Number(agg[0]?.total || 0);
};

const getInterestedCreatorsCount = async () => {
  const agg = await Message.aggregate([
    { $match: { deliveryStatus: "reply", profile: { $exists: true, $ne: null } } },
    { $group: { _id: "$profile" } },
    { $count: "count" }
  ]);

  return Number(agg[0]?.count || 0);
};

const getUpcomingAppointments = async (limit = 7) => {
  const appointments = await Appointment.find({
    scheduledFor: { $gte: new Date() },
    status: "scheduled"
  })
    .populate("profile", "name phone")
    .sort({ scheduledFor: 1 })
    .limit(limit)
    .lean();

  return appointments.map((item) => ({
    customer: item.profile?.name || "-",
    phone: item.profile?.phone || "-",
    when: item.scheduledFor
  }));
};

const getInsuranceStatistics = async () => {
  const [
    totalClients,
    activePolicies,
    pendingClaims,
    paidPaymentsAgg,
    outstandingAgg
  ] = await Promise.all([
    Profile.countDocuments({ moduleMembership: "insurance" }),
    InsurancePolicy.countDocuments({ policyStatus: "active" }),
    InsuranceClaim.countDocuments({ claimStatus: "pending" }),
    InsurancePayment.aggregate([
      { $match: { paymentStatus: "paid" } },
      { $group: { _id: null, total: { $sum: { $ifNull: ["$paymentAmount", 0] } } } }
    ]),
    InsurancePayment.aggregate([
      { $group: { _id: null, total: { $sum: { $ifNull: ["$outstandingBalance", 0] } } } }
    ])
  ]);

  return {
    totalClients,
    activePolicies,
    pendingClaims,
    collectedPayments: Number(paidPaymentsAgg[0]?.total || 0),
    outstandingBalance: Number(outstandingAgg[0]?.total || 0)
  };
};

const buildMetricsSnapshot = async () => {
  const [breakdown, totalIncome, interestedCreators, upcoming, insurance] = await Promise.all([
    getPartnerIncomeBreakdown(8),
    getPartnerIncomeTotal(),
    getInterestedCreatorsCount(),
    getUpcomingAppointments(5),
    getInsuranceStatistics()
  ]);

  return {
    breakdown,
    totalIncome,
    interestedCreators,
    upcoming,
    insurance
  };
};

const formatPartnerIncomeBreakdown = (rows) => {
  if (!rows.length) return "No partner income data found.";
  return [
    "Partner income breakdown:",
    ...rows.map((row, index) => `${index + 1}. ${row.name}: ${currency(row.income)}`)
  ].join("\n");
};

const formatPartnerIncomeTotal = (total) => `Total partner income: ${currency(total)}.`;

const formatInterestedCreators = (count) => `Interested creators (reply received): ${count}.`;

const formatUpcomingAppointments = (rows) => {
  if (!rows.length) return "No upcoming appointments found.";
  return [
    "Upcoming appointments:",
    ...rows.map((row, index) => `${index + 1}. ${row.customer} (${row.phone}) - ${dayjs(row.when).format("MMM DD, hh:mm A")}`)
  ].join("\n");
};

const formatInsuranceStatistics = (stats) =>
  [
    "Insurance statistics:",
    `- Total clients: ${stats.totalClients}`,
    `- Active policies: ${stats.activePolicies}`,
    `- Pending claims: ${stats.pendingClaims}`,
    `- Collected payments: ${currency(stats.collectedPayments)}`,
    `- Outstanding balance: ${currency(stats.outstandingBalance)}`
  ].join("\n");

const buildDeterministicReply = (intent, snapshot) => {
  if (intent === "partner_income_breakdown") return formatPartnerIncomeBreakdown(snapshot.breakdown);
  if (intent === "partner_income_total") return formatPartnerIncomeTotal(snapshot.totalIncome);
  if (intent === "interested_creators") return formatInterestedCreators(snapshot.interestedCreators);
  if (intent === "upcoming_appointments") return formatUpcomingAppointments(snapshot.upcoming);
  if (intent === "insurance_statistics") return formatInsuranceStatistics(snapshot.insurance);
  return "";
};

const buildContextText = (snapshot) =>
  [
    `Total partner income: ${snapshot.totalIncome}`,
    `Interested creators count: ${snapshot.interestedCreators}`,
    `Insurance stats: clients=${snapshot.insurance.totalClients}, activePolicies=${snapshot.insurance.activePolicies}, pendingClaims=${snapshot.insurance.pendingClaims}, collectedPayments=${snapshot.insurance.collectedPayments}, outstanding=${snapshot.insurance.outstandingBalance}`,
    `Partner breakdown: ${snapshot.breakdown.map((item) => `${item.name}:${item.income}`).join(", ") || "none"}`,
    `Upcoming appointments: ${snapshot.upcoming.map((item) => `${item.customer} at ${item.when}`).join(", ") || "none"}`
  ].join("\n");

const buildLlmReply = async (userText, snapshot) => {
  if (!isOpenAiConfigured()) {
    return "OpenAI is not configured. Ask about partner income, interested creators, upcoming appointments, or insurance statistics.";
  }

  const systemPrompt =
    "You are a CRM Telegram assistant. Reply concisely in the same language style as the user (Bangla/English mixed allowed). Use only provided CRM data. If data is missing, say so clearly.";

  const userPrompt = `User question:\n${userText}\n\nCRM data snapshot:\n${buildContextText(snapshot)}`;
  const answer = await chatWithOpenAi({ systemPrompt, userPrompt, temperature: 0.1 });

  return answer || "I could not generate a response right now.";
};

const generateTelegramAssistantReply = async (userText) => {
  const snapshot = await buildMetricsSnapshot();
  const intent = identifyIntent(userText);
  const deterministic = buildDeterministicReply(intent, snapshot);
  if (deterministic) return deterministic;
  return buildLlmReply(userText, snapshot);
};

module.exports = {
  generateTelegramAssistantReply,
  buildMetricsSnapshot,
  identifyIntent
};
