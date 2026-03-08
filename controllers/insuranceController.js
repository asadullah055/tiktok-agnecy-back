const Profile = require("../models/Profile");
const InsurancePolicy = require("../models/InsurancePolicy");
const InsuranceClaim = require("../models/InsuranceClaim");
const InsurancePayment = require("../models/InsurancePayment");
const asyncHandler = require("../middlewares/asyncHandler");
const { logActivity } = require("../services/activityService");

const toNumberOr = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const buildInsuranceData = (body, existing = {}) => ({
  ...existing,
  customerId: body.customerId ?? existing.customerId,
  dateOfBirth: body.dateOfBirth ?? existing.dateOfBirth,
  gender: body.gender ?? existing.gender,
  addressStreet: body.addressStreet ?? existing.addressStreet,
  addressCity: body.addressCity ?? existing.addressCity,
  addressState: body.addressState ?? existing.addressState,
  addressZip: body.addressZip ?? existing.addressZip,
  ssn: body.ssn ?? existing.ssn,
  driverLicenseNumber: body.driverLicenseNumber ?? existing.driverLicenseNumber,
  maritalStatus: body.maritalStatus ?? existing.maritalStatus,
  occupation: body.occupation ?? existing.occupation,
  preferredCommunicationMethod: body.preferredCommunicationMethod ?? existing.preferredCommunicationMethod,
  policyType: body.policyType ?? existing.policyType,
  policyNumber: body.policyNumber ?? existing.policyNumber,
  insuranceProvider: body.insuranceProvider ?? existing.insuranceProvider,
  policyStartDate: body.policyStartDate ?? existing.policyStartDate,
  policyEndDate: body.policyEndDate ?? existing.policyEndDate,
  coverageAmount: body.coverageAmount !== undefined ? toNumberOr(body.coverageAmount, 0) : existing.coverageAmount,
  deductibleAmount: body.deductibleAmount !== undefined ? toNumberOr(body.deductibleAmount, 0) : existing.deductibleAmount,
  premiumAmount: body.premiumAmount !== undefined ? toNumberOr(body.premiumAmount, 0) : existing.premiumAmount,
  paymentFrequency: body.paymentFrequency ?? existing.paymentFrequency,
  status: body.status ?? existing.status,
  notes: body.notes ?? existing.notes
});

const listInsuranceCustomers = asyncHandler(async (req, res) => {
  const { search, status } = req.query;
  const filters = { moduleMembership: "insurance" };
  if (status) {
    filters["insuranceData.status"] = status;
  }
  if (search) {
    filters.$text = { $search: search };
  }

  const customers = await Profile.find(filters).sort({ updatedAt: -1 });
  res.json({ success: true, data: customers });
});

const createInsuranceCustomer = asyncHandler(async (req, res) => {
  const { name, fullName, phone, email, notes, tags } = req.body;
  const resolvedName = (fullName || name || "").trim();

  if (!resolvedName) {
    res.status(400);
    throw new Error("Full Name is required");
  }

  const identityFilters = [];
  if (email) identityFilters.push({ email });
  if (phone) identityFilters.push({ phone });

  const profile = identityFilters.length ? await Profile.findOne({ $or: identityFilters }) : null;

  let savedProfile = profile;

  if (!savedProfile) {
    savedProfile = await Profile.create({
      name: resolvedName,
      phone,
      email,
      notes,
      tags,
      moduleMembership: ["insurance"],
      insuranceData: buildInsuranceData(req.body, { notes })
    });
  } else {
    if (!savedProfile.moduleMembership.includes("insurance")) {
      savedProfile.moduleMembership.push("insurance");
    }
    savedProfile.name = resolvedName || savedProfile.name;
    savedProfile.phone = phone || savedProfile.phone;
    savedProfile.email = email || savedProfile.email;
    savedProfile.notes = notes || savedProfile.notes;
    savedProfile.tags = tags || savedProfile.tags;
    savedProfile.insuranceData = buildInsuranceData(req.body, savedProfile.insuranceData?.toObject?.() || {});
    await savedProfile.save();
  }

  await logActivity({
    type: "insurance_customer_saved",
    module: "insurance",
    profile: savedProfile._id,
    message: `Insurance customer saved: ${savedProfile.name}`
  });

  res.status(201).json({ success: true, data: savedProfile });
});

