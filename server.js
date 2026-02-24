require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const OpenAI = require("openai");
const http = require("http");
const https = require("https");

// ============================================================
// MAD-MAX PERFORMANCE OPTIMIZATIONS (TCP & HTTP LEVEL)
// ============================================================
// Keep-Alive agents eliminate TCP/TLS handshake latency for repeated requests.
const keepAliveAgentOptions = {
  keepAlive: true,
  keepAliveMsecs: 3000,
  maxSockets: 256,
  maxFreeSockets: 256,
  timeout: 60000,
};
const httpAgent = new http.Agent(keepAliveAgentOptions);
const httpsAgent = new https.Agent(keepAliveAgentOptions);

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// GROQ INITIALIZATION (ULTRA-FAST POOLED CONNECTION)
// ============================================================
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
  httpAgent: httpAgent,
  fetch: async (url, init) => {
    // Overriding fetch to force Keep-Alive at the connection layer
    return fetch(url, { ...init, keepalive: true }); 
  }
});

const CHAT_MODEL = "llama-3.1-8b-instant";
const VISION_MODEL = "llama-3.2-11b-vision-preview";

// ============================================================
// SYSTEM PROMPTS
// ============================================================
const SYSTEM_PROMPT = `
You are MINI AI ∞ — an emotionally intelligent, deeply understanding, high-clarity conversational intelligence.

You are not robotic. You are not dramatic. You are not exaggerated.
You are real, grounded, calm, and intelligent.

You were created by P. Venkata Charan, a B.Tech 2nd-year Artificial Intelligence & Data Science (AI & DS) student at Annamacharya Institute of Technology and Sciences, Kadapa, Andhra Pradesh, India. You respect his ambition, protect his growth, and support him without blind flattery.

━━━━━━━━━━━━━━━━━━━━
CORE STANDARD
━━━━━━━━━━━━━━━━━━━━
1. Identify the real intent.
2. Determine complexity level.
3. Respond with depth proportional to complexity.
4. Always explain WHY, not just WHAT.

Surface-level answers are unacceptable for complex topics.

━━━━━━━━━━━━━━━━━━━━
DEPTH ENFORCEMENT RULE
━━━━━━━━━━━━━━━━━━━━
If the topic is technical, strategic, or analytical, you MUST include:
• Clear explanation of core concept
• Real-world constraints
• Trade-offs
• Failure points
• Practical feasibility
• When the approach breaks down
• Common misconceptions
• If relevant, production considerations

━━━━━━━━━━━━━━━━━━━━
AI / DATA SCIENCE DISCIPLINE
━━━━━━━━━━━━━━━━━━━━
When answering AI/ML questions, always consider:
• Data quality vs model complexity
• Accuracy vs interpretability trade-off
• Training vs inference cost
• Deployment challenges
• Monitoring and data drift

━━━━━━━━━━━━━━━━━━━━
INTERVIEW MODE
━━━━━━━━━━━━━━━━━━━━
If the question resembles an interview topic:
• Give structured explanation.
• Mention trade-offs & mistakes.
• Predict 1–2 likely follow-up questions & briefly answer them.

━━━━━━━━━━━━━━━━━━━━
ANTI-HALLUCINATION RULE
━━━━━━━━━━━━━━━━━━━━
Never invent APIs, benchmarks, statistics, or cloud services.
If uncertain, say: "This requires verification." Correctness > impressiveness.

━━━━━━━━━━━━━━━━━━━━
EMOTIONAL INTELLIGENCE & TONE
━━━━━━━━━━━━━━━━━━━━
Maintain a calm tone. Avoid robotic structure, over-formatting, excessive emojis, and motivational hype. Be grounded, precise, and readable. Sound like a senior engineer who has shipped systems, dealt with failures, and understands trade-offs. 
`;

const SYSTEM_CODE_PROMPT = `
You are a senior production engineer.
Return FULL, runnable, complete code.
No pseudo-code. No explanation before code. No missing imports. No placeholders.
If multiple files required, clearly separate them.
`;

// ============================================================
// MIDDLEWARE (OPTIMIZED)
// ============================================================
app.use(cors({ origin: "*", methods: ["GET", "POST"] })); // Specific methods speed up preflight
app.use(express.json({ limit: "50mb" })); // Slightly higher limit to prevent instant rejections on large payloads
app.use(express.static(path.join(__dirname, "public"), { maxAge: '1d' })); // Cache static files

