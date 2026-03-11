const dayjs = require("dayjs");
const Profile = require("../models/Profile");
const Message = require("../models/Message");
const Appointment = require("../models/Appointment");
const IncomeRecord = require("../models/IncomeRecord");
const CreatorDailyData = require("../models/CreatorDailyData");
const IdealUser = require("../models/IdealUser");
const InsurancePolicy = require("../models/InsurancePolicy");
const InsuranceClaim = require("../models/InsuranceClaim");
const InsurancePayment = require("../models/InsurancePayment");
const { currency } = require("./formatService");
const { getFixedExpenseSnapshot } = require("./fixedExpenseService");
const { listGoogleCalendarAppointments } = require("./googleCalendarService");
const { isOpenAiConfigured, chatWithOpenAi } = require("./openAiService");

const TELEGRAM_DISPLAY_TIME_ZONE = String(
  process.env.TELEGRAM_DISPLAY_TIME_ZONE || process.env.APP_TIME_ZONE || "Asia/Dhaka"
).trim();

const normalizeText = (value) => String(value || "").toLowerCase().trim();

const includesAny = (text, keywords) => keywords.some((key) => text.includes(key));
const YES_WORDS = new Set(["yes", "yeah", "yup", "sure", "ok", "okay", "please", "yes please", "do it", "go ahead"]);
const NO_WORDS = new Set(["no", "nope", "nah", "not now", "stop", "cancel"]);
const EMPTY_CONVERSATION_STATE = {
  lastIntent: "",
  pendingAction: "",
  lastUserText: "",
  lastAssistantText: "",
  updatedAt: null
};
const INSURANCE_CLIENT_PENDING_PREFIX = "insurance_client_add:";
const INSURANCE_POLICY_PENDING_PREFIX = "insurance_policy_add:";
const INSURANCE_CLIENT_STATUSES = ["lead", "active", "pending", "inactive"];
const INSURANCE_POLICY_PAYMENT_FREQUENCIES = ["monthly", "yearly"];
const INSURANCE_POLICY_STATUSES = ["active", "cancelled", "expired", "pending"];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sanitizeConversationState = (state = {}) => ({
  ...EMPTY_CONVERSATION_STATE,
  lastIntent: String(state.lastIntent || "").trim(),
  pendingAction: String(state.pendingAction || "").trim(),
  lastUserText: String(state.lastUserText || "").trim(),
  lastAssistantText: String(state.lastAssistantText || "").trim(),
  updatedAt: state.updatedAt || null
});

const normalizeInsuranceClientStatus = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (INSURANCE_CLIENT_STATUSES.includes(normalized)) return normalized;
  return "";
};

const normalizePolicyPaymentFrequency = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (INSURANCE_POLICY_PAYMENT_FREQUENCIES.includes(normalized)) return normalized;
  return "";
};

const normalizePolicyStatus = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (INSURANCE_POLICY_STATUSES.includes(normalized)) return normalized;
  return "";
};

const toNonNegativeNumber = (value) => {
  const normalized = String(value ?? "")
    .replace(/,/g, "")
    .replace(/[^\d.]/g, "");
  if (!normalized) return NaN;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return NaN;
  return parsed;
};

const toIsoDateString = (value) => {
  const parsed = dayjs(String(value || "").trim());
  if (!parsed.isValid()) return "";
  return parsed.format("YYYY-MM-DD");
};

const INSURANCE_CLIENT_FIELDS = [
  { key: "fullName", label: "Full Name", aliases: ["full name", "name", "client name"], required: true },
  { key: "phone", label: "Phone Number", aliases: ["phone", "phone number", "mobile"], required: true },
  {
    key: "email",
    label: "Email Address",
    aliases: ["email", "email address", "mail"],
    required: true,
    normalize: (value) => String(value || "").trim().toLowerCase(),
    validate: (value) => (EMAIL_REGEX.test(value) ? "" : "Email format is invalid.")
  },
  { key: "customerId", label: "Customer ID", aliases: ["customer id", "customerid", "id"], required: true },
  { key: "policyType", label: "Policy Type", aliases: ["policy type", "policy"], required: true },
  {
    key: "status",
    label: "Status",
    aliases: ["status", "client status"],
    required: true,
    normalize: (value) => normalizeInsuranceClientStatus(value),
    validate: (value) => (value ? "" : "Status must be one of: lead, active, pending, inactive.")
  }
];

const INSURANCE_POLICY_FIELDS = [
  { key: "policyNumber", label: "Policy Number", aliases: ["policy number", "policy no", "policynumber"], required: true },
  { key: "policyType", label: "Policy Type", aliases: ["policy type"], required: true },
  { key: "insuranceProvider", label: "Insurance Provider", aliases: ["insurance provider", "provider", "carrier"], required: true },
  { key: "customerId", label: "Customer ID", aliases: ["customer id", "customerid"], required: true },
  {
    key: "policyStartDate",
    label: "Policy Start Date",
    aliases: ["policy start date", "start date", "policy start"],
    required: true,
    normalize: (value) => toIsoDateString(value),
    validate: (value) => (value ? "" : "Policy Start Date is invalid.")
  },
  {
    key: "policyEndDate",
    label: "Policy End Date",
    aliases: ["policy end date", "end date", "policy end"],
    required: true,
    normalize: (value) => toIsoDateString(value),
    validate: (value) => (value ? "" : "Policy End Date is invalid.")
  },
  {
    key: "coverageAmount",
    label: "Coverage Amount",
    aliases: ["coverage amount", "coverage"],
    required: true,
    normalize: (value) => toNonNegativeNumber(value),
    validate: (value) => (Number.isFinite(value) ? "" : "Coverage Amount must be a non-negative number.")
  },
  {
    key: "deductibleAmount",
    label: "Deductible Amount",
    aliases: ["deductible amount", "deductible"],
    required: true,
    normalize: (value) => toNonNegativeNumber(value),
    validate: (value) => (Number.isFinite(value) ? "" : "Deductible Amount must be a non-negative number.")
  },
  {
    key: "premiumAmount",
    label: "Premium Amount",
    aliases: ["premium amount", "premium"],
    required: true,
    normalize: (value) => toNonNegativeNumber(value),
    validate: (value) => (Number.isFinite(value) ? "" : "Premium Amount must be a non-negative number.")
  },
  {
    key: "paymentFrequency",
    label: "Payment Frequency",
    aliases: ["payment frequency", "frequency"],
    required: true,
    normalize: (value) => normalizePolicyPaymentFrequency(value),
    validate: (value) => (value ? "" : "Payment Frequency must be monthly or yearly.")
  },
  {
    key: "policyStatus",
    label: "Policy Status",
    aliases: ["policy status", "status"],
    required: true,
    normalize: (value) => normalizePolicyStatus(value),
    validate: (value) => (value ? "" : "Policy Status must be one of: active, cancelled, expired, pending.")
  }
];

const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const encodePendingState = (prefix, draft = {}) => {
  try {
    const encoded = Buffer.from(JSON.stringify(draft), "utf8").toString("base64");
    return `${prefix}${encoded}`;
  } catch {
    return prefix;
  }
};

const decodePendingState = (prefix, pendingAction = "") => {
  const raw = String(pendingAction || "");
  if (!raw.startsWith(prefix)) return null;

  const encoded = raw.slice(prefix.length);
  if (!encoded) return { data: {} };

  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return { data: {} };
  }
};

const decodeInsuranceClientPendingState = (pendingAction = "") => {
  const parsed = decodePendingState(INSURANCE_CLIENT_PENDING_PREFIX, pendingAction);
  if (!parsed) return null;
  if (Number.isInteger(parsed?.step)) {
    return { data: parsed?.data && typeof parsed.data === "object" ? parsed.data : {} };
  }
  return { data: parsed?.data && typeof parsed.data === "object" ? parsed.data : {} };
};

