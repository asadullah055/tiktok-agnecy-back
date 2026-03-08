const Profile = require("../models/Profile");
const CreatorDailyData = require("../models/CreatorDailyData");
const Message = require("../models/Message");
const IdealUser = require("../models/IdealUser");
const asyncHandler = require("../middlewares/asyncHandler");
const { logActivity } = require("../services/activityService");

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
  const users = await IdealUser.find({}).sort({ createdAt: -1 }).limit(500);
  res.json({ success: true, data: users });
});

const addIdealUser = asyncHandler(async (req, res) => {
  const username = String(req.body?.username || "").trim();
  if (!username) {
    res.status(400);
    throw new Error("Username is required");
  }

  const user = await IdealUser.create({
    username,
    diamonds: toNumberOr(req.body?.diamonds, 0),
    revenew: toNumberOr(req.body?.revenew, 0)
  });

  await logActivity({
    type: "ideal_user_saved",
    module: "tiktok",
    message: `Ideal user saved: ${user.username}`
  });

  res.status(201).json({ success: true, data: user });
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
