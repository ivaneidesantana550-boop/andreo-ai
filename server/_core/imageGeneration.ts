/**
 * Image generation helper using internal ImageService
 *
 * Example usage:
 *   const { url: imageUrl } = await generateImage({
 *     prompt: "A serene landscape with mountains"
 *   });
 *
 * For editing:
 *   const { url: imageUrl } = await generateImage({
 *     prompt: "Add a rainbow to this landscape",
 *     originalImages: [{
 *       url: "https://example.com/original.jpg",
 *       mimeType: "image/jpeg"
 *     }]
 *   });
 */
import { storagePut } from "../storage";
import { ENV } from "./env";

// Default model for generated sites. "MODEL_GPT_IMAGE_2" is the forge images.v1
// enum for GPT Image 2 (id: gpt-image-2). If omitted, forge falls back to Gemini 2.5 Flash.
const DEFAULT_IMAGE_MODEL = "MODEL_GPT_IMAGE_2";
const DEFAULT_IMAGE_QUALITY = "medium";

export type GenerateImageOptions = {
  prompt: string;
  originalImages?: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
  /** Forge image model enum, e.g. "MODEL_GPT_IMAGE_2". Defaults to GPT Image 2. */
  model?: string;
  /** Generation quality, e.g. "medium" | "high". Defaults to "medium" for GPT Image 2. */
  quality?: string;
};

export type GenerateImageResponse = {
  url?: string;
};

async function generateImageWithXkiro(options: GenerateImageOptions, apiKey: string): Promise<GenerateImageResponse> {
  const baseUrl = (process.env.XKIRO_API_BASE?.trim() || "https://api.xkiro.com/v1").replace(/\/$/, "");
  const model = options.model || process.env.XKIRO_IMAGE_MODEL?.trim() || "openai/gpt-image-2.5";
  const createResponse = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, prompt: options.prompt, n: 1, size: "1024x1024" }),
  });
  const created = await createResponse.json().catch(() => ({})) as { id?: string; error?: { message?: string } | string };
  if (!createResponse.ok || !created.id) throw new Error(`Xkiro image request failed (${createResponse.status}): ${typeof created.error === "string" ? created.error : created.error?.message || "job was not created"}`);

  const deadline = Date.now() + 5 * 60_000;
  let waitMs = 2_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, waitMs));
    waitMs = Math.min(Math.round(waitMs * 1.5), 10_000);
    const statusResponse = await fetch(`${baseUrl}/images/generations/${encodeURIComponent(created.id)}`, { headers: { accept: "application/json", authorization: `Bearer ${apiKey}` } });
    const job = await statusResponse.json().catch(() => ({})) as { status?: string; data?: Array<{ url?: string }>; error?: { message?: string } | string };
    if (job.status === "succeeded" && job.data?.[0]?.url) return { url: job.data[0].url };
    if (job.status === "failed" || job.status === "blocked") throw new Error(`Xkiro image job ${job.status}: ${typeof job.error === "string" ? job.error : job.error?.message || "generation failed"}`);
  }
  throw new Error("Xkiro image generation timed out");
}

export async function generateImage(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  const xKiroKey = (process.env.XKIRO_IMAGE_API_KEY || process.env.XKIRO_API_KEY || "").trim();
  if (xKiroKey) return generateImageWithXkiro(options, xKiroKey);

  if (!ENV.forgeApiUrl) {
    throw new Error("MANUS_API_URL is not configured");
  }
  if (!ENV.forgeApiKey) {
    throw new Error("MANUS_API_KEY is not configured");
  }

  // Build the full URL by appending the service path to the base URL
  const baseUrl = ENV.forgeApiUrl.endsWith("/")
    ? ENV.forgeApiUrl
    : `${ENV.forgeApiUrl}/`;
  const fullUrl = new URL(
    "images.v1.ImageService/GenerateImage",
    baseUrl
  ).toString();

  const model = options.model ?? DEFAULT_IMAGE_MODEL;
  const quality =
    options.quality ?? (model === DEFAULT_IMAGE_MODEL ? DEFAULT_IMAGE_QUALITY : undefined);

  const response = await fetch(fullUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "connect-protocol-version": "1",
      authorization: `Bearer ${ENV.forgeApiKey}`,
    },
    body: JSON.stringify({
      prompt: options.prompt,
      originalImages: options.originalImages || [],
      model,
      ...(quality ? { quality } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Image generation request failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
    );
  }

  const result = (await response.json()) as {
    image?: { b64Json?: string; url?: string; mimeType?: string };
    error?: unknown;
  };
  if (result.error || !result.image) throw new Error("Image service did not return an image");
  let buffer: Buffer;
  if (result.image.b64Json) {
    buffer = Buffer.from(result.image.b64Json, "base64");
  } else if (result.image.url) {
    const imageResponse = await fetch(result.image.url);
    if (!imageResponse.ok) throw new Error(`Image download failed (${imageResponse.status})`);
    buffer = Buffer.from(await imageResponse.arrayBuffer());
  } else {
    throw new Error("Image service returned no downloadable bytes");
  }

  // Save to S3
  const { url } = await storagePut(
    `generated/${Date.now()}.png`,
    buffer,
    result.image.mimeType
  );
  return {
    url,
  };
}

export type ImageModelInfo = {
  /** Forge model enum, e.g. "MODEL_GPT_IMAGE_2". Pass into generateImage({ model }). */
  model?: string;
  /** Stable model id, e.g. "gpt-image-2". */
  id?: string;
};

export type ListImageModelsResponse = {
  models: ImageModelInfo[];
};

/**
 * List the image models the internal ImageService currently supports.
 * Feed a returned `model` value into generateImage({ model }).
 */
export async function listImageModels(): Promise<ListImageModelsResponse> {
  if (!ENV.forgeApiUrl) {
    throw new Error("MANUS_API_URL is not configured");
  }
  if (!ENV.forgeApiKey) {
    throw new Error("MANUS_API_KEY is not configured");
  }

  const baseUrl = ENV.forgeApiUrl.endsWith("/")
    ? ENV.forgeApiUrl
    : `${ENV.forgeApiUrl}/`;
  const fullUrl = new URL(
    "images.v1.ImageService/ListModels",
    baseUrl
  ).toString();

  const response = await fetch(fullUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "connect-protocol-version": "1",
      authorization: `Bearer ${ENV.forgeApiKey}`,
    },
    body: "{}",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `List image models failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
    );
  }

  const result = (await response.json()) as { models?: ImageModelInfo[] };
  return { models: result.models ?? [] };
}