const decodeInsurancePolicyPendingState = (pendingAction = "") => {
  const parsed = decodePendingState(INSURANCE_POLICY_PENDING_PREFIX, pendingAction);
  if (!parsed) return null;
  return { data: parsed?.data && typeof parsed.data === "object" ? parsed.data : {} };
};

const extractInsuranceClientNameFromRequest = (rawText = "") => {
  const text = String(rawText || "").trim();
  if (!text) return "";

  const explicitNameMatch = text.match(/\bname\s+(.+)$/i);
  if (explicitNameMatch?.[1]) {
    return explicitNameMatch[1].trim();
  }

  const inlineMatch = text.match(
    /\b(?:add|create|save)\s+(?:new\s+)?(?:insurance\s+)?(?:client|customer)(?:\s+information)?\s+(.+)$/i
  );
  if (inlineMatch?.[1]) {
    return inlineMatch[1].trim();
  }

  return "";
};

const parseStructuredFields = (rawText = "", fieldDefs = []) => {
  const text = String(rawText || "").trim();
  if (!text) return {};

  const parsed = {};
  for (const def of fieldDefs) {
    const aliases = Array.isArray(def.aliases) ? def.aliases : [def.label];
    for (const alias of aliases) {
      const pattern = new RegExp(`${escapeRegex(alias)}\\s*[:=-]\\s*([^\\n\\r,;]+)`, "i");
      const match = text.match(pattern);
      if (match?.[1]) {
        parsed[def.key] = match[1].trim();
        break;
      }
    }
  }

  return parsed;
};

const evaluateFieldCollection = (fieldDefs = [], sourceData = {}) => {
  const normalizedData = {};
  const missingKeys = [];
  const invalidFields = [];

  for (const def of fieldDefs) {
    const rawValue = sourceData?.[def.key];
    const hasValue = rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== "";

    if (!hasValue) {
      if (def.required) missingKeys.push(def.key);
      continue;
    }

    const normalize = typeof def.normalize === "function" ? def.normalize : (value) => String(value).trim();
    const normalizedValue = normalize(rawValue);
    const normalizedHasValue =
      normalizedValue !== undefined &&
      normalizedValue !== null &&
      !(typeof normalizedValue === "string" && normalizedValue.trim() === "") &&
      !(typeof normalizedValue === "number" && Number.isNaN(normalizedValue));

    if (!normalizedHasValue) {
      invalidFields.push({ key: def.key, label: def.label, reason: `${def.label} is invalid.` });
      continue;
    }

    if (typeof def.validate === "function") {
      const errorMessage = def.validate(normalizedValue);
      if (errorMessage) {
        invalidFields.push({ key: def.key, label: def.label, reason: errorMessage });
        continue;
      }
    }

    normalizedData[def.key] = normalizedValue;
  }

  return { normalizedData, missingKeys, invalidFields };
};

const getFieldLabelByKey = (fieldDefs = [], key = "") => fieldDefs.find((entry) => entry.key === key)?.label || key;

const buildCollectionTemplateLines = (fieldDefs = [], keys = []) => {
  const targets = keys.length ? keys : fieldDefs.map((entry) => entry.key);
  return targets.map((key) => `${getFieldLabelByKey(fieldDefs, key)}:`);
};

const buildMissingFieldsPrompt = (entityLabel, fieldDefs, missingKeys = [], invalidFields = []) => {
  const lines = [`Add ${entityLabel} started.`];
  if (invalidFields.length) {
    lines.push("Please correct these fields:");
    invalidFields.forEach((entry) => lines.push(`- ${entry.reason}`));
  }
  if (missingKeys.length) {
    lines.push("Missing fields:");
    missingKeys.forEach((key) => lines.push(`- ${getFieldLabelByKey(fieldDefs, key)}`));
  }
  lines.push("Send all missing fields in one message using this format:");
  lines.push(...buildCollectionTemplateLines(fieldDefs, missingKeys));
  lines.push("Type cancel to stop.");
  return lines.join("\n");
};

const buildOnboardingReply = (body = "") => String(body || "").trim();

const mergeStructuredFields = (rawUserText = "", fieldDefs = [], existingData = {}) => {
  const parsedFromText = parseStructuredFields(rawUserText, fieldDefs);
  return { ...existingData, ...parsedFromText };
};

const buildInsuranceClientConfirmation = (profile, created) =>
  [
    created ? "Insurance client added successfully." : "Insurance client updated successfully.",
    `Name: ${profile.name || "-"}`,
    `Phone: ${profile.phone || "-"}`,
    `Email: ${profile.email || "-"}`,
    `Customer ID: ${profile.insuranceData?.customerId || "-"}`,
    `Policy Type: ${profile.insuranceData?.policyType || "-"}`,
    `Status: ${profile.insuranceData?.status || "-"}`
  ].join("\n");

const buildInsurancePolicyConfirmation = (policy, created) =>
  [
    created ? "Policy information added successfully." : "Policy information updated successfully.",
    `Policy Number: ${policy.policyNumber || "-"}`,
    `Policy Type: ${policy.policyType || "-"}`,
    `Provider: ${policy.insuranceProvider || "-"}`,
    `Customer ID: ${policy.customerId || "-"}`,
    `Start Date: ${policy.policyStartDate ? dayjs(policy.policyStartDate).format("YYYY-MM-DD") : "-"}`,
    `End Date: ${policy.policyEndDate ? dayjs(policy.policyEndDate).format("YYYY-MM-DD") : "-"}`,
    `Coverage Amount: ${Number(policy.coverageAmount || 0)}`,
    `Deductible Amount: ${Number(policy.deductibleAmount || 0)}`,
    `Premium Amount: ${Number(policy.premiumAmount || 0)}`,
    `Payment Frequency: ${policy.paymentFrequency || "-"}`,
    `Policy Status: ${policy.policyStatus || "-"}`
  ].join("\n");

const createPendingActionValue = (prefix, data = {}) => encodePendingState(prefix, { data });

const saveInsuranceClientFromTelegram = async (payload = {}) => {
  const fullName = String(payload.fullName || "").trim();
  if (!fullName) {
    throw new Error("Full Name is required");
  }

  const phone = String(payload.phone || "").trim();
  const email = String(payload.email || "").trim().toLowerCase();
  const customerId = String(payload.customerId || "").trim();
  const policyType = String(payload.policyType || "").trim();
  const status = normalizeInsuranceClientStatus(payload.status) || "lead";

  const identityFilters = [];
  if (email) identityFilters.push({ email });
  if (phone) identityFilters.push({ phone });

  const existingProfile = identityFilters.length ? await Profile.findOne({ $or: identityFilters }) : null;

  if (!existingProfile) {
    const created = await Profile.create({
      name: fullName,
      phone,
      email,
      moduleMembership: ["insurance"],
      insuranceData: {
        customerId,
        policyType,
        status
      }
    });

    return { profile: created, created: true };
  }

  if (!Array.isArray(existingProfile.moduleMembership)) {
    existingProfile.moduleMembership = [];
  }
  if (!existingProfile.moduleMembership.includes("insurance")) {
    existingProfile.moduleMembership.push("insurance");
  }

  existingProfile.name = fullName || existingProfile.name;
  if (phone) existingProfile.phone = phone;
  if (email) existingProfile.email = email;
  existingProfile.insuranceData = {
    ...(existingProfile.insuranceData?.toObject?.() || existingProfile.insuranceData || {}),
    customerId: customerId || existingProfile.insuranceData?.customerId || "",
    policyType: policyType || existingProfile.insuranceData?.policyType || "",
    status: status || existingProfile.insuranceData?.status || "lead"
  };
  await existingProfile.save();

  return { profile: existingProfile, created: false };
};

