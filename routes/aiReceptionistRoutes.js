const express = require("express");
const {
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
} = require("../controllers/aiReceptionistController");

const router = express.Router();

router.route("/appointments").get(listAppointments).post(createAppointment);
router.route("/conversation-history").get(listConversationHistory).post(addConversation);
router.get("/failed-calls", listFailedCalls);
router.post("/ask", askAi);
router.get("/google-calendar/connect-url", getGoogleCalendarConnectUrl);
router.get("/google-calendar/callback", handleGoogleCalendarCallback);
router.get("/google-calendar/status", getGoogleCalendarStatus);
router.get("/google-calendar/appointments", fetchGoogleCalendarAppointments);
router.post("/google-calendar/disconnect", disconnectGoogleCalendarConnection);

module.exports = router;
