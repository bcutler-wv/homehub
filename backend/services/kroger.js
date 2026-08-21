// Kroger Public API client — Product and Location endpoints.
//
// Both run on the OAuth2 client_credentials grant, so no customer login is
// involved and the credentials never leave the server. Tokens last 30 minutes;
// we cache one in memory and refresh slightly early rather than per request.
const config = require("../config");

const TOKEN_PATH = "/connect/oauth2/token";
const SCOPE = "product.compact";
const REFRESH_MARGIN_MS = 60 * 1000;

let cached = null; // { token, expiresAt }

const configured = () => Boolean(config.KROGER_CLIENT_ID && config.KROGER_CLIENT_SECRET);

const bad = (msg, status = 502) => Object.assign(new Error(msg), { status });

const getToken = async () => {
  if (!configured()) throw bad("Kroger API is not configured", 503);
  if (cached && cached.expiresAt > Date.now() + REFRESH_MARGIN_MS) return cached.token;

  const basic = Buffer
    .from(`${config.KROGER_CLIENT_ID}:${config.KROGER_CLIENT_SECRET}`)
    .toString("base64");
  const resp = await fetch(`${config.KROGER_API_BASE}${TOKEN_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(SCOPE)}`,
  });
  if (!resp.ok) throw bad(`Kroger auth failed (${resp.status})`);
  const data = await resp.json();
  if (!data.access_token) throw bad("Kroger auth returned no token");

  cached = {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 1800) * 1000,
  };
  return cached.token;
};

const authedGet = async (path, params) => {
  const token = await getToken();
  const url = new URL(`${config.KROGER_API_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (resp.status === 401) {
    cached = null; // token rejected early — force one retry with a fresh token
    const retryToken = await getToken();
    const retry = await fetch(url, { headers: { Authorization: `Bearer ${retryToken}` } });
    if (!retry.ok) throw bad(`Kroger request failed (${retry.status})`);
    return retry.json();
  }
  if (!resp.ok) throw bad(`Kroger request failed (${resp.status})`);
  return resp.json();
};

// Flatten the API's nested shape into what the shopping list actually renders.
const normalizeProduct = (p) => {
  const item = (p.items || [])[0] || {};
  const price = item.price || {};
  const aisle = (p.aisleLocations || [])[0] || {};
  const image = (p.images || []).find(i => i.perspective === "front") || (p.images || [])[0] || {};
  const size = (image.sizes || []).find(s => s.size === "medium") || (image.sizes || [])[0] || {};
  return {
    productId: p.productId || null,
    upc: p.upc || null,
    brand: p.brand || null,
    description: p.description || "",
    size: item.size || null,
    price: price.regular ?? null,
    promoPrice: price.promo || null,
    stockLevel: (item.inventory || {}).stockLevel || null,
    aisle: aisle.description || null,
    bay: aisle.bayNumber || null,
    image: size.url || null,
  };
};

const searchProducts = async ({ term, locationId, limit = 8 }) => {
  if (!term || !String(term).trim()) throw bad("term is required", 400);
  const data = await authedGet("/products", {
    "filter.term": String(term).trim(),
    "filter.locationId": locationId || undefined,
    "filter.limit": Math.min(Math.max(parseInt(limit, 10) || 8, 1), 50),
  });
  return (data.data || []).map(normalizeProduct);
};

// Product ids are the only input, deliberately: proxying an arbitrary URL
// would turn this into an open relay into the private network.
const PRODUCT_ID = /^[0-9]{6,20}$/;
const IMAGE_SIZES = ["small", "medium", "large", "thumbnail", "xlarge"];

const fetchProductImage = async ({ productId, size = "medium" }) => {
  if (!PRODUCT_ID.test(String(productId || ""))) throw bad("invalid productId", 400);
  const variant = IMAGE_SIZES.includes(size) ? size : "medium";
  const resp = await fetch(`https://www.kroger.com/product/images/${variant}/front/${productId}`);
  if (!resp.ok) throw bad(`image unavailable (${resp.status})`, 404);
  const type = resp.headers.get("content-type") || "";
  if (!type.startsWith("image/")) throw bad("upstream did not return an image", 502);
  return { buffer: Buffer.from(await resp.arrayBuffer()), contentType: type };
};

const searchLocations = async ({ zipCode, limit = 5 }) => {
  if (!zipCode || !/^\d{5}$/.test(String(zipCode).trim())) throw bad("zipCode must be 5 digits", 400);
  const data = await authedGet("/locations", {
    "filter.zipCode.near": String(zipCode).trim(),
    "filter.limit": Math.min(Math.max(parseInt(limit, 10) || 5, 1), 50),
  });
  return (data.data || []).map(l => ({
    locationId: l.locationId,
    name: l.name,
    address: l.address || {},
  }));
};

module.exports = { configured, searchProducts, searchLocations, fetchProductImage, normalizeProduct, _resetToken: () => { cached = null; } };