const saveInsurancePolicyFromTelegram = async (payload = {}) => {
  const policyNumber = String(payload.policyNumber || "").trim();
  if (!policyNumber) {
    throw new Error("Policy Number is required");
  }

  const existing = await InsurancePolicy.findOne({ policyNumber });
  if (!existing) {
    const created = await InsurancePolicy.create({
      policyNumber,
      policyType: payload.policyType,
      insuranceProvider: payload.insuranceProvider,
      customerId: payload.customerId,
      policyStartDate: payload.policyStartDate,
      policyEndDate: payload.policyEndDate,
      coverageAmount: payload.coverageAmount,
      deductibleAmount: payload.deductibleAmount,
      premiumAmount: payload.premiumAmount,
      paymentFrequency: payload.paymentFrequency,
      policyStatus: payload.policyStatus
    });
    return { policy: created, created: true };
  }

  existing.policyType = payload.policyType;
  existing.insuranceProvider = payload.insuranceProvider;
  existing.customerId = payload.customerId;
  existing.policyStartDate = payload.policyStartDate;
  existing.policyEndDate = payload.policyEndDate;
  existing.coverageAmount = payload.coverageAmount;
  existing.deductibleAmount = payload.deductibleAmount;
  existing.premiumAmount = payload.premiumAmount;
  existing.paymentFrequency = payload.paymentFrequency;
  existing.policyStatus = payload.policyStatus;
  await existing.save();
  return { policy: existing, created: false };
};

const startInsuranceClientOnboarding = async (rawUserText) => {
  const extractedName = extractInsuranceClientNameFromRequest(rawUserText);
  const merged = mergeStructuredFields(rawUserText, INSURANCE_CLIENT_FIELDS, extractedName ? { fullName: extractedName } : {});
  const { normalizedData, missingKeys, invalidFields } = evaluateFieldCollection(INSURANCE_CLIENT_FIELDS, merged);

  if (!missingKeys.length && !invalidFields.length) {
    try {
      const { profile, created } = await saveInsuranceClientFromTelegram(normalizedData);
      return { reply: buildOnboardingReply(buildInsuranceClientConfirmation(profile, created)), pendingAction: "" };
    } catch (error) {
      return {
        reply: buildOnboardingReply(`Could not save insurance client. Reason: ${error.message || "Unknown error"}`),
        pendingAction: createPendingActionValue(INSURANCE_CLIENT_PENDING_PREFIX, normalizedData)
      };
    }
  }

  return {
    reply: buildOnboardingReply(buildMissingFieldsPrompt("insurance client", INSURANCE_CLIENT_FIELDS, missingKeys, invalidFields)),
    pendingAction: createPendingActionValue(INSURANCE_CLIENT_PENDING_PREFIX, normalizedData)
  };
};

const startInsurancePolicyOnboarding = async (rawUserText) => {
  const merged = mergeStructuredFields(rawUserText, INSURANCE_POLICY_FIELDS, {});
  const { normalizedData, missingKeys, invalidFields } = evaluateFieldCollection(INSURANCE_POLICY_FIELDS, merged);

  if (!missingKeys.length && !invalidFields.length) {
    try {
      const { policy, created } = await saveInsurancePolicyFromTelegram(normalizedData);
      return { reply: buildOnboardingReply(buildInsurancePolicyConfirmation(policy, created)), pendingAction: "" };
    } catch (error) {
      return {
        reply: buildOnboardingReply(`Could not save policy information. Reason: ${error.message || "Unknown error"}`),
        pendingAction: createPendingActionValue(INSURANCE_POLICY_PENDING_PREFIX, normalizedData)
      };
    }
  }

  return {
    reply: buildOnboardingReply(buildMissingFieldsPrompt("policy information", INSURANCE_POLICY_FIELDS, missingKeys, invalidFields)),
    pendingAction: createPendingActionValue(INSURANCE_POLICY_PENDING_PREFIX, normalizedData)
  };
};

const resolveInsuranceClientOnboardingTurn = async (rawUserText, priorDraft) => {
  const text = String(rawUserText || "").trim();
  const existingData = priorDraft?.data && typeof priorDraft.data === "object" ? priorDraft.data : {};
  const currentlyMissing = evaluateFieldCollection(INSURANCE_CLIENT_FIELDS, existingData).missingKeys;

  if (!text) {
    return {
      reply: buildOnboardingReply("Please send a valid value."),
      pendingAction: createPendingActionValue(INSURANCE_CLIENT_PENDING_PREFIX, existingData)
    };
  }

  if (isNegativeMessage(text)) {
    return { reply: buildOnboardingReply("Insurance client add cancelled."), pendingAction: "" };
  }

  let merged = mergeStructuredFields(text, INSURANCE_CLIENT_FIELDS, existingData);
  const parsedNow = parseStructuredFields(text, INSURANCE_CLIENT_FIELDS);
  if (!Object.keys(parsedNow).length && currentlyMissing.length === 1) {
    merged = { ...merged, [currentlyMissing[0]]: text };
  }

  const { normalizedData, missingKeys, invalidFields } = evaluateFieldCollection(INSURANCE_CLIENT_FIELDS, merged);
  if (missingKeys.length || invalidFields.length) {
    return {
      reply: buildOnboardingReply(buildMissingFieldsPrompt("insurance client", INSURANCE_CLIENT_FIELDS, missingKeys, invalidFields)),
      pendingAction: createPendingActionValue(INSURANCE_CLIENT_PENDING_PREFIX, normalizedData)
    };
  }

  try {
    const { profile, created } = await saveInsuranceClientFromTelegram(normalizedData);
    return { reply: buildOnboardingReply(buildInsuranceClientConfirmation(profile, created)), pendingAction: "" };
  } catch (error) {
    return {
      reply: buildOnboardingReply(`Could not save insurance client. Reason: ${error.message || "Unknown error"}`),
      pendingAction: createPendingActionValue(INSURANCE_CLIENT_PENDING_PREFIX, normalizedData)
    };
  }
};

const resolveInsurancePolicyOnboardingTurn = async (rawUserText, priorDraft) => {
  const text = String(rawUserText || "").trim();
  const existingData = priorDraft?.data && typeof priorDraft.data === "object" ? priorDraft.data : {};
  const currentlyMissing = evaluateFieldCollection(INSURANCE_POLICY_FIELDS, existingData).missingKeys;

  if (!text) {
    return {
      reply: buildOnboardingReply("Please send a valid value."),
      pendingAction: createPendingActionValue(INSURANCE_POLICY_PENDING_PREFIX, existingData)
    };
  }

  if (isNegativeMessage(text)) {
    return { reply: buildOnboardingReply("Policy add cancelled."), pendingAction: "" };
  }

  let merged = mergeStructuredFields(text, INSURANCE_POLICY_FIELDS, existingData);
  const parsedNow = parseStructuredFields(text, INSURANCE_POLICY_FIELDS);
  if (!Object.keys(parsedNow).length && currentlyMissing.length === 1) {
    merged = { ...merged, [currentlyMissing[0]]: text };
  }

  const { normalizedData, missingKeys, invalidFields } = evaluateFieldCollection(INSURANCE_POLICY_FIELDS, merged);
  if (missingKeys.length || invalidFields.length) {
    return {
      reply: buildOnboardingReply(buildMissingFieldsPrompt("policy information", INSURANCE_POLICY_FIELDS, missingKeys, invalidFields)),
      pendingAction: createPendingActionValue(INSURANCE_POLICY_PENDING_PREFIX, normalizedData)
    };
  }

  try {
    const { policy, created } = await saveInsurancePolicyFromTelegram(normalizedData);
    return { reply: buildOnboardingReply(buildInsurancePolicyConfirmation(policy, created)), pendingAction: "" };
  } catch (error) {
    return {
      reply: buildOnboardingReply(`Could not save policy information. Reason: ${error.message || "Unknown error"}`),
      pendingAction: createPendingActionValue(INSURANCE_POLICY_PENDING_PREFIX, normalizedData)
    };
  }
};

