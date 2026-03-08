const express = require("express");
const {
  listCreators,
  upsertCreator,
  addDailyData,
  listDailyData,
  sendMessage,
  listMessages,
  messageDeliveryStats,
  listIdealUsers,
  addIdealUser
} = require("../controllers/tiktokController");

const router = express.Router();

router.route("/creators").get(listCreators).post(upsertCreator);
router.route("/daily-data").get(listDailyData).post(addDailyData);
router.route("/messages").get(listMessages).post(sendMessage);
router.get("/messages/stats", messageDeliveryStats);
router.route("/ideal-users").get(listIdealUsers).post(addIdealUser);

module.exports = router;
