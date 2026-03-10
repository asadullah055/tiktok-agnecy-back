const Profile = require("../models/Profile");
const CreatorDailyData = require("../models/CreatorDailyData");
const Message = require("../models/Message");
const IdealUser = require("../models/IdealUser");
const asyncHandler = require("../middlewares/asyncHandler");
const { logActivity } = require("../services/activityService");

const USD_PER_DIAMOND = 0.005;
const MAX_IDEAL_USER_DAYS = 30;
const hasValue = (value) => value !== undefined && value !== null && value !== "";
const toNumberOr = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const MESSAGE_STATUSES = ["sent", "delivered", "delivery_failed", "reply"];
const MESSAGE_STATUS_SET = new Set(MESSAGE_STATUSES);

const normalizeDeliveryStatus = (value) => {
  if (!value) return "";

  const normalized = String(value).trim().toLowerCase().replace(/\s+/g, "_");
  return normalized === "failed" ? "delivery_failed" : normalized;
};
const escapeRegExp = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizeUsername = (value) => String(value || "").trim().replace(/^@/, "").trim();
const toPositiveNumber = (value) => Math.max(0, toNumberOr(value, 0));
const toPositiveInteger = (value, fallback = 0) => Math.max(0, Math.round(hasValue(value) ? toNumberOr(value, fallback) : fallback));
const calculateDiamondsFromIncome = (income) => Math.max(0, Math.round(toPositiveNumber(income) / USD_PER_DIAMOND));
const calculateIncomeFromDiamonds = (diamonds) => Math.max(0, Math.round(toPositiveNumber(diamonds) * USD_PER_DIAMOND));

const normalizeMoneyPair = ({ income, diamonds }) => {
  const hasIncome = hasValue(income);
  const hasDiamonds = hasValue(diamonds);

  if (!hasIncome && !hasDiamonds) {
    return { income: 0, diamonds: 0 };
  }

  if (hasIncome && !hasDiamonds) {
    const normalizedIncome = toPositiveNumber(income);
    return {
      income: normalizedIncome,
      diamonds: calculateDiamondsFromIncome(normalizedIncome)
    };
  }

  if (!hasIncome && hasDiamonds) {
    const normalizedDiamonds = toPositiveNumber(diamonds);
    return {
      income: calculateIncomeFromDiamonds(normalizedDiamonds),
      diamonds: normalizedDiamonds
    };
  }

  return {
    income: toPositiveNumber(income),
    diamonds: toPositiveNumber(diamonds)
  };
};

const sanitizeDateKey = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";

  return parsed.toISOString().slice(0, 10);
};

const normalizeIdealUserDays = (rawDays) => {
  if (!Array.isArray(rawDays)) return [];

  const byDate = new Map();
  rawDays.forEach((day) => {
    const date = sanitizeDateKey(day?.date);
    if (!date) return;
    byDate.set(date, {
      date,
      ...normalizeMoneyPair({
        income: day?.income,
        diamonds: day?.diamonds
      })
    });
  });

  return [...byDate.values()]
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, MAX_IDEAL_USER_DAYS);
};

const getIdealUserTotals = (payload, days) => {
  const hasExplicitTotals =
    hasValue(payload?.totalIncome) ||
    hasValue(payload?.revenew) ||
    hasValue(payload?.totalDiamonds) ||
    hasValue(payload?.diamonds);

  if (hasExplicitTotals) {
    return normalizeMoneyPair({
      income: payload?.totalIncome ?? payload?.revenew,
      diamonds: payload?.totalDiamonds ?? payload?.diamonds
    });
  }

  return days.reduce(
    (sum, day) => ({
      income: sum.income + toPositiveNumber(day.income),
      diamonds: sum.diamonds + toPositiveNumber(day.diamonds)
    }),
    { income: 0, diamonds: 0 }
  );
};

const sumIdealUserDays = (days) =>
  days.reduce(
    (sum, day) => ({
      income: sum.income + toPositiveNumber(day?.income),
      diamonds: sum.diamonds + toPositiveNumber(day?.diamonds)
    }),
    { income: 0, diamonds: 0 }
  );