const isAffirmativeMessage = (rawText) => {
  const text = normalizeText(rawText).replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  return Boolean(text) && (YES_WORDS.has(text) || text.startsWith("yes "));
};

const isNegativeMessage = (rawText) => {
  const text = normalizeText(rawText).replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  return Boolean(text) && NO_WORDS.has(text);
};

const isGreetingMessage = (rawText) => {
  const normalized = normalizeText(rawText).replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  const compactGreetings = new Set(["hi", "hii", "hello", "hey", "salam", "slm", "assalamualaikum", "yo"]);
  if (compactGreetings.has(normalized)) return true;

  const phraseGreetings = ["assalamu alaikum", "good morning", "good afternoon", "good evening"];
  if (phraseGreetings.includes(normalized)) return true;

  const words = normalized.split(" ");
  return words.length <= 2 && compactGreetings.has(words[0]);
};

const isHelpRequest = (rawText) => {
  const text = normalizeText(rawText);
  return ["/help", "help", "menu", "commands"].includes(text);
};

const formatTimeZoneDateTime = (value, options = {}) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  const includeDate = options.includeDate !== false;
  const includeYear = Boolean(options.includeYear);
  const timeOnly = Boolean(options.timeOnly);
  const formatterOptions = {
    timeZone: TELEGRAM_DISPLAY_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  };

  if (!timeOnly && includeDate) {
    formatterOptions.month = "short";
    formatterOptions.day = "numeric";
    if (includeYear) {
      formatterOptions.year = "numeric";
    }
  }

  try {
    return new Intl.DateTimeFormat("en-US", formatterOptions).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      ...formatterOptions,
      timeZone: "UTC"
    }).format(date);
  }
};

const getTimeZoneHour = () => {
  try {
    const value = new Intl.DateTimeFormat("en-US", {
      timeZone: TELEGRAM_DISPLAY_TIME_ZONE,
      hour: "numeric",
      hour12: false
    }).format(new Date());
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : dayjs().hour();
  } catch {
    return dayjs().hour();
  }
};

const getGreetingByTime = () => {
  const hour = getTimeZoneHour();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

const identifyIntent = (rawText) => {
  const text = normalizeText(rawText);

  if (isGreetingMessage(text)) return "greeting";
  if (isHelpRequest(text)) return "help";
  if (text === "/appointments" || text === "/appointment") return "upcoming_appointments";
  if (text === "/today_appointments" || text === "/today") return "today_appointments";
  if (text === "/fixed_expenses" || text === "/fixed") return "fixed_expenses_list";
  if (text === "/summary" || text === "/crm") return "crm_overview";

  const asksPartnerIncome = includesAny(text, ["partner"]) && includesAny(text, ["income", "revenue", "earning"]);
  const asksBreakdown = includesAny(text, ["which", "breakdown", "list", "from", "top"]);
  if (asksPartnerIncome && asksBreakdown) return "partner_income_breakdown";
  if (asksPartnerIncome) return "partner_income_total";

  const mentionsPartner = includesAny(text, ["partner", "parner"]);
  const asksCount = includesAny(text, ["how many", "count", "total", "number of"]);
  const asksList = includesAny(text, ["list", "show", "names", "who"]);
  if (mentionsPartner && asksCount) return "tiktok_partners_count";
  if (mentionsPartner && asksList) return "tiktok_partners_list";
  if (mentionsPartner) return "tiktok_partners_overview";

  const mentionsClient = includesAny(text, ["insurance client", "insurance clients", "client", "clients"]);
  const asksAddInsuranceClient = includesAny(text, [
    "add insurance client",
    "add insurance customer",
    "add client",
    "add customer",
    "create insurance client",
    "create client",
    "save insurance client",
    "save client",
    "new insurance client",
    "new client"
  ]);
  const asksAddInsurancePolicy = includesAny(text, [
    "add policy",
    "create policy",
    "save policy",
    "policy information",
    "add policy information",
    "new policy"
  ]);
  if (asksAddInsuranceClient) return "insurance_client_add";
  if (asksAddInsurancePolicy) return "insurance_policy_add";
  if (mentionsClient && asksCount) return "insurance_clients_count";
  if (mentionsClient && asksList) return "insurance_clients_list";
  if (mentionsClient) return "insurance_clients_overview";

  const asksFixedExpenses =
    includesAny(text, ["fixed expense", "fixed expenses", "give list fixed expense", "monthly fixed", "office rent", "team salary"]) &&
    !includesAny(text, ["variable"]);
  if (asksFixedExpenses) return "fixed_expenses_list";

  const asksIdealCreatorCount = includesAny(text, [
    "ideal creator",
    "ideal creators",
    "ideal user",
    "ideal users",
    "how many ideal",
    "ideal count"
  ]);
  if (asksIdealCreatorCount) return "ideal_creators_count";

  if (includesAny(text, ["creator", "interest", "interested"])) {
    return "interested_creators";
  }

  const appointmentRelated = includesAny(text, [
    "upcoming",
    "appointment",
    "appt",
    "meeting",
    "schedule",
    "booked"
  ]);
  const asksAppointmentCheck =
    appointmentRelated &&
    includesAny(text, ["have any", "do i have", "is there any", "do we have"]);
  const asksTodayAppointments = appointmentRelated && includesAny(text, ["today", "todays", "for today"]);

  if (asksAppointmentCheck) return "appointment_check";
  if (asksTodayAppointments) return "today_appointments";
  if (appointmentRelated) {
    return "upcoming_appointments";
  }

  if (includesAny(text, ["agent", "workflow", "automation", "auto", "control", "manage everything"])) {
    return "agent_workflow";
  }

  if (includesAny(text, ["insurance statistics", "insurance stats", "insurance overview", "insurance"])) {
    return "insurance_statistics";
  }

  if (includesAny(text, ["tiktok", "creator performance", "partner data"])) {
    return "tiktok_overview";
  }

  if (includesAny(text, ["crm overview", "dashboard", "overall", "summary"])) {
    return "crm_overview";
  }

  return "general";
};

const getPartnerIncomeBreakdown = async (limit = 15) => {
  const rows = await Profile.find({
    moduleMembership: "tiktok",
    "tiktokData.partnerRevenue": { $gt: 0 }
  })
    .select("name tiktokData.creatorName tiktokData.partnerRevenue")
    .sort({ "tiktokData.partnerRevenue": -1 })
    .limit(limit)
    .lean();

  return rows.map((row) => ({
    name: row.tiktokData?.creatorName || row.name || "-",
    income: Number(row.tiktokData?.partnerRevenue || 0)
  }));
};

const getPartnerIncomeTotal = async () => {
  const agg = await Profile.aggregate([
    { $match: { moduleMembership: "tiktok" } },
    { $group: { _id: null, total: { $sum: { $ifNull: ["$tiktokData.partnerRevenue", 0] } } } }
  ]);

  return Number(agg[0]?.total || 0);
};

const getInterestedCreatorsCount = async () => {
  const agg = await Message.aggregate([
    { $match: { deliveryStatus: "reply", profile: { $exists: true, $ne: null } } },
    { $group: { _id: "$profile" } },
    { $count: "count" }
  ]);

  return Number(agg[0]?.count || 0);
};

const mapDatabaseAppointments = (appointments = []) =>
  appointments.map((item) => ({
    customer: item.profile?.name || "-",
    phone: item.profile?.phone || "-",
    when: item.scheduledFor
  }));

const mapGoogleCalendarAppointments = (appointments = []) =>
  appointments.map((item) => ({
    customer: item.profile?.name || "-",
    phone: item.profile?.phone || "-",
    when: item.scheduledFor
  }));

const getDatabaseUpcomingAppointments = async (limit = 7) => {
  const appointments = await Appointment.find({
    scheduledFor: { $gte: new Date() },
    status: "scheduled"
  })
    .populate("profile", "name phone")
    .sort({ scheduledFor: 1 })
    .limit(limit)
    .lean();

  return mapDatabaseAppointments(appointments);
};

const getDatabaseTodayAppointments = async (limit = 10) => {
  const start = new Date();
  const end = dayjs().endOf("day").toDate();

  const appointments = await Appointment.find({
    scheduledFor: { $gte: start, $lte: end },
    status: "scheduled"
  })
    .populate("profile", "name phone")
    .sort({ scheduledFor: 1 })
    .limit(limit)
    .lean();

  return mapDatabaseAppointments(appointments);
};

const getGoogleCalendarUpcomingAppointments = async (connectionKey, limit = 30) => {
  const appointments = await listGoogleCalendarAppointments({
    connectionKey,
    today: false,
    maxResults: Math.max(limit, 10),
    bookedOnly: true
  });
  return mapGoogleCalendarAppointments(appointments).slice(0, limit);
};

const getGoogleCalendarTodayAppointments = async (connectionKey, limit = 30) => {
  const appointments = await listGoogleCalendarAppointments({
    connectionKey,
    today: true,
    maxResults: Math.max(limit, 10),
    bookedOnly: true
  });
  return mapGoogleCalendarAppointments(appointments).slice(0, limit);
};

const getGoogleCalendarFallbackNotice = (error) => {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("not connected")) {
    return "Google Calendar is not connected for this workspace. Showing CRM database appointments instead.";
  }

  return "Could not read Google Calendar right now. Showing CRM database appointments instead.";
};

