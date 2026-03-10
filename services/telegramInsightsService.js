const dayjs = require("dayjs");
const Profile = require("../models/Profile");
const Message = require("../models/Message");
const Appointment = require("../models/Appointment");
const IncomeRecord = require("../models/IncomeRecord");
const CreatorDailyData = require("../models/CreatorDailyData");
const IdealUser = require("../models/IdealUser");
const InsurancePolicy = require("../models/InsurancePolicy");
const InsuranceClaim = require("../models/InsuranceClaim");
const InsurancePayment = require("../models/InsurancePayment");
const { currency } = require("./formatService");
const { getFixedExpenseSnapshot } = require("./fixedExpenseService");
const { isOpenAiConfigured, chatWithOpenAi } = require("./openAiService");

const normalizeText = (value) => String(value || "").toLowerCase().trim();

const includesAny = (text, keywords) => keywords.some((key) => text.includes(key));

const isGreetingMessage = (rawText) => {
  const normalized = normalizeText(rawText).replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  const compactGreetings = new Set(["hi", "hii", "hello", "hey", "salam", "slm", "assalamualaikum", "yo"]);
  if (compactGreetings.has(normalized)) return true;

  const phraseGreetings = ["assalamu alaikum", "good morning", "good afternoon", "good evening"];
  if (phraseGreetings.includes(normalized)) return true;

  const words = normalized.split(" ");
  return words.length <= 2 && compactGreetings.has(words[0]);
};

const isHelpRequest = (rawText) => {
  const text = normalizeText(rawText);
  return ["/help", "help", "menu", "commands"].includes(text);
};

