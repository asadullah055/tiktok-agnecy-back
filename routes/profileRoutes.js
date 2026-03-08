const express = require("express");
const {
  listProfiles,
  getProfileById,
  createProfile,
  updateProfile,
  deleteProfile,
  attachProfileModule
} = require("../controllers/profileController");

const router = express.Router();

router.route("/").get(listProfiles).post(createProfile);
router.route("/:id").get(getProfileById).put(updateProfile).delete(deleteProfile);
router.route("/:id/attach-module").post(attachProfileModule);

module.exports = router;