const getAppointmentsSnapshot = async ({ connectionKey, upcomingLimit = 5, todayLimit = 10 } = {}) => {
  const normalizedKey = String(connectionKey || "").trim();
  if (!normalizedKey) {
    const [upcoming, todayAppointments] = await Promise.all([
      getDatabaseUpcomingAppointments(upcomingLimit),
      getDatabaseTodayAppointments(todayLimit)
    ]);
    return {
      upcoming,
      todayAppointments,
      appointmentSource: "database",
      appointmentSourceNotice: ""
    };
  }

  try {
    const [upcoming, todayAppointments] = await Promise.all([
      getGoogleCalendarUpcomingAppointments(normalizedKey, upcomingLimit),
      getGoogleCalendarTodayAppointments(normalizedKey, todayLimit)
    ]);

    return {
      upcoming,
      todayAppointments,
      appointmentSource: "google_calendar",
      appointmentSourceNotice: ""
    };
  } catch (error) {
    const [upcoming, todayAppointments] = await Promise.all([
      getDatabaseUpcomingAppointments(upcomingLimit),
      getDatabaseTodayAppointments(todayLimit)
    ]);

    return {
      upcoming,
      todayAppointments,
      appointmentSource: "database",
      appointmentSourceNotice: getGoogleCalendarFallbackNotice(error)
    };
  }
};

const getInsuranceStatistics = async () => {
  const [totalClients, totalPolicies, activePolicies, pendingClaims, approvedClaims, paidPaymentsAgg, outstandingAgg, expiringSoon] =
    await Promise.all([
      Profile.countDocuments({ moduleMembership: "insurance" }),
      InsurancePolicy.countDocuments({}),
      InsurancePolicy.countDocuments({ policyStatus: "active" }),
      InsuranceClaim.countDocuments({ claimStatus: "pending" }),
      InsuranceClaim.countDocuments({ claimStatus: "approved" }),
      InsurancePayment.aggregate([
        { $match: { paymentStatus: "paid" } },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$paymentAmount", 0] } } } }
      ]),
      InsurancePayment.aggregate([
        { $group: { _id: null, total: { $sum: { $ifNull: ["$outstandingBalance", 0] } } } }
      ]),
      InsurancePolicy.countDocuments({
        policyEndDate: {
          $gte: new Date(),
          $lte: dayjs().add(30, "day").endOf("day").toDate()
        }
      })
    ]);

  return {
    totalClients,
    totalPolicies,
    activePolicies,
    pendingClaims,
    approvedClaims,
    collectedPayments: Number(paidPaymentsAgg[0]?.total || 0),
    outstandingBalance: Number(outstandingAgg[0]?.total || 0),
    expiringSoon
  };
};

