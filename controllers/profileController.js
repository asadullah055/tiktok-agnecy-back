const Profile = require("../models/Profile");
const asyncHandler = require("../middlewares/asyncHandler");
const { logActivity } = require("../services/activityService");

const parseListQuery = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 12, 1), 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const listProfiles = asyncHandler(async (req, res) => {
  const { search, module, status, tags } = req.query;
  const { page, limit, skip } = parseListQuery(req.query);

  const filters = {};
  if (status) filters.status = status;
  if (module) filters.moduleMembership = module;
  if (tags) filters.tags = { $in: tags.split(",").map((tag) => tag.trim()) };
  if (search) filters.$text = { $search: search };

  const [profiles, total] = await Promise.all([
    Profile.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Profile.countDocuments(filters)
  ]);

  res.json({
    success: true,
    data: profiles,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

const getProfileById = asyncHandler(async (req, res) => {
  const profile = await Profile.findById(req.params.id);
  if (!profile) {
    res.status(404);
    throw new Error("Profile not found");
  }
  res.json({ success: true, data: profile });
});

const createProfile = asyncHandler(async (req, res) => {
  const profile = await Profile.create(req.body);

  await logActivity({
    type: "profile_created",
    module: "global",
    profile: profile._id,
    message: `${profile.name} profile created`
  });

  res.status(201).json({ success: true, data: profile });
});

const updateProfile = asyncHandler(async (req, res) => {
  const profile = await Profile.findById(req.params.id);
  if (!profile) {
    res.status(404);
    throw new Error("Profile not found");
  }

  Object.assign(profile, req.body);
  const updated = await profile.save();

  await logActivity({
    type: "profile_updated",
    module: "global",
    profile: updated._id,
    message: `${updated.name} profile updated`
  });

  res.json({ success: true, data: updated });
});

const attachProfileModule = asyncHandler(async (req, res) => {
  const { module, moduleData } = req.body;
  if (!["insurance", "tiktok"].includes(module)) {
    res.status(400);
    throw new Error("Unsupported module");
  }

  const profile = await Profile.findById(req.params.id);
  if (!profile) {
    res.status(404);
    throw new Error("Profile not found");
  }

  if (!profile.moduleMembership.includes(module)) {
    profile.moduleMembership.push(module);
  }

  if (module === "insurance") {
    profile.insuranceData = { ...profile.insuranceData?.toObject?.(), ...moduleData };
  }
  if (module === "tiktok") {
    profile.tiktokData = { ...profile.tiktokData?.toObject?.(), ...moduleData };
  }

  const updated = await profile.save();

  await logActivity({
    type: "profile_module_attached",
    module,
    profile: updated._id,
    message: `${updated.name} moved into ${module} module`
  });

  res.json({ success: true, data: updated });
});

const deleteProfile = asyncHandler(async (req, res) => {
  const profile = await Profile.findByIdAndDelete(req.params.id);
  if (!profile) {
    res.status(404);
    throw new Error("Profile not found");
  }

  await logActivity({
    type: "profile_deleted",
    module: "global",
    message: `${profile.name} profile deleted`
  });

  res.json({ success: true, message: "Profile deleted" });
});

module.exports = {
  listProfiles,
  getProfileById,
  createProfile,
  updateProfile,
  deleteProfile,
  attachProfileModule
};