const normalizeIdealUserResponse = (user = {}) => {
  const days = Array.isArray(user.days)
    ? user.days.map((day) => ({
        date: sanitizeDateKey(day?.date),
        income: toPositiveNumber(day?.income),
        diamonds: toPositiveNumber(day?.diamonds)
      }))
    : [];
  const safeDays = days.filter((day) => day.date).sort((left, right) => right.date.localeCompare(left.date));
  const latestDays = safeDays.slice(0, MAX_IDEAL_USER_DAYS);
  const totalIncome = toPositiveNumber(user.totalIncome ?? user.revenew);
  const totalDiamonds = toPositiveNumber(user.totalDiamonds ?? user.diamonds);

  return {
    ...user,
    id: String(user._id || user.id || ""),
    name: String(user.name || "").trim(),
    username: normalizeUsername(user.username),
    daysCount: toPositiveInteger(user.daysCount, days.length || MAX_IDEAL_USER_DAYS),
    totalIncome,
    totalDiamonds,
    revenew: totalIncome,
    diamonds: totalDiamonds,
    days: latestDays
  };
};

const getDeliveryStatusFilterValues = (value) => {
  const requested = String(value)
    .split(",")
    .map((status) => normalizeDeliveryStatus(status))
    .filter((status) => MESSAGE_STATUS_SET.has(status));

  if (!requested.length) return [];
  if (requested.includes("delivery_failed")) {
    return [...new Set([...requested, "failed"])];
  }

  return [...new Set(requested)];
};

const getStatusCount = (stats, ...keys) =>
  keys.reduce((sum, key) => sum + (stats.find((entry) => entry._id === key)?.count || 0), 0);

const listCreators = asyncHandler(async (req, res) => {
  const creators = await Profile.find({ moduleMembership: "tiktok" }).sort({ updatedAt: -1 });
  res.json({ success: true, data: creators });
});

const upsertCreator = asyncHandler(async (req, res) => {
  const { name, phone, email, notes, tags, creatorName, tiktokUsername, country, manager, partnerRevenue, partnerRevenueDate } = req.body;

  const identityFilters = [];
  if (email) identityFilters.push({ email });
  if (phone) identityFilters.push({ phone });
  if (tiktokUsername) identityFilters.push({ "tiktokData.tiktokUsername": tiktokUsername });

  let profile = identityFilters.length ? await Profile.findOne({ $or: identityFilters }) : null;

  if (!profile) {
    profile = await Profile.create({
      name: name || creatorName,
      phone,
      email,
      notes,
      tags,
      moduleMembership: ["tiktok"],
      tiktokData: {
        creatorName: creatorName || name,
        tiktokUsername,
        country,
        manager,
        partnerRevenue: hasValue(partnerRevenue) ? toNumberOr(partnerRevenue, 0) : 0,
        partnerRevenueDate: hasValue(partnerRevenueDate) ? partnerRevenueDate : undefined,
        notes
      }
    });
  } else {
    if (!profile.moduleMembership.includes("tiktok")) {
      profile.moduleMembership.push("tiktok");
    }
    profile.name = name || profile.name;
    profile.phone = phone || profile.phone;
    profile.email = email || profile.email;
    profile.notes = notes || profile.notes;
    profile.tags = tags || profile.tags;
    profile.tiktokData = {
      ...profile.tiktokData?.toObject?.(),
      creatorName: creatorName || profile.tiktokData?.creatorName || profile.name,
      tiktokUsername: tiktokUsername || profile.tiktokData?.tiktokUsername,
      country: country || profile.tiktokData?.country,
      manager: manager || profile.tiktokData?.manager,
      partnerRevenue: hasValue(partnerRevenue) ? toNumberOr(partnerRevenue, 0) : profile.tiktokData?.partnerRevenue || 0,
      partnerRevenueDate: hasValue(partnerRevenueDate) ? partnerRevenueDate : profile.tiktokData?.partnerRevenueDate,
      notes: notes || profile.tiktokData?.notes
    };
    await profile.save();
  }

  await logActivity({
    type: "creator_saved",
    module: "tiktok",
    profile: profile._id,
    message: `TikTok partner saved: ${profile.tiktokData?.creatorName || profile.name}`
  });

  res.status(201).json({ success: true, data: profile });
});