const getRecentClaims = async (limit = 5) => {
  const claims = await InsuranceClaim.find({})
    .select("claimNumber claimStatus claimType claimDate claimAmountRequested claimAmountApproved")
    .sort({ claimDate: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  return claims.map((claim) => ({
    claimNumber: claim.claimNumber || "-",
    claimType: claim.claimType || "-",
    claimStatus: claim.claimStatus || "-",
    claimDate: claim.claimDate || null,
    requested: Number(claim.claimAmountRequested || 0),
    approved: Number(claim.claimAmountApproved || 0)
  }));
};

const getMessageDeliveryStats = async () => {
  const stats = await Message.aggregate([{ $group: { _id: "$deliveryStatus", count: { $sum: 1 } } }]);
  const byStatus = Object.fromEntries(stats.map((row) => [String(row._id || ""), Number(row.count || 0)]));

  return {
    sent: Number(byStatus.sent || 0),
    delivered: Number(byStatus.delivered || 0),
    replies: Number(byStatus.reply || 0),
    failed: Number((byStatus.delivery_failed || 0) + (byStatus.failed || 0))
  };
};

const getMonthlyAgencyRevenue = async () => {
  const start = dayjs().startOf("month").toDate();
  const agg = await IncomeRecord.aggregate([
    { $match: { date: { $gte: start } } },
    { $group: { _id: null, totalRevenue: { $sum: { $ifNull: ["$totalRevenue", 0] } } } }
  ]);

  return Number(agg[0]?.totalRevenue || 0);
};

const getCreatorDailySummary = async () => {
  const start = dayjs().subtract(6, "day").startOf("day").toDate();
  const agg = await CreatorDailyData.aggregate([
    { $match: { date: { $gte: start } } },
    {
      $group: {
        _id: null,
        totalIncome: { $sum: { $ifNull: ["$income", 0] } },
        totalDiamonds: { $sum: { $ifNull: ["$diamonds", 0] } },
        totalLiveHours: { $sum: { $ifNull: ["$liveHours", 0] } },
        records: { $sum: 1 }
      }
    }
  ]);

  return {
    records: Number(agg[0]?.records || 0),
    totalIncome: Number(agg[0]?.totalIncome || 0),
    totalDiamonds: Number(agg[0]?.totalDiamonds || 0),
    totalLiveHours: Number(agg[0]?.totalLiveHours || 0)
  };
};

const getIdealUserPreview = async (limit = 5) => {
  const users = await IdealUser.find({})
    .select("username diamonds revenew")
    .sort({ revenew: -1, diamonds: -1 })
    .limit(limit)
    .lean();

  return users.map((user) => ({
    username: user.username || "-",
    diamonds: Number(user.diamonds || 0),
    revenew: Number(user.revenew || 0)
  }));
};

const getIdealCreatorsCount = async () => {
  const total = await IdealUser.countDocuments({});
  return Number(total || 0);
};

const getIdealCreatorUsernames = async (limit = 20) => {
  const rows = await IdealUser.find({})
    .select("username")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return rows.map((row) => String(row.username || "").trim()).filter(Boolean);
};

const getTikTokPartners = async (limit = 10) => {
  const rows = await Profile.find({ moduleMembership: "tiktok" })
    .select("name phone tiktokData.creatorName tiktokData.tiktokUsername tiktokData.partnerRevenue")
    .sort({ "tiktokData.partnerRevenue": -1, updatedAt: -1 })
    .limit(limit)
    .lean();

  return rows.map((row) => ({
    name: row.tiktokData?.creatorName || row.name || "-",
    username: row.tiktokData?.tiktokUsername || "",
    phone: row.phone || "",
    revenue: Number(row.tiktokData?.partnerRevenue || 0)
  }));
};

const getInsuranceClients = async (limit = 10) => {
  const rows = await Profile.find({ moduleMembership: "insurance" })
    .select("name phone email insuranceData.customerId insuranceData.policyNumber insuranceData.status")
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  return rows.map((row) => ({
    name: row.name || "-",
    phone: row.phone || "",
    email: row.email || "",
    customerId: row.insuranceData?.customerId || "",
    policyNumber: row.insuranceData?.policyNumber || "",
    status: row.insuranceData?.status || "lead"
  }));
};

const getFixedExpensesData = async () => getFixedExpenseSnapshot();

const buildMetricsSnapshot = async (options = {}) => {
  const [
    totalProfiles,
    insuranceClients,
    tiktokCreators,
    breakdown,
    totalIncome,
    interestedCreators,
    appointmentsSnapshot,
    insurance,
    recentClaims,
    messageStats,
    monthlyAgencyRevenue,
    creatorDailySummary,
    idealUsers,
    idealCreatorsCount,
    fixedExpenses
  ] = await Promise.all([
    Profile.countDocuments({}),
    Profile.countDocuments({ moduleMembership: "insurance" }),
    Profile.countDocuments({ moduleMembership: "tiktok" }),
    getPartnerIncomeBreakdown(8),
    getPartnerIncomeTotal(),
    getInterestedCreatorsCount(),
    getAppointmentsSnapshot({
      connectionKey: options.connectionKey,
      upcomingLimit: 5,
      todayLimit: 10
    }),
    getInsuranceStatistics(),
    getRecentClaims(5),
    getMessageDeliveryStats(),
    getMonthlyAgencyRevenue(),
    getCreatorDailySummary(),
    getIdealUserPreview(5),
    getIdealCreatorsCount(),
    getFixedExpensesData()
  ]);

  return {
    generatedAt: new Date().toISOString(),
    overview: {
      totalProfiles,
      insuranceClients,
      tiktokCreators
    },
    breakdown,
    totalIncome,
    interestedCreators,
    upcoming: appointmentsSnapshot.upcoming,
    todayAppointments: appointmentsSnapshot.todayAppointments,
    appointmentSource: appointmentsSnapshot.appointmentSource,
    appointmentSourceNotice: appointmentsSnapshot.appointmentSourceNotice,
    insurance: {
      ...insurance,
      recentClaims
    },
    expenses: fixedExpenses,
    tiktok: {
      creatorsCount: tiktokCreators,
      monthlyAgencyRevenue,
      messageStats,
      creatorDailySummary,
      idealUsers,
      idealCreatorsCount
    }
  };
};

const formatPartnerIncomeBreakdown = (rows) => {
  if (!rows.length) return "No partner income data found.";
  return ["Partner income breakdown:", ...rows.map((row, index) => `${index + 1}. ${row.name}: ${currency(row.income)}`)].join("\n");
};

const formatPartnerIncomeTotal = (total) => `Total partner income: ${currency(total)}.`;

const formatInterestedCreators = (count) => `Interested creators (reply received): ${count}.`;
const formatIdealCreatorsCount = (count) => `Total ideal creators in database: ${count}.`;
const formatIdealCreatorUsernames = (usernames) => {
  if (!usernames.length) return "No ideal creator usernames found.";
  return ["Ideal creator usernames:", ...usernames.map((name, index) => `${index + 1}. ${name}`)].join("\n");
};

const formatTikTokPartnersCount = (count) => `Total TikTok partners in agency CRM: ${count}.`;
const formatInsuranceClientsCount = (count) => `Total insurance clients in CRM: ${count}.`;

const formatTikTokPartners = (rows) => {
  if (!rows.length) return "No TikTok partners found.";
  return [
    "TikTok partners:",
    ...rows.map((row, index) => {
      const username = row.username ? ` (@${row.username.replace(/^@/, "")})` : "";
      const revenue = row.revenue > 0 ? ` - Revenue: ${currency(row.revenue)}` : "";
      return `${index + 1}. ${row.name}${username}${revenue}`;
    })
  ].join("\n");
};

const formatInsuranceClients = (rows) => {
  if (!rows.length) return "No insurance clients found.";
  return [
    "Insurance clients:",
    ...rows.map((row, index) => {
      const extras = [row.policyNumber ? `Policy ${row.policyNumber}` : "", row.status ? `Status ${row.status}` : ""]
        .filter(Boolean)
        .join(", ");
      return `${index + 1}. ${row.name}${extras ? ` - ${extras}` : ""}`;
    })
  ].join("\n");
};

const formatFixedExpenses = (fixedExpenses) => {
  const items = Array.isArray(fixedExpenses?.items) ? fixedExpenses.items : [];
  if (!items.length) return "No fixed expenses configured.";

  return [
    "Fixed expense list:",
    ...items.map((item, index) => `${index + 1}. ${item.title}: ${currency(item.amount)}`),
    `Monthly fixed expense total: ${currency(fixedExpenses.monthlyTotal || 0)}`
  ].join("\n");
};

const getAppointmentSourceLabel = (snapshot = {}) =>
  snapshot.appointmentSource === "google_calendar" ? "Google Calendar" : "CRM database";

const formatUpcomingAppointments = (rows, snapshot = {}) => {
  const sourceLabel = getAppointmentSourceLabel(snapshot);
  const notice = String(snapshot.appointmentSourceNotice || "").trim();
  if (!rows.length) {
    return [notice, `No upcoming appointments found in ${sourceLabel}.`].filter(Boolean).join("\n");
  }

  return [
    notice,
    `Upcoming appointments (${sourceLabel}):`,
    ...rows.map((row, index) => {
      const phonePart = row.phone && row.phone !== "-" ? ` (${row.phone})` : "";
      return `${index + 1}. ${row.customer}${phonePart} - ${formatTimeZoneDateTime(row.when)}`;
    })
  ].join("\n");
};

const formatTodayAppointments = (rows, snapshot = {}) => {
  const sourceLabel = getAppointmentSourceLabel(snapshot);
  const notice = String(snapshot.appointmentSourceNotice || "").trim();
  if (!rows.length) {
    return [notice, `No scheduled appointments found for today in ${sourceLabel}.`].filter(Boolean).join("\n");
  }

  return [
    notice,
    `Today's appointments (${sourceLabel}):`,
    ...rows.map((row, index) => {
      const phonePart = row.phone && row.phone !== "-" ? ` (${row.phone})` : "";
      return `${index + 1}. ${row.customer}${phonePart} - ${formatTimeZoneDateTime(row.when, { timeOnly: true })}`;
    })
  ].join("\n");
};

const formatAppointmentCheck = (snapshot) => {
  const todayCount = snapshot.todayAppointments.length;
  const upcomingCount = snapshot.upcoming.length;
  const nextAppointment = snapshot.upcoming[0] || snapshot.todayAppointments[0];
  const sourceLabel = getAppointmentSourceLabel(snapshot);
  const notice = String(snapshot.appointmentSourceNotice || "").trim();

  if (!todayCount && !upcomingCount) {
    return [notice, `No scheduled appointment found in ${sourceLabel} right now.`].filter(Boolean).join("\n");
  }

  const lines = [
    notice,
    `Yes, appointment data found in ${sourceLabel}.`,
    `- Today: ${todayCount}`,
    `- Upcoming: ${upcomingCount}`
  ].filter(Boolean);

  if (nextAppointment) {
    const phonePart = nextAppointment.phone && nextAppointment.phone !== "-" ? ` (${nextAppointment.phone})` : "";
    lines.push(
      `- Next: ${nextAppointment.customer}${phonePart} at ${formatTimeZoneDateTime(nextAppointment.when)}`
    );
  }

  return lines.join("\n");
};

const formatAgentWorkflowCapabilities = () =>
  [
    "Telegram CRM agent workflow is active.",
    "Current controls:",
    "- Read upcoming and today's appointments from Google Calendar (with CRM fallback)",
    "- Read fixed expense list and monthly total",
    "- Revenue summary, creator overview, insurance stats, CRM summary",
    "- English-only chat responses",
    "Suggested next upgrades for full control:",
    "1) Create/update appointment from Telegram command",
    "2) Customer lookup + follow-up action by name/phone",
    "3) Approval-safe write actions with /confirm flow"
  ].join("\n");

const formatInsuranceStatistics = (stats) =>
  [
    "Insurance statistics:",
    `- Total clients: ${stats.totalClients}`,
    `- Total policies: ${stats.totalPolicies}`,
    `- Active policies: ${stats.activePolicies}`,
    `- Pending claims: ${stats.pendingClaims}`,
    `- Approved claims: ${stats.approvedClaims}`,
    `- Policies expiring in 30 days: ${stats.expiringSoon}`,
    `- Collected payments: ${currency(stats.collectedPayments)}`,
    `- Outstanding balance: ${currency(stats.outstandingBalance)}`
  ].join("\n");

const formatTikTokOverview = (snapshot) =>
  [
    "TikTok agency overview:",
    `- Active creators in CRM: ${snapshot.tiktok.creatorsCount}`,
    `- Partner income total: ${currency(snapshot.totalIncome)}`,
    `- This month revenue: ${currency(snapshot.tiktok.monthlyAgencyRevenue)}`,
    `- Interested creators: ${snapshot.interestedCreators}`,
    `- Message replies: ${snapshot.tiktok.messageStats.replies}`
  ].join("\n");

const formatCrmOverview = (snapshot) =>
  [
    "CRM overview:",
    `- Total profiles: ${snapshot.overview.totalProfiles}`,
    `- Insurance clients: ${snapshot.overview.insuranceClients}`,
    `- TikTok creators: ${snapshot.overview.tiktokCreators}`,
    `- Upcoming appointments: ${snapshot.upcoming.length}`,
    `- Monthly agency revenue: ${currency(snapshot.tiktok.monthlyAgencyRevenue)}`
  ].join("\n");

const getGreetingName = (displayName = "") => {
  const name = String(displayName || "").trim();
  if (!name) return "";
  const first = name.split(/\s+/)[0];
  return first || "";
};

const buildChatReply = (body, options = {}, followUp = "") => {
  const firstName = getGreetingName(options.displayName);
  const greeting = firstName ? `Hello ${firstName}!` : "Hello!";
  return [greeting, body, followUp].filter(Boolean).join("\n");
};

const buildGreetingReply = (displayName = "") => {
  const firstName = getGreetingName(displayName);
  const namePart = firstName ? ` ${firstName}` : "";
  return [
    `${getGreetingByTime()}${namePart}!`,
    "Welcome back.",
    "I am doing well, thank you.",
    "How can I assist you today?"
  ].join("\n");
};

const buildHelpReply = (options = {}) =>
  buildChatReply(
    [
    "You can ask me questions like:",
    "1) Total partner income this month?",
    "2) Which creators generated highest revenue?",
    "3) Insurance stats and pending claims?",
    "4) Any policies expiring soon?",
    "5) Show upcoming appointments.",
    "6) Do I have appointment today?",
    "7) How many ideal creators are there now?",
    "8) Show fixed expense list.",
    "9) Show TikTok partner list.",
    "10) Show insurance client list.",
    "11) Add insurance client.",
    "12) Add policy information.",
    "13) Give a full CRM summary.",
    "",
    "Quick commands: /appointments, /today, /fixed, /summary"
    ].join("\n")
  );

const buildDeterministicReply = async (intent, snapshot, options = {}) => {
  if (intent === "help") {
    return { reply: buildHelpReply(options) };
  }

  if (intent === "partner_income_breakdown") {
    return { reply: buildChatReply(formatPartnerIncomeBreakdown(snapshot.breakdown), options) };
  }

  if (intent === "partner_income_total") {
    return { reply: buildChatReply(formatPartnerIncomeTotal(snapshot.totalIncome), options) };
  }

  if (intent === "fixed_expenses_list") {
    return { reply: buildChatReply(formatFixedExpenses(snapshot.expenses), options) };
  }

  if (intent === "ideal_creators_count") {
    return {
      reply: buildChatReply(
        formatIdealCreatorsCount(snapshot.tiktok.idealCreatorsCount),
        options,
        "Would you like me to list their usernames?"
      ),
      pendingAction: "list_ideal_usernames"
    };
  }

  if (intent === "tiktok_partners_count") {
    return {
      reply: buildChatReply(
        formatTikTokPartnersCount(snapshot.overview.tiktokCreators),
        options,
        "Would you like the partner list too?"
      ),
      pendingAction: "list_tiktok_partners"
    };
  }

  if (intent === "tiktok_partners_list" || intent === "tiktok_partners_overview") {
    const partners = await getTikTokPartners(10);
    return { reply: buildChatReply(formatTikTokPartners(partners), options) };
  }

  if (intent === "insurance_clients_count") {
    return {
      reply: buildChatReply(
        formatInsuranceClientsCount(snapshot.overview.insuranceClients),
        options,
        "Would you like the client list too?"
      ),
      pendingAction: "list_insurance_clients"
    };
  }

  if (intent === "insurance_clients_list" || intent === "insurance_clients_overview") {
    const clients = await getInsuranceClients(10);
    return { reply: buildChatReply(formatInsuranceClients(clients), options) };
  }

  if (intent === "insurance_client_add") {
    return startInsuranceClientOnboarding(options.userText);
  }

  if (intent === "insurance_policy_add") {
    return startInsurancePolicyOnboarding(options.userText);
  }

  if (intent === "interested_creators") {
    return { reply: buildChatReply(formatInterestedCreators(snapshot.interestedCreators), options) };
  }

  if (intent === "appointment_check") {
    return { reply: buildChatReply(formatAppointmentCheck(snapshot), options) };
  }

  if (intent === "today_appointments") {
    return { reply: buildChatReply(formatTodayAppointments(snapshot.todayAppointments, snapshot), options) };
  }

  if (intent === "upcoming_appointments") {
    return { reply: buildChatReply(formatUpcomingAppointments(snapshot.upcoming, snapshot), options) };
  }

  if (intent === "agent_workflow") {
    return { reply: buildChatReply(formatAgentWorkflowCapabilities(), options) };
  }

  if (intent === "insurance_statistics") {
    return { reply: buildChatReply(formatInsuranceStatistics(snapshot.insurance), options) };
  }

  if (intent === "tiktok_overview") {
    return { reply: buildChatReply(formatTikTokOverview(snapshot), options) };
  }

  if (intent === "crm_overview") {
    return { reply: buildChatReply(formatCrmOverview(snapshot), options) };
  }

  return null;
};

const resolvePendingActionReply = async (pendingAction, snapshot, options = {}) => {
  if (pendingAction === "list_ideal_usernames") {
    const usernames = await getIdealCreatorUsernames(20);
    return buildChatReply(formatIdealCreatorUsernames(usernames), options);
  }

  if (pendingAction === "list_tiktok_partners") {
    const partners = await getTikTokPartners(10);
    return buildChatReply(formatTikTokPartners(partners), options);
  }

  if (pendingAction === "list_insurance_clients") {
    const clients = await getInsuranceClients(10);
    return buildChatReply(formatInsuranceClients(clients), options);
  }

  return "";
};

const formatContextDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: TELEGRAM_DISPLAY_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  } catch {
    return dayjs(value).format("YYYY-MM-DD HH:mm");
  }
};

