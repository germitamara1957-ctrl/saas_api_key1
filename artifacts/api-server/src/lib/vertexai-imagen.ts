import { type ImageResult } from "./vertexai-types";
import { resolveVertexModelId } from "./vertexai-types";
import { getActiveProvider, getAccessToken } from "./vertexai-provider";

export async function generateImageWithImagen(
  model: string,
  prompt: string,
  sampleCount = 1,
): Promise<ImageResult> {
  const provider = await getActiveProvider();
  const token = await getAccessToken(provider);

  const { projectId, location } = provider;
  const vertexModel = resolveVertexModelId(model);
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${vertexModel}:predict`;

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount } }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Imagen API error: ${response.status} ${err}`);
  }

  const data = (await response.json()) as {
    predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
  };

  return {
    images: (data.predictions ?? []).map((p) => ({
      base64: p.bytesBase64Encoded ?? "",
      mimeType: p.mimeType ?? "image/png",
    })),
  };
}
