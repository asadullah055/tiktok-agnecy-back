const dayjs = require("dayjs");
const Appointment = require("../models/Appointment");
const Conversation = require("../models/Conversation");
const Profile = require("../models/Profile");
const asyncHandler = require("../middlewares/asyncHandler");
const { logActivity } = require("../services/activityService");
const {
  buildGoogleCalendarAuthUrl,
  getFrontendAppointmentsUrl,
  upsertGoogleCalendarConnectionFromCode,
  getGoogleCalendarConnectionStatus,
  listGoogleCalendarAppointments,
  disconnectGoogleCalendar
} = require("../services/googleCalendarService");

const listAppointments = asyncHandler(async (req, res) => {
  const { today } = req.query;
  const filters = {};

  if (today === "true") {
    filters.scheduledFor = {
      $gte: dayjs().startOf("day").toDate(),
      $lte: dayjs().endOf("day").toDate()
    };
  }

  const appointments = await Appointment.find(filters)
    .populate("profile", "name phone email")
    .sort({ scheduledFor: 1 });

  res.json({ success: true, data: appointments });
});

const createAppointment = asyncHandler(async (req, res) => {
  const appointment = await Appointment.create(req.body);
  await logActivity({
    type: "appointment_created",
    module: "insurance",
    profile: appointment.profile,
    message: "Appointment scheduled via AI receptionist"
  });
  res.status(201).json({ success: true, data: appointment });
});

const listConversationHistory = asyncHandler(async (req, res) => {
  const history = await Conversation.find()
    .populate("profile", "name phone")
    .sort({ createdAt: -1 })
    .limit(80);
  res.json({ success: true, data: history });
});

const addConversation = asyncHandler(async (req, res) => {
  const conversation = await Conversation.create(req.body);
  await logActivity({
    type: "conversation_logged",
    module: "insurance",
    profile: conversation.profile,
    message: `AI receptionist conversation marked as ${conversation.outcome}`
  });
  res.status(201).json({ success: true, data: conversation });
});

const listFailedCalls = asyncHandler(async (req, res) => {
  const failed = await Conversation.find({ outcome: "failed", channel: "call" })
    .populate("profile", "name phone")
    .sort({ createdAt: -1 });
  res.json({ success: true, data: failed });
});

const askAi = asyncHandler(async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    res.status(400);
    throw new Error("Prompt is required");
  }

  const lowered = prompt.toLowerCase();
  let result = [];
  let answer = "I could not map that request. Try asking for today's appointments or a customer search.";

  if (lowered.includes("today") && lowered.includes("appointment")) {
    result = await Appointment.find({
      scheduledFor: { $gte: dayjs().startOf("day").toDate(), $lte: dayjs().endOf("day").toDate() }
    }).populate("profile", "name phone");
    answer = `Found ${result.length} appointments for today.`;
  } else if (lowered.includes("find customer") || lowered.includes("customer")) {
    const token = lowered.replace("find customer", "").replace("customer", "").trim();
    if (token) {
      result = await Profile.find({ $text: { $search: token } }).limit(8);
      answer = `Found ${result.length} matching profiles for "${token}".`;
    }
  }

  res.json({
    success: true,
    data: {
      prompt,
      answer,
      result
    }
  });
});

const getGoogleCalendarConnectUrl = asyncHandler(async (req, res) => {
  const connectionKey = String(req.query.connectionKey || "").trim();
  if (!connectionKey) {
    res.status(400);
    throw new Error("connectionKey is required");
  }

  const url = buildGoogleCalendarAuthUrl(connectionKey);
  res.json({ success: true, data: { url } });
});

const handleGoogleCalendarCallback = async (req, res) => {
  const redirectUrl = new URL(getFrontendAppointmentsUrl());

  try {
    const { code, state } = req.query;
    if (!code || !state) {
      throw new Error("Missing Google OAuth callback parameters");
    }

    const connection = await upsertGoogleCalendarConnectionFromCode({ code, state });

    redirectUrl.searchParams.set("googleCalendarConnected", "1");
    redirectUrl.searchParams.set("connectionKey", connection.connectionKey);
  } catch (error) {
    redirectUrl.searchParams.set("googleCalendarConnected", "0");
    redirectUrl.searchParams.set("calendarError", error.message || "Google Calendar connection failed");
  }

  return res.redirect(redirectUrl.toString());
};

const getGoogleCalendarStatus = asyncHandler(async (req, res) => {
  const status = await getGoogleCalendarConnectionStatus(req.query.connectionKey);
  res.json({ success: true, data: status });
});

const fetchGoogleCalendarAppointments = asyncHandler(async (req, res) => {
  const appointments = await listGoogleCalendarAppointments({
    connectionKey: req.query.connectionKey,
    today: req.query.today === "true",
    maxResults: req.query.maxResults,
    bookedOnly: req.query.bookedOnly
  });

  res.json({ success: true, data: appointments });
});

const disconnectGoogleCalendarConnection = asyncHandler(async (req, res) => {
  const result = await disconnectGoogleCalendar(req.body.connectionKey || req.query.connectionKey);
  res.json({ success: true, data: result });
});

module.exports = {
  listAppointments,
  createAppointment,
  listConversationHistory,
  addConversation,
  listFailedCalls,
  askAi,
  getGoogleCalendarConnectUrl,
  handleGoogleCalendarCallback,
  getGoogleCalendarStatus,
  fetchGoogleCalendarAppointments,
  disconnectGoogleCalendarConnection
};
