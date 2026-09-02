// Shrink a photo in the browser before upload. A phone camera JPEG is often
// 4-8MB; a note thumbnail needs a fraction of that, and the server keeps
// whatever it is sent forever.

/** Longest-edge fit, preserving aspect ratio. Never enlarges. */
export const fitDimensions = (width, height, maxDim) => {
  const w = Math.max(0, Math.round(width || 0));
  const h = Math.max(0, Math.round(height || 0));
  if (!w || !h) return { width: 0, height: 0 };
  const longest = Math.max(w, h);
  if (!maxDim || longest <= maxDim) return { width: w, height: h };
  const scale = maxDim / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
};

export const readableSize = (bytes) => {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const loadImage = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image")); };
  img.src = url;
});

/**
 * Returns a compressed JPEG File, or the original when compression would not
 * help — a small PNG screenshot re-encoded as JPEG can come out larger, and a
 * GIF would lose its animation.
 */
export const compressImage = async (file, { maxDim = 1600, quality = 0.8 } = {}) => {
  if (!file || !String(file.type || "").startsWith("image/")) return file;
  if (file.type === "image/gif") return file;
  if (typeof document === "undefined" || !document.createElement("canvas").getContext) return file;

  let img;
  try {
    img = await loadImage(file);
  } catch {
    return file; // let the server reject it if it is genuinely broken
  }

  const { width, height } = fitDimensions(img.naturalWidth, img.naturalHeight, maxDim);
  if (!width || !height) return file;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob || blob.size >= file.size) return file;

  const name = String(file.name || "photo").replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
};
