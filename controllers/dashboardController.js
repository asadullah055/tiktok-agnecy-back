const Activity = require("../models/Activity");
const asyncHandler = require("../middlewares/asyncHandler");
const { getOverviewStats, getTimeseries } = require("../services/dashboardService");

const getDashboardOverview = asyncHandler(async (req, res) => {
  const [overview, timeseries, recentActivity] = await Promise.all([
    getOverviewStats(),
    getTimeseries(),
    Activity.find().sort({ createdAt: -1 }).limit(12).populate("profile", "name")
  ]);

  res.json({
    success: true,
    data: {
      overview,
      timeseries,
      recentActivity
    }
  });
});

module.exports = { getDashboardOverview };
