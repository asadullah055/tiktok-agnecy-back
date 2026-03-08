const Activity = require("../models/Activity");

const logActivity = async ({ type, module = "global", message, profile = null, metadata = {} }) =>
  Activity.create({ type, module, message, profile, metadata });

module.exports = { logActivity };