const getGreetingByTime = () => {
  const hour = dayjs().hour();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

const identifyIntent = (rawText) => {
  const text = normalizeText(rawText);

  if (isGreetingMessage(text)) return "greeting";
  if (isHelpRequest(text)) return "help";
  if (text === "/appointments" || text === "/appointment") return "upcoming_appointments";
  if (text === "/today_appointments" || text === "/today") return "today_appointments";
  if (text === "/fixed_expenses" || text === "/fixed") return "fixed_expenses_list";
  if (text === "/summary" || text === "/crm") return "crm_overview";

  const asksPartnerIncome = includesAny(text, ["partner"]) && includesAny(text, ["income", "revenue", "earning"]);
  const asksBreakdown = includesAny(text, ["which", "breakdown", "list", "from", "top"]);
  if (asksPartnerIncome && asksBreakdown) return "partner_income_breakdown";
  if (asksPartnerIncome) return "partner_income_total";

  const asksFixedExpenses =
    includesAny(text, ["fixed expense", "fixed expenses", "give list fixed expense", "monthly fixed", "office rent", "team salary"]) &&
    !includesAny(text, ["variable"]);
  if (asksFixedExpenses) return "fixed_expenses_list";

  const asksIdealCreatorCount = includesAny(text, [
    "ideal creator",
    "ideal creators",
    "ideal user",
    "ideal users",
    "how many ideal",
    "ideal count"
  ]);
  if (asksIdealCreatorCount) return "ideal_creators_count";

  if (includesAny(text, ["creator", "interest", "interested"])) {
    return "interested_creators";
  }

  const appointmentRelated = includesAny(text, [
    "upcoming",
    "appointment",
    "appt",
    "meeting",
    "schedule",
    "booked"
  ]);
  const asksAppointmentCheck =
    appointmentRelated &&
    includesAny(text, ["have any", "do i have", "is there any", "do we have"]);
  const asksTodayAppointments = appointmentRelated && includesAny(text, ["today", "todays", "for today"]);

  if (asksAppointmentCheck) return "appointment_check";
  if (asksTodayAppointments) return "today_appointments";
  if (appointmentRelated) {
    return "upcoming_appointments";
  }

  if (includesAny(text, ["agent", "workflow", "automation", "auto", "control", "manage everything"])) {
    return "agent_workflow";
  }

  if (includesAny(text, ["insurance statistics", "insurance stats", "insurance overview", "insurance"])) {
    return "insurance_statistics";
  }

  if (includesAny(text, ["tiktok", "creator performance", "partner data"])) {
    return "tiktok_overview";
  }

  if (includesAny(text, ["crm overview", "dashboard", "overall", "summary"])) {
    return "crm_overview";
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

const getTodayAppointments = async (limit = 10) => {
  const start = dayjs().startOf("day").toDate();
  const end = dayjs().endOf("day").toDate();

  const appointments = await Appointment.find({
    scheduledFor: { $gte: start, $lte: end },
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
  const [totalClients, totalPolicies, activePolicies, pendingClaims, approvedClaims, paidPaymentsAgg, outstandingAgg, expiringSoon] =
    await Promise.all([
      Profile.countDocuments({ moduleMembership: "insurance" }),
      InsurancePolicy.countDocuments({}),
      InsurancePolicy.countDocuments({ policyStatus: "active" }),
      InsuranceClaim.countDocuments({ claimStatus: "pending" }),
      InsuranceClaim.countDocuments({ claimStatus: "approved" }),
      InsurancePayment.aggregate([
        { $match: { paymentStatus: "paid" } },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$paymentAmount", 0] } } } }
      ]),
      InsurancePayment.aggregate([
        { $group: { _id: null, total: { $sum: { $ifNull: ["$outstandingBalance", 0] } } } }
      ]),
      InsurancePolicy.countDocuments({
        policyEndDate: {
          $gte: new Date(),
          $lte: dayjs().add(30, "day").endOf("day").toDate()
        }
      })
    ]);

  return {
    totalClients,
    totalPolicies,
    activePolicies,
    pendingClaims,
    approvedClaims,
    collectedPayments: Number(paidPaymentsAgg[0]?.total || 0),
    outstandingBalance: Number(outstandingAgg[0]?.total || 0),
    expiringSoon
  };
};

const getRecentClaims = async (limit = 5) => {
  const claims = await InsuranceClaim.find({})
    .select("claimNumber claimStatus claimType claimDate claimAmountRequested claimAmountApproved")
    .sort({ claimDate: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  return claims.map((claim) => ({
    claimNumber: claim.claimNumber || "-",
    claimType: claim.claimType || "-",
    claimStatus: claim.claimStatus || "-",
    claimDate: claim.claimDate || null,
    requested: Number(claim.claimAmountRequested || 0),
    approved: Number(claim.claimAmountApproved || 0)
  }));
};

const getMessageDeliveryStats = async () => {
  const stats = await Message.aggregate([{ $group: { _id: "$deliveryStatus", count: { $sum: 1 } } }]);
  const byStatus = Object.fromEntries(stats.map((row) => [String(row._id || ""), Number(row.count || 0)]));

  return {
    sent: Number(byStatus.sent || 0),
    delivered: Number(byStatus.delivered || 0),
    replies: Number(byStatus.reply || 0),
    failed: Number((byStatus.delivery_failed || 0) + (byStatus.failed || 0))
  };
};

const getMonthlyAgencyRevenue = async () => {
  const start = dayjs().startOf("month").toDate();
  const agg = await IncomeRecord.aggregate([
    { $match: { date: { $gte: start } } },
    { $group: { _id: null, totalRevenue: { $sum: { $ifNull: ["$totalRevenue", 0] } } } }
  ]);

  return Number(agg[0]?.totalRevenue || 0);
};

const getCreatorDailySummary = async () => {
  const start = dayjs().subtract(6, "day").startOf("day").toDate();
  const agg = await CreatorDailyData.aggregate([
    { $match: { date: { $gte: start } } },
    {
      $group: {
        _id: null,
        totalIncome: { $sum: { $ifNull: ["$income", 0] } },
        totalDiamonds: { $sum: { $ifNull: ["$diamonds", 0] } },
        totalLiveHours: { $sum: { $ifNull: ["$liveHours", 0] } },
        records: { $sum: 1 }
      }
    }
  ]);

  return {
    records: Number(agg[0]?.records || 0),
    totalIncome: Number(agg[0]?.totalIncome || 0),
    totalDiamonds: Number(agg[0]?.totalDiamonds || 0),
    totalLiveHours: Number(agg[0]?.totalLiveHours || 0)
  };
};

const getIdealUserPreview = async (limit = 5) => {
  const users = await IdealUser.find({})
    .select("username diamonds revenew")
    .sort({ revenew: -1, diamonds: -1 })
    .limit(limit)
    .lean();

  return users.map((user) => ({
    username: user.username || "-",
    diamonds: Number(user.diamonds || 0),
    revenew: Number(user.revenew || 0)
  }));
};

const getIdealCreatorsCount = async () => {
  const total = await IdealUser.countDocuments({});
  return Number(total || 0);
};

const getFixedExpensesData = async () => getFixedExpenseSnapshot();

const buildMetricsSnapshot = async () => {
  const [
    totalProfiles,
    insuranceClients,
    tiktokCreators,
    breakdown,
    totalIncome,
    interestedCreators,
    upcoming,
    todayAppointments,
    insurance,
    recentClaims,
    messageStats,
    monthlyAgencyRevenue,
    creatorDailySummary,
    idealUsers,
    idealCreatorsCount,
    fixedExpenses
  ] = await Promise.all([
    Profile.countDocuments({}),
    Profile.countDocuments({ moduleMembership: "insurance" }),
    Profile.countDocuments({ moduleMembership: "tiktok" }),
    getPartnerIncomeBreakdown(8),
    getPartnerIncomeTotal(),
    getInterestedCreatorsCount(),
    getUpcomingAppointments(5),
    getTodayAppointments(10),
    getInsuranceStatistics(),
    getRecentClaims(5),
    getMessageDeliveryStats(),
    getMonthlyAgencyRevenue(),
    getCreatorDailySummary(),
    getIdealUserPreview(5),
    getIdealCreatorsCount(),
    getFixedExpensesData()
  ]);

  return {
    generatedAt: new Date().toISOString(),
    overview: {
      totalProfiles,
      insuranceClients,
      tiktokCreators
    },
    breakdown,
    totalIncome,
    interestedCreators,
    upcoming,
    todayAppointments,
    insurance: {
      ...insurance,
      recentClaims
    },
    expenses: fixedExpenses,
    tiktok: {
      creatorsCount: tiktokCreators,
      monthlyAgencyRevenue,
      messageStats,
      creatorDailySummary,
      idealUsers,
      idealCreatorsCount
    }
  };
};

const formatPartnerIncomeBreakdown = (rows) => {
  if (!rows.length) return "No partner income data found.";
  return ["Partner income breakdown:", ...rows.map((row, index) => `${index + 1}. ${row.name}: ${currency(row.income)}`)].join("\n");
};

const formatPartnerIncomeTotal = (total) => `Total partner income: ${currency(total)}.`;

const formatInterestedCreators = (count) => `Interested creators (reply received): ${count}.`;
const formatIdealCreatorsCount = (count) => `Total ideal creators in database: ${count}.`;

const formatFixedExpenses = (fixedExpenses) => {
  const items = Array.isArray(fixedExpenses?.items) ? fixedExpenses.items : [];
  if (!items.length) return "No fixed expenses configured.";

  return [
    "Fixed expense list:",
    ...items.map((item, index) => `${index + 1}. ${item.title}: ${currency(item.amount)}`),
    `Monthly fixed expense total: ${currency(fixedExpenses.monthlyTotal || 0)}`
  ].join("\n");
};

const formatUpcomingAppointments = (rows) => {
  if (!rows.length) return "No upcoming appointments found.";
  return [
    "Upcoming appointments:",
    ...rows.map((row, index) => `${index + 1}. ${row.customer} (${row.phone}) - ${dayjs(row.when).format("MMM DD, hh:mm A")}`)
  ].join("\n");
};

const formatTodayAppointments = (rows) => {
  if (!rows.length) return "No scheduled appointments found for today.";
  return [
    "Today's appointments:",
    ...rows.map((row, index) => `${index + 1}. ${row.customer} (${row.phone}) - ${dayjs(row.when).format("hh:mm A")}`)
  ].join("\n");
};

const formatAppointmentCheck = (snapshot) => {
  const todayCount = snapshot.todayAppointments.length;
  const upcomingCount = snapshot.upcoming.length;
  const nextAppointment = snapshot.upcoming[0] || snapshot.todayAppointments[0];

  if (!todayCount && !upcomingCount) {
    return "No scheduled appointment found in database right now.";
  }

  const lines = [
    `Yes, appointment data found in database.`,
    `- Today: ${todayCount}`,
    `- Upcoming: ${upcomingCount}`
  ];

  if (nextAppointment) {
    lines.push(
      `- Next: ${nextAppointment.customer} (${nextAppointment.phone}) at ${dayjs(nextAppointment.when).format("MMM DD, hh:mm A")}`
    );
  }

  return lines.join("\n");
};

const formatAgentWorkflowCapabilities = () =>
  [
    "Telegram CRM agent workflow is active.",
    "Current controls:",
    "- Read upcoming and today's appointments from database",
    "- Read fixed expense list and monthly total",
    "- Revenue summary, creator overview, insurance stats, CRM summary",
    "- English-only chat responses",
    "Suggested next upgrades for full control:",
    "1) Create/update appointment from Telegram command",
    "2) Customer lookup + follow-up action by name/phone",
    "3) Approval-safe write actions with /confirm flow"
  ].join("\n");

const formatInsuranceStatistics = (stats) =>
  [
    "Insurance statistics:",
    `- Total clients: ${stats.totalClients}`,
    `- Total policies: ${stats.totalPolicies}`,
    `- Active policies: ${stats.activePolicies}`,
    `- Pending claims: ${stats.pendingClaims}`,
    `- Approved claims: ${stats.approvedClaims}`,
    `- Policies expiring in 30 days: ${stats.expiringSoon}`,
    `- Collected payments: ${currency(stats.collectedPayments)}`,
    `- Outstanding balance: ${currency(stats.outstandingBalance)}`
  ].join("\n");

const formatTikTokOverview = (snapshot) =>
  [
    "TikTok agency overview:",
    `- Active creators in CRM: ${snapshot.tiktok.creatorsCount}`,
    `- Partner income total: ${currency(snapshot.totalIncome)}`,
    `- This month revenue: ${currency(snapshot.tiktok.monthlyAgencyRevenue)}`,
    `- Interested creators: ${snapshot.interestedCreators}`,
    `- Message replies: ${snapshot.tiktok.messageStats.replies}`
  ].join("\n");

const formatCrmOverview = (snapshot) =>
  [
    "CRM overview:",
    `- Total profiles: ${snapshot.overview.totalProfiles}`,
    `- Insurance clients: ${snapshot.overview.insuranceClients}`,
    `- TikTok creators: ${snapshot.overview.tiktokCreators}`,
    `- Upcoming appointments: ${snapshot.upcoming.length}`,
    `- Monthly agency revenue: ${currency(snapshot.tiktok.monthlyAgencyRevenue)}`
  ].join("\n");

const getGreetingName = (displayName = "") => {
  const name = String(displayName || "").trim();
  if (!name) return "";
  const first = name.split(/\s+/)[0];
  return first || "";
};

const buildChatReply = (body, options = {}, followUp = "") => {
  const firstName = getGreetingName(options.displayName);
  const greeting = firstName ? `Hello ${firstName}!` : "Hello!";
  return [greeting, body, followUp].filter(Boolean).join("\n");
};

const buildGreetingReply = (displayName = "") => {
  const firstName = getGreetingName(displayName);
  const namePart = firstName ? ` ${firstName}` : "";
  return [
    `${getGreetingByTime()}${namePart}!`,
    "Welcome back.",
    "I am doing well, thank you.",
    "How can I assist you today?"
  ].join("\n");
};

const buildHelpReply = (options = {}) =>
  buildChatReply(
    [
    "You can ask me questions like:",
    "1) Total partner income this month?",
    "2) Which creators generated highest revenue?",
    "3) Insurance stats and pending claims?",
    "4) Any policies expiring soon?",
    "5) Show upcoming appointments.",
    "6) Do I have appointment today?",
    "7) How many ideal creators are there now?",
    "8) Show fixed expense list.",
    "9) Give a full CRM summary.",
    "",
    "Quick commands: /appointments, /today, /fixed, /summary"
    ].join("\n")
  );

const buildDeterministicReply = (intent, snapshot, options = {}) => {
  if (intent === "help") return buildHelpReply(options);
  if (intent === "partner_income_breakdown")
    return buildChatReply(formatPartnerIncomeBreakdown(snapshot.breakdown), options, "Would you like a top-3 summary as well?");
  if (intent === "partner_income_total")
    return buildChatReply(formatPartnerIncomeTotal(snapshot.totalIncome), options, "Do you want the monthly expense and net result too?");
  if (intent === "fixed_expenses_list")
    return buildChatReply(formatFixedExpenses(snapshot.expenses), options, "If you want, I can also show variable expenses.");
  if (intent === "ideal_creators_count")
    return buildChatReply(formatIdealCreatorsCount(snapshot.tiktok.idealCreatorsCount), options, "Would you like me to list their usernames too?");
  if (intent === "interested_creators")
    return buildChatReply(formatInterestedCreators(snapshot.interestedCreators), options, "Should I show recent reply activity next?");
  if (intent === "appointment_check")
    return buildChatReply(formatAppointmentCheck(snapshot), options, "Would you like today's appointment list?");
  if (intent === "today_appointments")
    return buildChatReply(formatTodayAppointments(snapshot.todayAppointments), options, "Do you also want upcoming appointments for the week?");
  if (intent === "upcoming_appointments")
    return buildChatReply(formatUpcomingAppointments(snapshot.upcoming), options, "Would you like this filtered by date range?");
  if (intent === "agent_workflow")
    return buildChatReply(formatAgentWorkflowCapabilities(), options, "Tell me which control you want to add first.");
  if (intent === "insurance_statistics")
    return buildChatReply(formatInsuranceStatistics(snapshot.insurance), options, "Would you like claim details as the next step?");
  if (intent === "tiktok_overview")
    return buildChatReply(formatTikTokOverview(snapshot), options, "Should I break this down by creator?");
  if (intent === "crm_overview")
    return buildChatReply(formatCrmOverview(snapshot), options, "Do you want a focused view for insurance or TikTok?");
  return "";
};

const formatContextDate = (value) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm") : null);

const buildContextText = (snapshot) =>
  JSON.stringify(
    {
      generatedAt: snapshot.generatedAt,
      overview: snapshot.overview,
      tiktok: {
        creatorsCount: snapshot.tiktok.creatorsCount,
        monthlyAgencyRevenue: snapshot.tiktok.monthlyAgencyRevenue,
        messageStats: snapshot.tiktok.messageStats,
        creatorDailySummary: snapshot.tiktok.creatorDailySummary,
        idealCreatorsCount: snapshot.tiktok.idealCreatorsCount,
        topPartnerIncomeCreators: snapshot.breakdown,
        topIdealUsers: snapshot.tiktok.idealUsers
      },
      insurance: {
        totalClients: snapshot.insurance.totalClients,
        totalPolicies: snapshot.insurance.totalPolicies,
        activePolicies: snapshot.insurance.activePolicies,
        pendingClaims: snapshot.insurance.pendingClaims,
        approvedClaims: snapshot.insurance.approvedClaims,
        expiringSoon: snapshot.insurance.expiringSoon,
        collectedPayments: snapshot.insurance.collectedPayments,
        outstandingBalance: snapshot.insurance.outstandingBalance,
        recentClaims: snapshot.insurance.recentClaims
      },
      expenses: snapshot.expenses,
      interestedCreators: snapshot.interestedCreators,
      todayAppointments: snapshot.todayAppointments.map((item) => ({
        customer: item.customer,
        phone: item.phone,
        when: formatContextDate(item.when)
      })),
      upcomingAppointments: snapshot.upcoming.map((item) => ({
        customer: item.customer,
        phone: item.phone,
        when: formatContextDate(item.when)
      }))
    },
    null,
    2
  );

const HUMAM_SYSTEM_PROMPT =
  "You are Humam, a professional, friendly, human-like relationship manager for a combined Insurance CRM and TikTok Agency CRM. " +
  "Always reply in English only. Keep responses natural, confident, and practical, usually within 3-7 sentences unless asked for detail. " +
  "Use only the provided CRM snapshot for data claims. Never invent numbers, names, dates, or statuses. " +
  "If required data is missing, state that clearly and ask one focused follow-up question. " +
  "For greetings, respond warmly and briefly. For business questions, provide direct answer first, then short actionable guidance. " +
  "Sound like a skilled human account manager, not a robotic bot.";

const buildLlmReply = async (userText, snapshot, options = {}) => {
  if (!isOpenAiConfigured()) {
    return ["OpenAI is not configured. I can still share deterministic CRM stats.", formatCrmOverview(snapshot)].join("\n\n");
  }

  const displayName = String(options.displayName || "").trim() || "Customer";
  const userPrompt = [
    `User display name: ${displayName}`,
    `User message: ${userText}`,
    "",
    "Authoritative CRM snapshot (JSON):",
    buildContextText(snapshot),
    "",
    "Instruction: answer the user now."
  ].join("\n");

  const answer = await chatWithOpenAi({
    systemPrompt: HUMAM_SYSTEM_PROMPT,
    userPrompt,
    temperature: 0.35
  });

  return answer || "I could not generate a response right now.";
};

const generateTelegramAssistantReply = async (userText, options = {}) => {
  if (isGreetingMessage(userText)) {
    return buildGreetingReply(options.displayName);
  }

  if (isHelpRequest(userText)) {
    return buildHelpReply(options);
  }

  const snapshot = await buildMetricsSnapshot();
  const intent = identifyIntent(userText);
  const deterministic = buildDeterministicReply(intent, snapshot, options);
  if (deterministic) return deterministic;

  try {
    return await buildLlmReply(userText, snapshot, options);
  } catch (error) {
    return [
      "I could not generate the full AI answer right now.",
      `Reason: ${error.message || "Unknown error"}`,
      "",
      formatCrmOverview(snapshot)
    ].join("\n");
  }
};

module.exports = {
  generateTelegramAssistantReply,
  buildMetricsSnapshot,
  identifyIntent
};
