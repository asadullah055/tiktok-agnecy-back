const dayjs = require("dayjs");
const Profile = require("../models/Profile");
const Message = require("../models/Message");
const Appointment = require("../models/Appointment");
const IncomeRecord = require("../models/IncomeRecord");

const lastNDays = (days) =>
  Array.from({ length: days })
    .map((_, index) => dayjs().subtract(days - 1 - index, "day"))
    .map((d) => ({ label: d.format("MMM DD"), start: d.startOf("day").toDate(), end: d.endOf("day").toDate() }));

const getTimeseries = async () => {
  const buckets = lastNDays(7);

  const stats = await Promise.all(
    buckets.map(async (bucket) => {
      const [messages, revenueAgg, newProfiles] = await Promise.all([
        Message.countDocuments({ createdAt: { $gte: bucket.start, $lte: bucket.end } }),
        IncomeRecord.aggregate([
          { $match: { date: { $gte: bucket.start, $lte: bucket.end } } },
          { $group: { _id: null, total: { $sum: "$totalRevenue" } } }
        ]),
        Profile.countDocuments({ createdAt: { $gte: bucket.start, $lte: bucket.end } })
      ]);

      return {
        day: bucket.label,
        messages,
        revenue: revenueAgg[0]?.total || 0,
        newProfiles
      };
    })
  );

  return stats;
};

const getOverviewStats = async () => {
  const todayStart = dayjs().startOf("day").toDate();
  const todayEnd = dayjs().endOf("day").toDate();

  const [
    totalProfiles,
    insuranceClients,
    tiktokCreators,
    dailyMessages,
    appointmentsToday,
    totalRevenueAgg,
    monthlyRevenueAgg
  ] = await Promise.all([
    Profile.countDocuments(),
    Profile.countDocuments({ moduleMembership: "insurance" }),
    Profile.countDocuments({ moduleMembership: "tiktok" }),
    Message.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd } }),
    Appointment.countDocuments({ scheduledFor: { $gte: todayStart, $lte: todayEnd } }),
    IncomeRecord.aggregate([{ $group: { _id: null, sum: { $sum: "$totalRevenue" } } }]),
    IncomeRecord.aggregate([
      { $match: { date: { $gte: dayjs().startOf("month").toDate() } } },
      { $group: { _id: null, sum: { $sum: "$totalRevenue" } } }
    ])
  ]);

  return {
    totalProfiles,
    insuranceClients,
    tiktokCreators,
    dailyMessages,
    appointmentsToday,
    companyRevenue: totalRevenueAgg[0]?.sum || 0,
    monthlyRevenue: monthlyRevenueAgg[0]?.sum || 0
  };
};

module.exports = { getOverviewStats, getTimeseries };
