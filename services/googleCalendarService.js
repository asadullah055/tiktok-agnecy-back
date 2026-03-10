const GoogleCalendarConnection = require("../models/GoogleCalendarConnection");

const GOOGLE_OAUTH_SCOPE = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly"
].join(" ");

const toNumberOr = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const encodeState = (payload) => Buffer.from(JSON.stringify(payload)).toString("base64url");

const decodeState = (value) => {
  try {
    const json = Buffer.from(String(value || ""), "base64url").toString("utf8");
    return JSON.parse(json);
  } catch {
    return {};
  }
};

const getGoogleEnv = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google Calendar is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALENDAR_REDIRECT_URI");
  }

  return { clientId, clientSecret, redirectUri };
};

const resolveFrontendBaseUrl = () => {
  const explicit = String(process.env.FRONTEND_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercelUrl = String(process.env.VERCEL_URL || "").trim();
  if (vercelUrl) return `https://${vercelUrl.replace(/\/+$/, "")}`;

  return "http://localhost:5173";
};

const getFrontendAppointmentsUrl = () => `${resolveFrontendBaseUrl()}/insurance/appointments`;

const postGoogleToken = async (params) => {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Failed to complete Google OAuth token request");
  }

  return data;
};

const parseEmailFromIdToken = (idToken) => {
  try {
    const [, payload] = String(idToken || "").split(".");
    if (!payload) return "";
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return parsed.email || "";
  } catch {
    return "";
  }
};

const fetchGoogleUserEmail = async (accessToken) => {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    return "";
  }

  const data = await response.json();
  return data.email || "";
};

const copyConnectionPayload = (connection = {}, overrides = {}) => ({
  googleAccountEmail: connection.googleAccountEmail || undefined,
  accessToken: connection.accessToken || undefined,
  refreshToken: connection.refreshToken || undefined,
  tokenType: connection.tokenType || undefined,
  scope: connection.scope || undefined,
  expiresAt: connection.expiresAt || undefined,
  ...overrides
});

