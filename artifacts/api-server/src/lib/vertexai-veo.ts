import { type VideoJobResult, type VideoJobStatus } from "./vertexai-types";
import { resolveVertexModelId } from "./vertexai-types";
import { getActiveProvider, getAccessToken } from "./vertexai-provider";

export async function generateVideoWithVeo(
  model: string,
  prompt: string,
  durationSeconds = 5,
  sampleCount = 1,
): Promise<VideoJobResult> {
  const provider = await getActiveProvider();
  const token = await getAccessToken(provider);

  const { projectId, location } = provider;
  const vertexModel = resolveVertexModelId(model);

  // Correct endpoint: :predictLongRunning (not :generateVideo)
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${vertexModel}:predictLongRunning`;

  // Correct request body format per Vertex AI Veo documentation
  const body = {
    instances: [{ prompt }],
    parameters: {
      sampleCount,
      durationSeconds,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Veo API error: ${response.status} ${err}`);
  }

  const data = (await response.json()) as { name?: string };
  return { operationName: data.name ?? "" };
}

export async function getVideoJobStatus(operationName: string): Promise<VideoJobStatus> {
  const provider = await getActiveProvider();
  const token = await getAccessToken(provider);

  const { projectId, location } = provider;

  // Extract the model name from the operation name
  // Format: projects/{projectId}/locations/{location}/publishers/google/models/{model}/operations/{opId}
  const modelMatch = operationName.match(/\/models\/([^/]+)\//);
  const vertexModel = modelMatch?.[1];

  if (!vertexModel) {
    throw new Error(`Cannot extract model name from operation: ${operationName}`);
  }

  // Correct polling endpoint: :fetchPredictOperation (POST, not GET)
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${vertexModel}:fetchPredictOperation`;

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ operationName }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to get job status: ${response.status} ${err}`);
  }

  const data = (await response.json()) as {
    done?: boolean;
    response?: {
      videos?: Array<{
        uri?: string;
        gcsUri?: string;
        bytesBase64Encoded?: string;
        encoding?: string;
        mimeType?: string;
      }>;
      generatedSamples?: Array<{
        video?: { uri?: string; gcsUri?: string; bytesBase64Encoded?: string };
      }>;
      generateVideoResponse?: {
        generatedSamples?: Array<{
          video?: { uri?: string; gcsUri?: string; bytesBase64Encoded?: string };
        }>;
      };
    };
    error?: { message?: string };
  };

  if (data.error) {
    return { done: true, error: data.error.message };
  }

  if (data.done) {
    // Veo returns the video URL under one of several fields depending on the
    // model version + storage mode. Check all known shapes before giving up.
    const v0 = data.response?.videos?.[0];
    const s0 = data.response?.generatedSamples?.[0]?.video;
    const g0 = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video;

    const videoUri =
      v0?.uri ?? v0?.gcsUri ??
      s0?.uri ?? s0?.gcsUri ??
      g0?.uri ?? g0?.gcsUri;

    // If the video came back inline as base64 rather than a URI, surface it
    // to the caller as a data URL so clients can still render it.
    const inlineB64 =
      v0?.bytesBase64Encoded ??
      s0?.bytesBase64Encoded ??
      g0?.bytesBase64Encoded;
    if (!videoUri && inlineB64) {
      const mime = v0?.mimeType ?? "video/mp4";
      return { done: true, videoUri: `data:${mime};base64,${inlineB64}` };
    }

    if (!videoUri) {
      // Log the raw payload so we can understand what Veo returned.
      console.error("[veo] job done but no video URI found in response:",
        JSON.stringify(data.response));
      return {
        done: true,
        error: "Video generation finished, but no URI was returned by Vertex AI. " +
          "This usually means safety filters blocked the output, or the response " +
          "schema changed. Contact support with jobId for details.",
      };
    }
    return { done: true, videoUri };
  }

  return { done: false };
}