const buildContextText = (snapshot) =>
  JSON.stringify(
    {
      generatedAt: snapshot.generatedAt,
      overview: snapshot.overview,
      tiktok: {
        creatorsCount: snapshot.tiktok.creatorsCount,
        monthlyAgencyRevenue: snapshot.tiktok.monthlyAgencyRevenue,
        messageStats: snapshot.tiktok.messageStats,
        creatorDailySummary: snapshot.tiktok.creatorDailySummary,
        idealCreatorsCount: snapshot.tiktok.idealCreatorsCount,
        topPartnerIncomeCreators: snapshot.breakdown,
        topIdealUsers: snapshot.tiktok.idealUsers
      },
      insurance: {
        totalClients: snapshot.insurance.totalClients,
        totalPolicies: snapshot.insurance.totalPolicies,
        activePolicies: snapshot.insurance.activePolicies,
        pendingClaims: snapshot.insurance.pendingClaims,
        approvedClaims: snapshot.insurance.approvedClaims,
        expiringSoon: snapshot.insurance.expiringSoon,
        collectedPayments: snapshot.insurance.collectedPayments,
        outstandingBalance: snapshot.insurance.outstandingBalance,
        recentClaims: snapshot.insurance.recentClaims
      },
      expenses: snapshot.expenses,
      interestedCreators: snapshot.interestedCreators,
      appointmentSource: snapshot.appointmentSource,
      appointmentSourceNotice: snapshot.appointmentSourceNotice,
      todayAppointments: snapshot.todayAppointments.map((item) => ({
        customer: item.customer,
        phone: item.phone,
        when: formatContextDate(item.when)
      })),
      upcomingAppointments: snapshot.upcoming.map((item) => ({
        customer: item.customer,
        phone: item.phone,
        when: formatContextDate(item.when)
      }))
    },
    null,
    2
  );

