const getOpenAiApiKey = () => String(process.env.OPENAI_API_KEY || "").trim();

const getChatModel = () => String(process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini").trim();
const getTranscriptionModel = () => String(process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1").trim();

const isOpenAiConfigured = () => Boolean(getOpenAiApiKey());

const callOpenAiJson = async (path, payload) => {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await fetch(`https://api.openai.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenAI request failed");
  }

  return data;
};

const chatWithOpenAi = async ({ systemPrompt, userPrompt, temperature = 0.2 }) => {
  const data = await callOpenAiJson("chat/completions", {
    model: getChatModel(),
    temperature,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  });

  return String(data?.choices?.[0]?.message?.content || "").trim();
};

const transcribeAudio = async ({ audioBuffer, filename = "voice.ogg", mimeType = "audio/ogg" }) => {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  if (!audioBuffer) {
    throw new Error("audioBuffer is required");
  }

  const form = new FormData();
  form.append("model", getTranscriptionModel());
  form.append("file", new Blob([audioBuffer], { type: mimeType }), filename);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenAI transcription failed");
  }

  return String(data?.text || "").trim();
};

module.exports = {
  isOpenAiConfigured,
  chatWithOpenAi,
  transcribeAudio
};
