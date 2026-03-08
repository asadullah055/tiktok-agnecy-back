const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const connectDb = require("./config/db");

const profileRoutes = require("./routes/profileRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const insuranceRoutes = require("./routes/insuranceRoutes");
const aiReceptionistRoutes = require("./routes/aiReceptionistRoutes");
const tiktokRoutes = require("./routes/tiktokRoutes");
const incomeRoutes = require("./routes/incomeRoutes");
const telegramRoutes = require("./routes/telegramRoutes");
const { notFound, errorHandler } = require("./middlewares/errorHandler");

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

app.use(async (req, res, next) => {
  if (req.path === "/health") {
    return next();
  }

  try {
    await connectDb();
    return next();
  } catch (error) {
    return next(error);
  }
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "CRM API is running",
    timestamp: new Date().toISOString()
  });
});

app.use("/api/profiles", profileRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/insurance", insuranceRoutes);
app.use("/api/ai-receptionist", aiReceptionistRoutes);
app.use("/api/tiktok", tiktokRoutes);
app.use("/api/income", incomeRoutes);
app.use("/api/telegram", telegramRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
