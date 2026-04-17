import { Router, type IRouter } from "express";
import { getSupportedModels } from "../../lib/billing";
import { requireApiKeyLight } from "../../middlewares/apiKeyAuth";

const router: IRouter = Router();

function ownedBy(modelId: string): string {
  if (modelId.startsWith("gemini-") || modelId.startsWith("imagen-") || modelId.startsWith("veo-") || modelId.startsWith("gemma-")) return "google";
  if (modelId.startsWith("sora-") || modelId.startsWith("gpt-") || modelId.startsWith("dall-e") || modelId.startsWith("whisper-") || modelId.startsWith("text-embedding-")) return "openai";
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

function buildModelList() {
  const models = getSupportedModels().sort((a, b) => a.localeCompare(b));
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

// Primary endpoint — /v1/models
router.get("/v1/models", requireApiKeyLight, (_req, res): void => {
  res.json(buildModelList());
});

// Alias — /models — for clients that set base URL without /v1
// (e.g. n8n with Base URL = https://fullapikey.replit.app)
router.get("/models", requireApiKeyLight, (_req, res): void => {
  res.json(buildModelList());
});

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
  });
});

export default router;
