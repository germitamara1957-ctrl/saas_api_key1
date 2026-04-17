import { Router, type IRouter, type Request, type Response } from "express";
import { getSupportedModels } from "../../lib/billing";
import { requireApiKeyLight } from "../../middlewares/apiKeyAuth";

const router: IRouter = Router();

export type ModelCategory = "chat" | "image" | "video" | "audio" | "embedding";
const VALID_CATEGORIES: ReadonlySet<string> = new Set(["chat", "image", "video", "audio", "embedding"]);

function ownedBy(modelId: string): string {
  if (modelId.startsWith("gemini-") || modelId.startsWith("imagen-") || modelId.startsWith("veo-") || modelId.startsWith("gemma-")) return "google";
  if (modelId.startsWith("sora-") || modelId.startsWith("gpt-") || modelId.startsWith("dall-e") || modelId.startsWith("gpt-image") || modelId.startsWith("whisper-") || modelId.startsWith("text-embedding-") || modelId.startsWith("tts-")) return "openai";
  if (modelId.startsWith("grok-")) return "xai";
  if (modelId.startsWith("mistral-") || modelId.startsWith("ministral-") || modelId.startsWith("codestral") || modelId.startsWith("jamba-")) return "mistral-ai";
  if (modelId.startsWith("deepseek-")) return "deepseek";
  if (modelId.startsWith("glm-")) return "zhipu-ai";
  if (modelId.startsWith("kimi-")) return "moonshot-ai";
  if (modelId.startsWith("minimax-")) return "minimax";
  if (modelId.startsWith("llama-")) return "meta";
  if (modelId.startsWith("gpt-oss-")) return "openai-oss";
  if (modelId.startsWith("qwen")) return "alibaba";
  return "ai-gateway";
}

/**
 * Categorize a model ID into one of: chat | image | video | audio | embedding.
 * Used to filter /v1/models by capability so n8n (and similar tools) can show
 * only the models relevant to a specific node (chat/image/video/audio).
 */
export function categorizeModel(modelId: string): ModelCategory {
  const m = modelId.toLowerCase();
  // Video — Veo backends + Sora-compatible aliases
  if (m.startsWith("veo-") || m.startsWith("sora-")) return "video";
  // Image — Imagen, DALL-E, gpt-image, plus Gemini *-image-preview models
  if (
    m.startsWith("imagen-") ||
    m.startsWith("dall-e") ||
    m.startsWith("gpt-image") ||
    m.endsWith("-image-preview")
  ) return "image";
  // Audio — TTS + STT
  if (m.startsWith("tts-") || m.startsWith("whisper-")) return "audio";
  // Embeddings
  if (m.startsWith("text-embedding-") || m.includes("-embedding-")) return "embedding";
  // Default: chat / completion
  return "chat";
}

function buildModelList(category?: ModelCategory) {
  const models = getSupportedModels()
    .filter((id) => !category || categorizeModel(id) === category)
    .sort((a, b) => a.localeCompare(b));
  return {
    object: "list",
    data: models.map((id) => ({
      id,
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: ownedBy(id),
    })),
  };
}

/**
 * Shared handler for `/v1/models` and `/models` aliases.
 * Supports `?type=chat|image|video|audio|embedding` for filtering.
 * Invalid `type` → 400 (so the user knows their typo, instead of an empty list).
 */
function handleListModels(req: Request, res: Response): void {
  const rawTypeQuery = req.query.type;
  // No `type` param at all → return all models.
  if (rawTypeQuery === undefined) {
    res.json(buildModelList());
    return;
  }
  // Reject array forms (e.g. ?type=chat&type=image) and non-strings outright.
  if (typeof rawTypeQuery !== "string") {
    res.status(400).json({
      error: {
        message: "Invalid type. Provide a single value: chat, image, video, audio, or embedding.",
        type: "invalid_request_error",
        code: "invalid_query_parameter",
        param: "type",
      },
    });
    return;
  }
  const rawType = rawTypeQuery.trim().toLowerCase();
  // Reject empty string and unknown values.
  if (!VALID_CATEGORIES.has(rawType)) {
    res.status(400).json({
      error: {
        message: `Invalid type "${rawType}". Must be one of: chat, image, video, audio, embedding.`,
        type: "invalid_request_error",
        code: "invalid_query_parameter",
        param: "type",
      },
    });
    return;
  }
  res.json(buildModelList(rawType as ModelCategory));
}

// Primary endpoint — /v1/models  (also /models alias for clients that omit /v1)
router.get("/v1/models", requireApiKeyLight, handleListModels);
router.get("/models", requireApiKeyLight, handleListModels);

/**
 * Category-specific endpoints — for tools that need a stable Base URL per
 * model type (e.g. n8n's separate Chat / Image / Video / Audio nodes).
 * Each one returns the same shape as /v1/models, pre-filtered.
 *
 * Aliases without /v1 are provided for clients that set Base URL = root.
 */
const CATEGORY_PATHS: Array<{ path: string; category: ModelCategory }> = [
  { path: "/v1/chat/models",       category: "chat" },
  { path: "/v1/images/models",     category: "image" },
  { path: "/v1/videos/models",     category: "video" },
  { path: "/v1/audio/models",      category: "audio" },
  { path: "/v1/embeddings/models", category: "embedding" },
  // No-/v1 aliases
  { path: "/chat/models",       category: "chat" },
  { path: "/images/models",     category: "image" },
  { path: "/videos/models",     category: "video" },
  { path: "/audio/models",      category: "audio" },
  { path: "/embeddings/models", category: "embedding" },
];
for (const { path, category } of CATEGORY_PATHS) {
  router.get(path, requireApiKeyLight, (_req, res): void => {
    res.json(buildModelList(category));
  });
}

// Single model lookup — /v1/models/:model
router.get("/v1/models/:model", requireApiKeyLight, (req, res): void => {
  const modelId = String(req.params.model);
  const supported = getSupportedModels();
  if (!supported.includes(modelId)) {
    res.status(404).json({ error: { message: `The model '${modelId}' does not exist`, type: "invalid_request_error", code: "model_not_found" } });
    return;
  }
  res.json({
    id: modelId,
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: ownedBy(modelId),
    category: categorizeModel(modelId),
  });
});

export default router;
