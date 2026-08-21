const test = require("node:test");
const assert = require("node:assert/strict");

process.env.KROGER_CLIENT_ID = "test-client";
process.env.KROGER_CLIENT_SECRET = "test-secret";
process.env.KROGER_API_BASE = "https://kroger.test/v1";

const kroger = require("../services/kroger");

const withFetch = async (impl, fn) => {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return impl(String(url), options, calls.length);
  };
  try {
    return await fn(calls);
  } finally {
    global.fetch = original;
    kroger._resetToken();
  }
};

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const tokenBody = (expiresIn = 1800) => ({ access_token: "tok-abc", expires_in: expiresIn });

test("normalizeProduct flattens the nested API shape", () => {
  const flat = kroger.normalizeProduct({
    productId: "0001111089816",
    upc: "0001111089816",
    brand: "Kroger",
    description: "Kroger® Red Lentils",
    items: [{ size: "16 oz", price: { regular: 2.69, promo: 2.29 }, inventory: { stockLevel: "HIGH" } }],
    aisleLocations: [{ description: "AISLE 8", bayNumber: "8" }],
    images: [
      { perspective: "back", sizes: [{ size: "medium", url: "https://img/back.jpg" }] },
      { perspective: "front", sizes: [{ size: "thumbnail", url: "https://img/thumb.jpg" }, { size: "medium", url: "https://img/front.jpg" }] },
    ],
  });

  assert.equal(flat.productId, "0001111089816");
  assert.equal(flat.brand, "Kroger");
  assert.equal(flat.size, "16 oz");
  assert.equal(flat.price, 2.69);
  assert.equal(flat.promoPrice, 2.29);
  assert.equal(flat.stockLevel, "HIGH");
  assert.equal(flat.aisle, "AISLE 8");
  assert.equal(flat.bay, "8");
  // Prefers the front perspective at medium size.
  assert.equal(flat.image, "https://img/front.jpg");
});

test("normalizeProduct tolerates a product with no items, aisles, or images", () => {
  const flat = kroger.normalizeProduct({ productId: "1", description: "Bare" });
  assert.equal(flat.size, null);
  assert.equal(flat.price, null);
  assert.equal(flat.aisle, null);
  assert.equal(flat.image, null);
});

test("searchProducts requests a token once and reuses it", async () => {
  await withFetch(
    (url) => jsonResponse(url.includes("/connect/oauth2/token")
      ? tokenBody()
      : { data: [{ productId: "1", description: "Milk", items: [{ size: "1 gal" }] }] }),
    async (calls) => {
      await kroger.searchProducts({ term: "milk", locationId: "02900788" });
      await kroger.searchProducts({ term: "eggs", locationId: "02900788" });

      const tokenCalls = calls.filter(c => c.url.includes("/connect/oauth2/token"));
      assert.equal(tokenCalls.length, 1, "token should be cached across searches");

      const search = calls.find(c => c.url.includes("/products"));
      assert.match(search.url, /filter\.term=milk/);
      assert.match(search.url, /filter\.locationId=02900788/);
    }
  );
});

test("searchProducts refreshes the token once after a 401", async () => {
  await withFetch(
    (url, _options, n) => {
      if (url.includes("/connect/oauth2/token")) return jsonResponse(tokenBody());
      // First product call rejects the cached token, the retry succeeds.
      if (n === 2) return jsonResponse({}, 401);
      return jsonResponse({ data: [] });
    },
    async (calls) => {
      await kroger.searchProducts({ term: "milk" });
      assert.equal(calls.filter(c => c.url.includes("/connect/oauth2/token")).length, 2);
    }
  );
});

test("searchProducts rejects a blank term without calling the API", async () => {
  await withFetch(() => jsonResponse({}), async (calls) => {
    await assert.rejects(() => kroger.searchProducts({ term: "  " }), /term is required/);
    assert.equal(calls.length, 0);
  });
});

test("searchLocations requires a five digit zip", async () => {
  await withFetch(() => jsonResponse({}), async (calls) => {
    await assert.rejects(() => kroger.searchLocations({ zipCode: "abc" }), /zipCode/);
    await assert.rejects(() => kroger.searchLocations({ zipCode: "2550" }), /zipCode/);
    assert.equal(calls.length, 0);
  });
});

test("searchLocations maps the location payload", async () => {
  await withFetch(
    (url) => jsonResponse(url.includes("/connect/oauth2/token")
      ? tokenBody()
      : { data: [{ locationId: "02900788", name: "Kroger - Barboursville", address: { addressLine1: "5465 US Route 60", city: "Barboursville", state: "WV" } }] }),
    async () => {
      const [store] = await kroger.searchLocations({ zipCode: "25504" });
      assert.equal(store.locationId, "02900788");
      assert.equal(store.address.city, "Barboursville");
    }
  );
});

test("auth failure surfaces as a 502-flagged error", async () => {
  await withFetch(() => jsonResponse({ error: "nope" }, 401), async () => {
    await assert.rejects(() => kroger.searchProducts({ term: "milk" }), (err) => {
      assert.match(err.message, /Kroger auth failed/);
      assert.equal(err.status, 502);
      return true;
    });
  });
});

test("fetchProductImage only accepts a product id, never a URL", async () => {
  await withFetch(() => jsonResponse({}), async (calls) => {
    // Anything that could redirect the request elsewhere must be refused
    // before a request is made — this endpoint must not become an open relay.
    for (const bad of [
      "http://169.254.169.254/latest/meta-data",
      "../../etc/passwd",
      "0001111089816/../..",
      "abc",
      "",
      null,
    ]) {
      await assert.rejects(() => kroger.fetchProductImage({ productId: bad }), /invalid productId/);
    }
    assert.equal(calls.length, 0);
  });
});

test("fetchProductImage returns the image bytes and content type", async () => {
  await withFetch(
    () => ({
      ok: true,
      status: 200,
      headers: { get: (h) => (h.toLowerCase() === "content-type" ? "image/jpeg" : null) },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }),
    async (calls) => {
      const out = await kroger.fetchProductImage({ productId: "0001111089816" });
      assert.equal(out.contentType, "image/jpeg");
      assert.deepEqual([...out.buffer], [1, 2, 3]);
      assert.match(calls[0].url, /\/product\/images\/medium\/front\/0001111089816$/);
    }
  );
});

test("fetchProductImage clamps an unknown size to medium", async () => {
  await withFetch(
    () => ({
      ok: true,
      status: 200,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => new Uint8Array([0]).buffer,
    }),
    async (calls) => {
      await kroger.fetchProductImage({ productId: "1234567", size: "../../evil" });
      assert.match(calls[0].url, /\/images\/medium\//);
    }
  );
});

test("fetchProductImage refuses a non-image upstream response", async () => {
  await withFetch(
    () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/html" },
      arrayBuffer: async () => new Uint8Array([0]).buffer,
    }),
    async () => {
      // An HTML body here would mean the bot wall answered, not the image host.
      await assert.rejects(() => kroger.fetchProductImage({ productId: "1234567" }), /did not return an image/);
    }
  );
});

test("fetchProductImage surfaces an upstream miss as a 404", async () => {
  await withFetch(
    () => ({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }),
    async () => {
      await assert.rejects(() => kroger.fetchProductImage({ productId: "1234567" }), (err) => {
        assert.equal(err.status, 404);
        return true;
      });
    }
  );
});