const updateInsuranceCustomer = asyncHandler(async (req, res) => {
  const profile = await Profile.findById(req.params.id);
  if (!profile) {
    res.status(404);
    throw new Error("Profile not found");
  }

  if (!profile.moduleMembership.includes("insurance")) {
    profile.moduleMembership.push("insurance");
  }

  const { name, fullName, phone, email, notes, tags } = req.body;
  const resolvedName = fullName ?? name;
  profile.name = resolvedName ?? profile.name;
  profile.phone = phone ?? profile.phone;
  profile.email = email ?? profile.email;
  profile.notes = notes ?? profile.notes;
  profile.tags = tags ?? profile.tags;
  profile.insuranceData = buildInsuranceData(req.body, profile.insuranceData?.toObject?.() || {});
  await profile.save();

  await logActivity({
    type: "insurance_customer_updated",
    module: "insurance",
    profile: profile._id,
    message: `Insurance customer updated: ${profile.name}`
  });

  res.json({ success: true, data: profile });
});

const deleteInsuranceCustomer = asyncHandler(async (req, res) => {
  const profile = await Profile.findById(req.params.id);
  if (!profile) {
    res.status(404);
    throw new Error("Profile not found");
  }

  profile.moduleMembership = profile.moduleMembership.filter((entry) => entry !== "insurance");
  profile.insuranceData = undefined;
  await profile.save();

  await logActivity({
    type: "insurance_customer_removed",
    module: "insurance",
    profile: profile._id,
    message: `Insurance module removed from ${profile.name}`
  });

  res.json({ success: true, message: "Insurance module removed from profile", data: profile });
});

const listInsurancePolicies = asyncHandler(async (req, res) => {
  const policies = await InsurancePolicy.find({}).sort({ createdAt: -1 });
  res.json({ success: true, data: policies });
});

const createInsurancePolicy = asyncHandler(async (req, res) => {
  const policy = await InsurancePolicy.create({
    policyNumber: req.body.policyNumber,
    policyType: req.body.policyType,
    insuranceProvider: req.body.insuranceProvider,
    policyStartDate: req.body.policyStartDate,
    policyEndDate: req.body.policyEndDate,
    coverageAmount: toNumberOr(req.body.coverageAmount, 0),
    deductibleAmount: toNumberOr(req.body.deductibleAmount, 0),
    premiumAmount: toNumberOr(req.body.premiumAmount, 0),
    paymentFrequency: req.body.paymentFrequency,
    policyStatus: req.body.policyStatus,
    customerId: req.body.customerId
  });

  await logActivity({
    type: "insurance_policy_saved",
    module: "insurance",
    message: `Insurance policy saved: ${policy.policyNumber}`
  });

  res.status(201).json({ success: true, data: policy });
});

const listInsuranceClaims = asyncHandler(async (req, res) => {
  const claims = await InsuranceClaim.find({}).sort({ createdAt: -1 });
  res.json({ success: true, data: claims });
});

const createInsuranceClaim = asyncHandler(async (req, res) => {
  const claim = await InsuranceClaim.create({
    claimNumber: req.body.claimNumber,
    policyNumber: req.body.policyNumber,
    claimDate: req.body.claimDate,
    incidentDate: req.body.incidentDate,
    claimType: req.body.claimType,
    claimDescription: req.body.claimDescription,
    claimStatus: req.body.claimStatus,
    claimAmountRequested: toNumberOr(req.body.claimAmountRequested, 0),
    claimAmountApproved: toNumberOr(req.body.claimAmountApproved, 0),
    adjusterDetails: req.body.adjusterDetails
  });

  await logActivity({
    type: "insurance_claim_saved",
    module: "insurance",
    message: `Insurance claim saved: ${claim.claimNumber}`
  });

  res.status(201).json({ success: true, data: claim });
});

const listInsurancePayments = asyncHandler(async (req, res) => {
  const payments = await InsurancePayment.find({}).sort({ createdAt: -1 });
  res.json({ success: true, data: payments });
});

const createInsurancePayment = asyncHandler(async (req, res) => {
  const payment = await InsurancePayment.create({
    paymentId: req.body.paymentId,
    policyNumber: req.body.policyNumber,
    paymentAmount: toNumberOr(req.body.paymentAmount, 0),
    paymentDate: req.body.paymentDate,
    paymentMethod: req.body.paymentMethod,
    paymentStatus: req.body.paymentStatus,
    invoiceNumber: req.body.invoiceNumber,
    outstandingBalance: toNumberOr(req.body.outstandingBalance, 0),
    lateFees: toNumberOr(req.body.lateFees, 0)
  });

  await logActivity({
    type: "insurance_payment_saved",
    module: "insurance",
    message: `Insurance payment saved: ${payment.paymentId}`
  });

  res.status(201).json({ success: true, data: payment });
});

module.exports = {
  listInsuranceCustomers,
  createInsuranceCustomer,
  updateInsuranceCustomer,
  deleteInsuranceCustomer,
  listInsurancePolicies,
  createInsurancePolicy,
  listInsuranceClaims,
  createInsuranceClaim,
  listInsurancePayments,
  createInsurancePayment
};