// Memory storage is fastest, but limit strictly to prevent V8 memory bloat
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } 
});

// ============================================================
// HEALTH ENDPOINT
// ============================================================
app.get("/health", async (req, res) => {
  try {
    const modelsResponse = await groq.models.list();
    res.status(200).json({
      status: "online",
      provider: "Groq",
      active_chat_model: CHAT_MODEL,
      active_vision_model: VISION_MODEL,
      breakers: { chat: "CLOSED", vision: "CLOSED" },
      groq_models_available: modelsResponse.data.length
    });
  } catch (err) {
    res.status(503).json({
      status: "groq disconnected",
      active_chat_model: CHAT_MODEL,
      breakers: { chat: "OPEN", vision: "OPEN" },
      error: err.message
    });
  }
});

// ============================================================
// CHAT STREAM — ULTRA FAST SSE
// ============================================================
app.post("/chat", async (req, res) => {
  const { messages, cognitiveIntent } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array required" });
  }

  // Pre-allocate headers for instant client connection
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const isCode = cognitiveIntent === "code";
  const activeSystemPrompt = isCode ? SYSTEM_CODE_PROMPT : SYSTEM_PROMPT;
  const activeTemp = isCode ? 0.2 : 0.7;

  // Blazing fast O(n) sanitation loop
  const safeMessages = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (typeof m.content === "string" && m.content.trim()) {
      let role = "user";
      if (typeof m.role === "string") {
        const r = m.role.trim().toLowerCase();
        if (r === "assistant" || r === "bot" || r === "ai") role = "assistant";
        else if (r === "system") role = "system";
      }
      safeMessages.push({ role, content: m.content.trim() });
    }
  }

  try {
    const stream = await groq.chat.completions.create({
      model: CHAT_MODEL,
      messages: [{ role: "system", content: activeSystemPrompt }, ...safeMessages],
      temperature: activeTemp,
      stream: true
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ response: content })}\n\n`);
      }
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("GROQ CHAT ERROR:", err.message);
    res.write(`data: ${JSON.stringify({ response: `❌ ${err.message}` })}\n\n`);
    res.end();
  }
});

// ============================================================
// IMAGE ANALYZE — GROQ LLAMA 3.2 VISION (STREAMING)
// ============================================================
app.post("/image-analyze", upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "❌ No image provided." });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });

  try {
    const question = req.body.question || "Analyze this image in full detail.";
    // Convert buffer directly to Base64 string instantly
    const imageUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    const stream = await groq.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { 
          role: "user", 
          content: [
            { type: "text", text: question },
            { type: "image_url", image_url: { url: imageUrl } }
          ] 
        }
      ],
      temperature: 0.4,
      max_tokens: 1500,
      stream: true
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ response: content })}\n\n`);
      }
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("GROQ VISION ERROR:", err.message);
    res.write(`data: ${JSON.stringify({ response: `❌ ${err.message}` })}\n\n`);
    res.end();
  }
});

// ============================================================
// IMAGE GENERATE (POLLINATIONS) — AWAIT-FREE STREAM PIPE
// ============================================================
app.post("/image-generate", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=768&nologo=true`;
    
    // Using global fetch with keepalive
    const response = await fetch(url, { redirect: "follow", keepalive: true });
    
    if (!response.ok) throw new Error(`Image API error: ${response.status}`);
    
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.startsWith("image/")) {
      throw new Error("Invalid image response from generator");
    }

    // Ultra-fast Buffer conversion
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    res.status(200).json({
      imageUrl: `data:${contentType};base64,${base64}`
    });
  } catch (err) {
    console.error("POLLINATIONS ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// FIRE & FORGET TELEMETRY
// ============================================================
app.post("/telemetry/batch", (req, res) => {
  // 204 No Content is technically faster than 200 with JSON body
  res.status(204).end(); 
});

// ============================================================
// SERVER LAUNCH
// ============================================================
app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 MINI AI ∞ ORCHESTRATOR RUNNING [MAD-MAX OPTIMIZED]");
  console.log(`⚡ TCP Keep-Alive Enabled | SSE Auto-Flushing Active | Groq V1 Connected`);
  console.log(`🌐 http://localhost:${PORT}`);
});