const buildConversationContextText = (state = {}) => {
  const normalized = sanitizeConversationState(state);
  if (!normalized.lastUserText && !normalized.lastAssistantText) return "";

  return [
    "Recent conversation memory:",
    normalized.lastIntent ? `- Last intent: ${normalized.lastIntent}` : "",
    normalized.pendingAction ? `- Pending action: ${normalized.pendingAction}` : "",
    normalized.lastUserText ? `- Previous user message: ${normalized.lastUserText}` : "",
    normalized.lastAssistantText ? `- Previous assistant reply: ${normalized.lastAssistantText}` : ""
  ]
    .filter(Boolean)
    .join("\n");
};

const HUMAM_SYSTEM_PROMPT =
  "You are Humam, a professional, friendly, human-like relationship manager for a combined Insurance CRM and TikTok Agency CRM. " +
  "Always reply in English only. Keep responses natural, confident, and practical, usually within 3-7 sentences unless asked for detail. " +
  "Use only the provided CRM snapshot for data claims. Never invent numbers, names, dates, or statuses. " +
  "If required data is missing, state that clearly and ask one focused follow-up question. " +
  "For greetings, respond warmly and briefly. For business questions, provide direct answer first, then short actionable guidance. " +
  "Sound like a skilled human account manager, not a robotic bot.";

const buildLlmReply = async (userText, snapshot, options = {}) => {
  if (!isOpenAiConfigured()) {
    return ["OpenAI is not configured. I can still share deterministic CRM stats.", formatCrmOverview(snapshot)].join("\n\n");
  }

  const displayName = String(options.displayName || "").trim() || "Customer";
  const conversationMemory = buildConversationContextText(options.conversationState);
  const promptSections = [
    `User display name: ${displayName}`,
    `User message: ${userText}`,
    conversationMemory,
    "Authoritative CRM snapshot (JSON):",
    buildContextText(snapshot),
    "Instruction: answer the user now."
  ].filter(Boolean);
  const userPrompt = promptSections.join("\n\n");

  const answer = await chatWithOpenAi({
    systemPrompt: HUMAM_SYSTEM_PROMPT,
    userPrompt,
    temperature: 0.35
  });

  return answer || "I could not generate a response right now.";
};

const generateTelegramAssistantTurn = async (userText, options = {}) => {
  const priorState = sanitizeConversationState(options.conversationState);
  const trimmedUserText = String(userText || "").trim();
  const finalize = (reply, currentIntent, pendingAction = "") => ({
    reply,
    conversationState: {
      lastIntent: currentIntent || "",
      pendingAction: pendingAction || "",
      lastUserText: trimmedUserText,
      lastAssistantText: String(reply || "").trim(),
      updatedAt: new Date().toISOString()
    }
  });

  if (isGreetingMessage(trimmedUserText)) {
    return finalize(buildGreetingReply(options.displayName), "greeting");
  }

  if (isHelpRequest(trimmedUserText)) {
    return finalize(buildHelpReply(options), "help");
  }

  const insuranceClientDraft = decodeInsuranceClientPendingState(priorState.pendingAction);
  if (insuranceClientDraft) {
    const onboardingTurn = await resolveInsuranceClientOnboardingTurn(trimmedUserText, insuranceClientDraft);
    return finalize(onboardingTurn.reply, "insurance_client_add", onboardingTurn.pendingAction || "");
  }

  const insurancePolicyDraft = decodeInsurancePolicyPendingState(priorState.pendingAction);
  if (insurancePolicyDraft) {
    const onboardingTurn = await resolveInsurancePolicyOnboardingTurn(trimmedUserText, insurancePolicyDraft);
    return finalize(onboardingTurn.reply, "insurance_policy_add", onboardingTurn.pendingAction || "");
  }

  const snapshot = await buildMetricsSnapshot({ connectionKey: options.connectionKey });

  if (priorState.pendingAction && isAffirmativeMessage(trimmedUserText)) {
    const followUpReply = await resolvePendingActionReply(priorState.pendingAction, snapshot, options);
    if (followUpReply) {
      return finalize(followUpReply, "follow_up", "");
    }
  }

  if (priorState.pendingAction && isNegativeMessage(trimmedUserText)) {
    return finalize(buildChatReply("No problem. Let me know what you need next.", options), "follow_up", "");
  }

  const intent = identifyIntent(trimmedUserText);
  const deterministic = await buildDeterministicReply(intent, snapshot, {
    ...options,
    userText: trimmedUserText
  });
  if (deterministic?.reply) {
    return finalize(deterministic.reply, intent, deterministic.pendingAction || "");
  }

  try {
    const llmReply = await buildLlmReply(trimmedUserText, snapshot, options);
    return finalize(llmReply, intent || "general");
  } catch (error) {
    return finalize(
      [
        "I could not generate the full AI answer right now.",
        `Reason: ${error.message || "Unknown error"}`,
        "",
        formatCrmOverview(snapshot)
      ].join("\n"),
      intent || "general"
    );
  }
};

const generateTelegramAssistantReply = async (userText, options = {}) => {
  const turn = await generateTelegramAssistantTurn(userText, options);
  return turn.reply;
};

module.exports = {
  generateTelegramAssistantTurn,
  generateTelegramAssistantReply,
  buildMetricsSnapshot,
  identifyIntent
};