const resolveConnectionForKey = async (connectionKey) => {
  const key = String(connectionKey || "").trim();
  if (!key) {
    return { connection: null, fromFallback: false };
  }

  const exact = await GoogleCalendarConnection.findOne({ connectionKey: key });
  if (exact) {
    return { connection: exact, fromFallback: false };
  }

  // Legacy recovery: alias the most recently active Google Calendar connection
  // to requested workspace key so workspaceKey-based flows continue to work.
  const candidates = await GoogleCalendarConnection.find({ accessToken: { $exists: true, $ne: "" } })
    .sort({ updatedAt: -1 })
    .limit(1);

  if (!candidates.length) {
    return { connection: null, fromFallback: false };
  }

  const source = candidates[0];
  const aliased = await GoogleCalendarConnection.findOneAndUpdate(
    { connectionKey: key },
    { $set: copyConnectionPayload(source) },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return { connection: aliased, fromFallback: true };
};

const refreshGoogleAccessToken = async (connection) => {
  if (!connection?.refreshToken) {
    throw new Error("Google Calendar token expired and refresh token is missing. Reconnect Google Calendar.");
  }

  const { clientId, clientSecret } = getGoogleEnv();

  const tokenData = await postGoogleToken({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: connection.refreshToken,
    grant_type: "refresh_token"
  });

  connection.accessToken = tokenData.access_token;
  connection.tokenType = tokenData.token_type || connection.tokenType;
  connection.scope = tokenData.scope || connection.scope;
  connection.expiresAt = tokenData.expires_in ? new Date(Date.now() + toNumberOr(tokenData.expires_in, 3600) * 1000) : connection.expiresAt;
  await connection.save();

  return connection.accessToken;
};

const getValidAccessToken = async (connection) => {
  if (!connection?.accessToken) {
    throw new Error("Google Calendar is not connected for this user.");
  }

  const now = Date.now();
  const expiresAt = connection.expiresAt ? new Date(connection.expiresAt).getTime() : 0;
  const isExpiredOrNearExpiry = expiresAt && expiresAt - now < 60 * 1000;

  if (isExpiredOrNearExpiry) {
    return refreshGoogleAccessToken(connection);
  }

  return connection.accessToken;
};

const normalizeGoogleEvent = (event) => ({
  id: event.id,
  source: "google_calendar",
  status: event.status === "cancelled" ? "cancelled" : "scheduled",
  scheduledFor: event.start?.dateTime || event.start?.date || null,
  profile: {
    name: event.summary || "(No title)",
    phone: "-"
  },
  notes: event.description || event.location || "",
  googleEventId: event.id
});

const isBookedGoogleAppointment = (event) => {
  const eventType = String(event?.eventType || "default").toLowerCase();
  const status = String(event?.status || "confirmed").toLowerCase();
  const hasDateTime = Boolean(event?.start?.dateTime);

  return eventType === "default" && status === "confirmed" && hasDateTime;
};

const buildGoogleCalendarAuthUrl = (connectionKey) => {
  if (!connectionKey) {
    throw new Error("connectionKey is required");
  }

  const { clientId, redirectUri } = getGoogleEnv();
  const state = encodeState({ connectionKey: String(connectionKey).trim(), ts: Date.now() });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

const upsertGoogleCalendarConnectionFromCode = async ({ code, state }) => {
  const parsedState = decodeState(state);
  const connectionKey = String(parsedState.connectionKey || "").trim();

  if (!connectionKey) {
    throw new Error("Invalid Google OAuth state");
  }

  const { clientId, clientSecret, redirectUri } = getGoogleEnv();

  const tokenData = await postGoogleToken({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  });

  const googleAccountEmail = parseEmailFromIdToken(tokenData.id_token) || (await fetchGoogleUserEmail(tokenData.access_token));

  const update = {
    connectionKey,
    googleAccountEmail: googleAccountEmail || undefined,
    accessToken: tokenData.access_token,
    tokenType: tokenData.token_type,
    scope: tokenData.scope,
    expiresAt: tokenData.expires_in ? new Date(Date.now() + toNumberOr(tokenData.expires_in, 3600) * 1000) : undefined
  };

  if (tokenData.refresh_token) {
    update.refreshToken = tokenData.refresh_token;
  }

  const connection = await GoogleCalendarConnection.findOneAndUpdate(
    { connectionKey },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return connection;
};

const getGoogleCalendarConnectionStatus = async (connectionKey) => {
  const key = String(connectionKey || "").trim();
  if (!key) {
    return { connected: false };
  }

  const { connection } = await resolveConnectionForKey(key);
  if (!connection?.accessToken) {
    return { connected: false };
  }

  return {
    connected: true,
    googleAccountEmail: connection.googleAccountEmail || "",
    expiresAt: connection.expiresAt || null
  };
};

const listGoogleCalendarAppointments = async ({ connectionKey, today = false, maxResults = 250, bookedOnly = true }) => {
  const key = String(connectionKey || "").trim();
  if (!key) {
    throw new Error("connectionKey is required");
  }

  const { connection } = await resolveConnectionForKey(key);
  if (!connection) {
    throw new Error("Google Calendar is not connected for this user.");
  }

  const accessToken = await getValidAccessToken(connection);
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    showDeleted: "false",
    maxResults: String(toNumberOr(maxResults, 250))
  });

  params.set("timeMin", (today ? startOfDay : now).toISOString());
  if (today) {
    params.set("timeMax", endOfDay.toISOString());
  }

  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "Failed to fetch Google Calendar events");
  }

  const items = Array.isArray(data.items) ? data.items : [];
  const filteredItems = bookedOnly === false || String(bookedOnly).toLowerCase() === "false"
    ? items
    : items.filter(isBookedGoogleAppointment);
  return filteredItems.map(normalizeGoogleEvent);
};

const disconnectGoogleCalendar = async (connectionKey) => {
  const key = String(connectionKey || "").trim();
  if (!key) return { success: true };

  await GoogleCalendarConnection.deleteOne({ connectionKey: key });
  return { success: true };
};

module.exports = {
  buildGoogleCalendarAuthUrl,
  getFrontendAppointmentsUrl,
  upsertGoogleCalendarConnectionFromCode,
  getGoogleCalendarConnectionStatus,
  listGoogleCalendarAppointments,
  disconnectGoogleCalendar
};