const addDailyData = asyncHandler(async (req, res) => {
  const { profile, date, gifts, diamonds, income, liveHours } = req.body;
  const record = await CreatorDailyData.findOneAndUpdate(
    { profile, date },
    { profile, date, gifts, diamonds, income, liveHours },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).populate("profile", "name tiktokData.creatorName");

  await logActivity({
    type: "daily_data_saved",
    module: "tiktok",
    profile,
    message: "Partner daily performance data saved"
  });

  res.status(201).json({ success: true, data: record });
});

const listDailyData = asyncHandler(async (req, res) => {
  const { profile } = req.query;
  const filters = {};
  if (profile) filters.profile = profile;

  const records = await CreatorDailyData.find(filters)
    .populate("profile", "name tiktokData.creatorName tiktokData.tiktokUsername")
    .sort({ date: -1 })
    .limit(200);
  res.json({ success: true, data: records });
});

const sendMessage = asyncHandler(async (req, res) => {
  const { profile, platform = "telegram", content, deliveryStatus } = req.body;
  const normalizedStatus = normalizeDeliveryStatus(deliveryStatus || "sent");

  if (!MESSAGE_STATUS_SET.has(normalizedStatus)) {
    res.status(400);
    throw new Error("Invalid deliveryStatus. Allowed values: sent, delivered, delivery_failed, reply");
  }

  const message = await Message.create({
    profile,
    platform,
    content,
    deliveryStatus: normalizedStatus
  });

  await logActivity({
    type: "message_sent",
    module: "tiktok",
    profile,
    message: `Conversation sent via ${platform}`
  });

  res.status(201).json({ success: true, data: message });
});

const listMessages = asyncHandler(async (req, res) => {
  const { deliveryStatus, profile } = req.query;
  const filters = {};

  if (profile) {
    filters.profile = profile;
  }

  if (deliveryStatus) {
    const statuses = getDeliveryStatusFilterValues(deliveryStatus);
    if (statuses.length) {
      filters.deliveryStatus = { $in: statuses };
    }
  }

  const messages = await Message.find(filters).populate("profile", "name tiktokData.creatorName").sort({ createdAt: -1 });
  res.json({ success: true, data: messages });
});

const messageDeliveryStats = asyncHandler(async (req, res) => {
  const stats = await Message.aggregate([
    { $group: { _id: "$deliveryStatus", count: { $sum: 1 } } }
  ]);

  res.json({
    success: true,
    data: {
      sent: getStatusCount(stats, "sent"),
      delivered: getStatusCount(stats, "delivered"),
      deliveryFailed: getStatusCount(stats, "delivery_failed", "failed"),
      reply: getStatusCount(stats, "reply"),
      queued: getStatusCount(stats, "queued")
    }
  });
});

const listIdealUsers = asyncHandler(async (req, res) => {
  const users = await IdealUser.find({}).sort({ updatedAt: -1, createdAt: -1 }).limit(500).lean();
  res.json({ success: true, data: users.map((user) => normalizeIdealUserResponse(user)) });
});

const addIdealUser = asyncHandler(async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const username = normalizeUsername(req.body?.username);

  if (!name) {
    res.status(400);
    throw new Error("Name is required");
  }

  if (!username) {
    res.status(400);
    throw new Error("Username is required");
  }

  const days = normalizeIdealUserDays(req.body?.days);
  const totals = getIdealUserTotals(req.body, days);
  const existingUser = await IdealUser.findOne({
    username: new RegExp(`^${escapeRegExp(username)}$`, "i")
  });

  const user = existingUser || new IdealUser();
  user.name = name;
  user.username = username;
  user.daysCount = toPositiveInteger(req.body?.daysCount, days.length || MAX_IDEAL_USER_DAYS);
  user.totalIncome = totals.income;
  user.totalDiamonds = totals.diamonds;
  user.revenew = totals.income;
  user.diamonds = totals.diamonds;
  user.days = days;
  await user.save();

  await logActivity({
    type: "ideal_user_saved",
    module: "tiktok",
    message: `Ideal creator saved: ${user.name} (@${user.username})`
  });

  res.status(existingUser ? 200 : 201).json({ success: true, data: normalizeIdealUserResponse(user.toObject()) });
});

module.exports = {
  listCreators,
  upsertCreator,
  addDailyData,
  listDailyData,
  sendMessage,
  listMessages,
  messageDeliveryStats,
  listIdealUsers,
  addIdealUser
};
