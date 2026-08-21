import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";

const G = {
  card:     "var(--g-card)",
  bg:       "var(--g-bg)",
  bg2:      "var(--g-bg2)",
  ink:      "var(--g-ink)",
  muted:    "var(--g-muted)",
  mute2:    "var(--g-mute2)",
  hair:     "var(--g-hair)",
  sage:     "var(--g-sage)",
  sageBg:   "var(--g-sage-bg)",
  sageDark: "var(--g-sage-dark)",
  sky:      "var(--g-sky)",
  skyBg:    "var(--g-sky-bg)",
  serif:    "var(--g-serif)",
  sans:     "var(--g-sans)",
};

const money = (value) => (typeof value === "number" ? `$${value.toFixed(2)}` : null);

/** Aisle / department, the way the store signs it. */
export function AisleChip({ aisle, bay, small = false }) {
  if (!aisle) return null;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: small ? "2px 6px" : "3px 8px",
        borderRadius: 6,
        background: G.skyBg,
        color: G.sky,
        fontSize: small ? 9.5 : 10.5,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        fontFamily: G.sans,
        whiteSpace: "nowrap",
      }}
    >
      {aisle}{bay ? ` · bay ${bay}` : ""}
    </span>
  );
}

/**
 * Product image. Prefers our own origin — the backend fetches from Kroger — so
 * the browser never has to reach a third party. Falls back to the stored
 * absolute URL, then to a neutral tile.
 */
export function ProductThumb({ src, productId, alt, size = 44, radius = 12 }) {
  const [failed, setFailed] = useState(false);
  const resolved = productId ? `/api/kroger/image/${productId}` : src;
  if (!resolved || failed) {
    return (
      <div
        aria-hidden="true"
        style={{
          width: size, height: size, borderRadius: radius,
          background: G.sageBg, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none"
          stroke={G.sageDark} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
      </div>
    );
  }
  return (
    <img
      src={resolved}
      alt={alt || ""}
      loading="lazy"
      onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: radius, objectFit: "cover", background: G.bg, flexShrink: 0 }}
    />
  );
}

/**
 * Product search against the configured Kroger store. `initialTerm` seeds the
 * box so the recipe flow can open straight onto an ingredient.
 */
export default function KrogerSearchModal({ initialTerm = "", title = "Add from Kroger", onPick, onClose, onSkip, skipLabel }) {
  // `skipLabel` is called with the current term rather than baked at open time,
  // and onPick/onSkip report it, so editing the search changes what is added.
  const [term, setTerm] = useState(initialTerm);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const requestRef = useRef(0);

  const search = useCallback(async (value) => {
    const query = String(value || "").trim();
    if (!query) { setResults(null); setError(null); return; }
    const ticket = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch(`/api/kroger/search?term=${encodeURIComponent(query)}&limit=8`);
      if (ticket !== requestRef.current) return; // a newer search already landed
      setResults(data.products || []);
    } catch (err) {
      if (ticket !== requestRef.current) return;
      setError(err.message || "Could not reach Kroger");
      setResults([]);
    } finally {
      if (ticket === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    if (initialTerm) search(initialTerm);
  }, [initialTerm, search]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 520, width: "100%" }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 22, fontWeight: 400, fontFamily: G.serif, color: G.ink }}>
          {title}
        </h3>

        <form
          onSubmit={e => { e.preventDefault(); search(term); }}
          style={{ display: "flex", gap: 8, marginBottom: 14 }}
        >
          <input
            ref={inputRef}
            value={term}
            onChange={e => setTerm(e.target.value)}
            placeholder="Search Kroger products"
            aria-label="Search Kroger products"
            style={{
              background: G.card, border: `1px solid ${G.hair}`, borderRadius: 12,
              padding: "11px 14px", fontSize: 14, fontFamily: G.sans, color: G.ink,
              outline: "none", flex: 1, boxSizing: "border-box",
            }}
          />
          <button
            type="submit"
            disabled={!term.trim() || loading}
            style={{
              padding: "10px 18px", background: G.sage, color: "#fff", border: "none",
              borderRadius: 12, fontWeight: 600, fontSize: 14, fontFamily: G.sans,
              cursor: term.trim() && !loading ? "pointer" : "default",
              opacity: term.trim() && !loading ? 1 : 0.5,
            }}
          >
            {loading ? "Searching" : "Search"}
          </button>
        </form>

        <div style={{ maxHeight: 380, overflowY: "auto", margin: "0 -4px", padding: "0 4px" }}>
          {error && (
            <p style={{ margin: "8px 0", fontSize: 13, color: "var(--g-brick)", fontFamily: G.sans }}>
              {error}
            </p>
          )}

          {!error && results === null && !loading && (
            <p style={{ margin: "8px 0", fontSize: 13, color: G.muted, fontFamily: G.sans }}>
              Search for a product to add it with its price and aisle.
            </p>
          )}

          {!error && results?.length === 0 && !loading && (
            <p style={{ margin: "8px 0", fontSize: 13, color: G.muted, fontFamily: G.sans }}>
              No products matched “{term.trim()}”. Try a shorter term.
            </p>
          )}

          {(results || []).map((product, index) => (
            <button
              key={product.productId || product.upc || `result-${index}`}
              type="button"
              onClick={() => onPick(product, term.trim())}
              style={{
                display: "flex", alignItems: "center", gap: 12, width: "100%",
                padding: "10px 10px", marginBottom: 6,
                background: G.card, border: `1px solid ${G.hair}`, borderRadius: 14,
                cursor: "pointer", textAlign: "left", fontFamily: G.sans,
              }}
            >
              <ProductThumb src={product.image} productId={product.productId} alt={product.description} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: G.ink, lineHeight: 1.3 }}>
                  {product.description}
                </span>
                <span style={{ display: "block", marginTop: 3, fontSize: 11.5, color: G.mute2 }}>
                  {[product.brand, product.size].filter(Boolean).join(" · ")}
                </span>
                <span style={{ display: "flex", gap: 6, marginTop: 5, alignItems: "center", flexWrap: "wrap" }}>
                  <AisleChip aisle={product.aisle} bay={product.bay} small />
                  {product.stockLevel && (
                    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: G.mute2 }}>
                      {product.stockLevel.toLowerCase()} stock
                    </span>
                  )}
                </span>
              </span>
              <span style={{ textAlign: "right", flexShrink: 0 }}>
                <span style={{ display: "block", fontFamily: G.serif, fontSize: 19, color: G.ink, lineHeight: 1 }}>
                  {money(product.promoPrice ?? product.price) || "—"}
                </span>
                {product.promoPrice != null && product.price != null && (
                  <span style={{ display: "block", marginTop: 2, fontSize: 11, color: G.mute2, textDecoration: "line-through" }}>
                    {money(product.price)}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "10px 20px", background: G.bg2, color: G.ink, border: "none",
              borderRadius: 12, fontWeight: 600, fontSize: 14, fontFamily: G.sans, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          {onSkip && (
            <button
              type="button"
              onClick={() => onSkip(term.trim())}
              disabled={!term.trim()}
              style={{
                padding: "10px 20px", background: "none", color: G.muted, border: `1px solid ${G.hair}`,
                borderRadius: 12, fontWeight: 600, fontSize: 14, fontFamily: G.sans,
                cursor: term.trim() ? "pointer" : "default", opacity: term.trim() ? 1 : 0.5,
              }}
            >
              {typeof skipLabel === "function" ? skipLabel(term.trim()) : (skipLabel || "Add as plain text")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
