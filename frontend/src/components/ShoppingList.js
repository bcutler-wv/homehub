import { useEffect, useState, useRef } from "react";
import { apiFetch } from "../lib/api";
import GroceryIcon, { detectGroceryIcon } from "../lib/GroceryIcon";
import KrogerSearchModal, { AisleChip, ProductThumb } from "./KrogerSearchModal";
import { byAisle, groupByAisle, searchTermFor, toShoppingItem } from "../lib/krogerMatch";

const G = {
  bg:       "var(--g-bg)",
  card:     "var(--g-card)",
  ink:      "var(--g-ink)",
  ink2:     "var(--g-ink2)",
  muted:    "var(--g-muted)",
  mute2:    "var(--g-mute2)",
  hair:     "var(--g-hair)",
  hair2:    "var(--g-hair2)",
  sage:     "var(--g-sage)",
  sageBg:   "var(--g-sage-bg)",
  sageDark: "var(--g-sage-dark)",
  brick:    "var(--g-brick)",
  brickBg:  "var(--g-brick-bg)",
  serif:    "var(--g-serif)",
  sans:     "var(--g-sans)",
  shadow:   "var(--g-shadow)",
  shadowSm: "var(--g-shadow-sm)",
};

const inputStyle = {
  background: G.card,
  border: `1px solid ${G.hair}`,
  borderRadius: 12,
  padding: "11px 14px",
  fontSize: 14,
  fontFamily: G.sans,
  color: G.ink,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const labelStyle = {
  fontSize: 12,
  color: G.muted,
  display: "block",
  marginBottom: 6,
  fontWeight: 600,
  fontFamily: G.sans,
};

const btnPrimary = {
  padding: "10px 20px",
  background: G.sage,
  color: "#fff",
  border: "none",
  borderRadius: 12,
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
  fontFamily: G.sans,
  boxShadow: "0 4px 12px rgba(90,122,94,0.25)",
};

const btnSecondary = {
  padding: "10px 20px",
  background: G.bg,
  color: G.ink2,
  border: `1px solid ${G.hair}`,
  borderRadius: 12,
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
  fontFamily: G.sans,
};

export default function ShoppingList({ shopping, setShopping, apiEnabled, queueMutation, showToast, onRefresh }) {
  const { stores = [], items = [] } = shopping;
  const [activeStoreId, setActiveStoreId] = useState("all");
  const [krogerSearch, setKrogerSearch] = useState(null); // { term }
  const [krogerReady, setKrogerReady] = useState(false);
  const [addStoreId, setAddStoreId] = useState(null); // target while "All stores" is filtered
  const [suggestions, setSuggestions] = useState(null); // null = idle, [] = searched, no hits
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const suggestTicket = useRef(0);
  const [quickAdd, setQuickAdd] = useState("");
  const [storeModal, setStoreModal] = useState(null);
  const [deleteStoreId, setDeleteStoreId] = useState(null);
  const quickRef = useRef();

  const activeStore = activeStoreId === "all" ? null : (stores.find(s => s.id === activeStoreId) || stores[0] || null);
  const effectiveStoreId = activeStoreId === "all" ? null : (activeStore?.id ?? null);
  const storeItems = activeStoreId === "all" ? items : items.filter(i => i.storeId === effectiveStoreId);

  // A store tagged for Kroger only gets product search once the API is
  // configured; otherwise it behaves like any other list rather than sending
  // every add through a modal that can only fail.
  const hasKrogerStore = stores.some(s => s.vendor === "kroger");

  // Sectioning follows the list you are looking at.
  const isKrogerStore = activeStore?.vendor === "kroger" && krogerReady;

  // Adding follows the store the item will land in, which is the filtered store
  // or, under "All stores", whichever target is picked beside the box. Product
  // search must never engage on a store nobody selected.
  const addTargetStore = activeStoreId === "all"
    ? (stores.find(st => st.id === addStoreId) || null)
    : (stores.find(st => st.id === activeStoreId) || null);
  const addTargetIsKroger = addTargetStore?.vendor === "kroger" && krogerReady;
  const orderItems = (list) => (isKrogerStore ? [...list].sort(byAisle) : list);
  const unchecked = orderItems(storeItems.filter(i => !i.checked));
  const checked   = orderItems(storeItems.filter(i => i.checked));

  const toggleItem = async (item) => {
    const updated = { ...item, checked: !item.checked };
    setShopping(s => ({ ...s, items: s.items.map(i => i.id === item.id ? updated : i) }));
    if (!apiEnabled) {
      queueMutation?.({ method: "PUT", endpoint: `/api/shopping/items/${item.id}`, body: { checked: updated.checked }, resource: "shopping", tempId: item.id });
      return;
    }
    try {
      await apiFetch(`/api/shopping/items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checked: updated.checked }),
      });
    } catch {
      setShopping(s => ({ ...s, items: s.items.map(i => i.id === item.id ? item : i) }));
    }
  };

  useEffect(() => {
    if (!apiEnabled || !hasKrogerStore) { setKrogerReady(false); return undefined; }
    let cancelled = false;
    apiFetch("/api/kroger/status")
      .then(status => { if (!cancelled) setKrogerReady(Boolean(status?.configured)); })
      .catch(() => { if (!cancelled) setKrogerReady(false); });
    return () => { cancelled = true; };
  }, [apiEnabled, hasKrogerStore]);

  // Search as the user types on a Kroger list, one request per pause rather
  // than one per keystroke. Stale replies are discarded so a slow search cannot
  // overwrite a newer one.
  useEffect(() => {
    if (!addTargetIsKroger) { setSuggestions(null); setSuggestBusy(false); return undefined; }
    const term = quickAdd.trim();
    if (term.length < 2) { setSuggestions(null); setSuggestBusy(false); return undefined; }

    const ticket = ++suggestTicket.current;
    setSuggestBusy(true);
    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch(`/api/kroger/search?term=${encodeURIComponent(term)}&limit=6`);
        if (suggestTicket.current !== ticket) return;
        setSuggestions(data.products || []);
        setHighlight(-1);
      } catch {
        if (suggestTicket.current !== ticket) return;
        setSuggestions([]);
      } finally {
        if (suggestTicket.current === ticket) setSuggestBusy(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [quickAdd, addTargetIsKroger]);

  const dismissSuggestions = () => {
    suggestTicket.current += 1;
    setSuggestions(null);
    setSuggestBusy(false);
    setHighlight(-1);
  };

  const onQuickKeyDown = (e) => {
    const open = Array.isArray(suggestions) && suggestions.length > 0;
    if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      setHighlight(h => (h + 1) % suggestions.length);
      return;
    }
    if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setHighlight(h => (h <= 0 ? suggestions.length - 1 : h - 1));
      return;
    }
    if (e.key === "Escape" && (open || suggestBusy)) {
      e.preventDefault();
      dismissSuggestions();
      return;
    }
    if (e.key === "Enter") {
      if (open && highlight >= 0) {
        e.preventDefault();
        const picked = suggestions[highlight];
        dismissSuggestions();
        addKrogerItem(picked, quickAdd.trim());
        return;
      }
      addItem();
    }
  };

  const addItem = async () => {
    const targetStore = addTargetStore;
    if (!quickAdd.trim() || !targetStore) return;
    if (addTargetIsKroger) {
      setKrogerSearch({ term: quickAdd.trim() });
      return;
    }
    const name = quickAdd.trim();
    const newItem = { id: Date.now(), storeId: targetStore.id, name, checked: false };
    setShopping(s => ({ ...s, items: [...s.items, newItem] }));
    setQuickAdd("");
    quickRef.current?.focus();
    if (!apiEnabled) {
      queueMutation?.({ method: "POST", endpoint: "/api/shopping/items", body: { storeId: targetStore.id, name }, resource: "shopping", tempId: newItem.id });
      return;
    }
    try {
      const d = await apiFetch("/api/shopping/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: targetStore.id, name }),
      });
      if (d) setShopping(s => ({ ...s, items: s.items.map(i => i.id === newItem.id ? d : i) }));
    } catch {
      setShopping(s => ({ ...s, items: s.items.filter(i => i.id !== newItem.id) }));
    }
  };

  const deleteItem = async (item) => {
    setShopping(s => ({ ...s, items: s.items.filter(i => i.id !== item.id) }));
    if (!apiEnabled) {
      queueMutation?.({ method: "DELETE", endpoint: `/api/shopping/items/${item.id}`, resource: "shopping", tempId: item.id });
      return;
    }
    try { await apiFetch(`/api/shopping/items/${item.id}`, { method: "DELETE" }); } catch {}
  };

  const addKrogerItem = async (product, sourceTerm) => {
    const targetStore = addTargetStore;
    if (!targetStore) return;
    const term = sourceTerm ?? krogerSearch?.term ?? "";
    const payload = product
      ? toShoppingItem(product, { storeId: targetStore.id, line: term })
      : { storeId: targetStore.id, name: term, kroger: null };

    const optimistic = { ...payload, id: Date.now(), checked: false };
    setShopping(s => ({ ...s, items: [...s.items, optimistic] }));
    setKrogerSearch(null);
    setSuggestions(null);
    setHighlight(-1);
    setQuickAdd("");
    quickRef.current?.focus();

    // Stored under the normalized term so lookups from a recipe line resolve.
    const rememberBody = product ? { term: searchTermFor(term), product } : null;

    if (!apiEnabled) {
      queueMutation?.({ method: "POST", endpoint: "/api/shopping/items", body: payload, resource: "shopping", tempId: optimistic.id });
      if (rememberBody) {
        queueMutation?.({ method: "POST", endpoint: "/api/kroger/matches", body: rememberBody, resource: "krogerMatches", tempId: `match-${optimistic.id}` });
      }
      return;
    }
    try {
      const d = await apiFetch("/api/shopping/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (d) setShopping(s => ({ ...s, items: s.items.map(i => i.id === optimistic.id ? d : i) }));
      if (rememberBody) {
        // Merged server-side, so a hiccup here cannot drop other remembered matches.
        await apiFetch("/api/kroger/matches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rememberBody),
        }).catch(() => {});
      }
    } catch (err) {
      setShopping(s => ({ ...s, items: s.items.filter(i => i.id !== optimistic.id) }));
      showToast?.(err.message || "Could not add item", "danger");
    }
  };

  const setQuantity = async (item, next) => {
    const quantity = Math.max(1, Math.min(99, next));
    if (quantity === (item.quantity || 1)) return;
    const previous = item;
    setShopping(s => ({ ...s, items: s.items.map(i => i.id === item.id ? { ...i, quantity } : i) }));
    if (!apiEnabled) {
      queueMutation?.({ method: "PUT", endpoint: `/api/shopping/items/${item.id}`, body: { quantity }, resource: "shopping", tempId: item.id });
      return;
    }
    try {
      await apiFetch(`/api/shopping/items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity }),
      });
    } catch {
      setShopping(s => ({ ...s, items: s.items.map(i => i.id === item.id ? previous : i) }));
    }
  };

  const clearChecked = async () => {
    if (activeStoreId === "all") {
      setShopping(s => ({ ...s, items: s.items.filter(i => !i.checked) }));
      if (!apiEnabled) {
        stores.forEach(store => queueMutation?.({ method: "DELETE", endpoint: `/api/shopping/items/checked?storeId=${store.id}`, resource: "shopping", tempId: store.id }));
        return;
      }
      for (const store of stores) {
        try { await apiFetch(`/api/shopping/items/checked?storeId=${store.id}`, { method: "DELETE" }); } catch {}
      }
    } else {
      setShopping(s => ({ ...s, items: s.items.filter(i => !i.checked || i.storeId !== activeStore?.id) }));
      if (!apiEnabled) {
        queueMutation?.({ method: "DELETE", endpoint: `/api/shopping/items/checked?storeId=${activeStore?.id}`, resource: "shopping", tempId: activeStore?.id });
        return;
      }
      try { await apiFetch(`/api/shopping/items/checked?storeId=${activeStore?.id}`, { method: "DELETE" }); } catch {}
    }
  };

  const saveStore = async () => {
    if (!storeModal?.name?.trim()) return showToast("Store name required", "danger");
    if (storeModal.id) {
      setShopping(s => ({ ...s, stores: s.stores.map(st => st.id === storeModal.id ? { ...st, ...storeModal } : st) }));
      setStoreModal(null);
      if (!apiEnabled) {
        queueMutation?.({ method: "PUT", endpoint: `/api/shopping/stores/${storeModal.id}`, body: { name: storeModal.name, color: storeModal.color }, resource: "shopping", tempId: storeModal.id });
        return;
      }
      try {
        await apiFetch(`/api/shopping/stores/${storeModal.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: storeModal.name, color: storeModal.color }),
        });
      } catch { showToast("Failed to save", "danger"); }
    } else {
      const tmp = { id: Date.now(), name: storeModal.name, color: storeModal.color || "#5a7a5e" };
      setShopping(s => ({ ...s, stores: [...s.stores, tmp] }));
      setActiveStoreId(tmp.id);
      setStoreModal(null);
      if (!apiEnabled) {
        queueMutation?.({ method: "POST", endpoint: "/api/shopping/stores", body: { name: storeModal.name, color: storeModal.color || "#5a7a5e" }, resource: "shopping", tempId: tmp.id });
        return;
      }
      try {
        const d = await apiFetch("/api/shopping/stores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: storeModal.name, color: storeModal.color || "#5a7a5e" }),
        });
        if (d) {
          setShopping(s => ({ ...s, stores: s.stores.map(st => st.id === tmp.id ? d : st) }));
          setActiveStoreId(d.id);
        }
      } catch { showToast("Failed to save store", "danger"); }
    }
  };

  const confirmDeleteStore = async () => {
    setShopping(s => ({
      stores: s.stores.filter(st => st.id !== deleteStoreId),
      items: s.items.filter(i => i.storeId !== deleteStoreId),
    }));
    if (activeStoreId === deleteStoreId) setActiveStoreId("all");
    setDeleteStoreId(null);
    if (!apiEnabled) {
      queueMutation?.({ method: "DELETE", endpoint: `/api/shopping/stores/${deleteStoreId}`, resource: "shopping", tempId: deleteStoreId });
      return;
    }
    try { await apiFetch(`/api/shopping/stores/${deleteStoreId}`, { method: "DELETE" }); } catch {}
  };

  const addPrompt = stores.length === 0
    ? "Add a store first"
    : (addTargetStore ? `Add to ${addTargetStore.name}...` : "Choose a store...");

  const iconKey = detectGroceryIcon(quickAdd);

  return (
    <div className="page" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontFamily: G.sans, fontSize: 11.5, color: G.sage, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Shopping list
          </div>
          <h1 style={{ fontFamily: G.serif, fontSize: 44, color: G.ink, margin: "4px 0 0", fontWeight: 400, letterSpacing: "-0.5px", lineHeight: 1 }}>
            Shopping
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {apiEnabled && onRefresh && (
            <button
              onClick={onRefresh}
              title="Refresh"
              style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 7, padding: "10px 14px" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
              Refresh
            </button>
          )}
          <button
            onClick={() => setStoreModal({ name: "", color: "#5a7a5e" })}
            style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 8, padding: "10px 16px" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Add store
          </button>
        </div>
      </div>

      {/* Store filter tabs */}
      {stores.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <StoreTab
            active={activeStoreId === "all"}
            label="All stores"
            count={items.filter(i => !i.checked).length}
            onClick={() => setActiveStoreId("all")}
          />
          {stores.map(s => (
            <StoreTab
              key={s.id}
              active={activeStoreId === s.id}
              label={s.name}
              color={s.color}
              count={items.filter(i => i.storeId === s.id && !i.checked).length}
              onClick={() => setActiveStoreId(s.id)}
              onEdit={() => setStoreModal({ ...s })}
            />
          ))}
        </div>
      )}

      {stores.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "80px 20px",
          background: G.card, borderRadius: 20, boxShadow: G.shadow,
        }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="var(--g-mute2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 16 }}>
            <path d="M13 22h22l-3 15c0 1-1 2-2 2H18c-1 0-2-1-2-2z"/>
            <path d="M11 22h26"/>
            <path d="M18 22c0-7 12-7 12 0"/>
          </svg>
          <p style={{ margin: 0, fontSize: 16, color: G.muted, fontFamily: G.sans }}>
            Add a store to get started
          </p>
        </div>
      ) : (
        <>
          {/* Quick-add bar */}
          <div style={{ position: "relative" }}>
          <div style={{
            display: "flex", gap: 10, alignItems: "center",
            background: G.card, borderRadius: 16, padding: "8px 8px 8px 14px",
            boxShadow: G.shadowSm, border: `1px solid ${G.hair}`,
          }}>
            {quickAdd.trim() && (
              <span style={{ flexShrink: 0 }}>
                <GroceryIcon name={iconKey} size={28} stroke="var(--g-sage-dark)" strokeWidth={2} />
              </span>
            )}
            <input
              ref={quickRef}
              style={{ ...inputStyle, background: "transparent", border: "none", padding: "8px 0", flex: 1 }}
              placeholder={addPrompt}
              value={quickAdd}
              onChange={e => setQuickAdd(e.target.value)}
              onKeyDown={onQuickKeyDown}
              disabled={stores.length === 0}
              role={addTargetIsKroger ? "combobox" : undefined}
              aria-expanded={addTargetIsKroger ? Boolean(suggestions?.length) : undefined}
              aria-controls={addTargetIsKroger ? "kroger-suggestions" : undefined}
              aria-autocomplete={addTargetIsKroger ? "list" : undefined}
              autoComplete="off"
            />
            {activeStoreId === "all" && stores.length > 0 && (
              <select
                value={addStoreId ?? ""}
                onChange={e => setAddStoreId(e.target.value ? Number(e.target.value) : null)}
                aria-label="Add to store"
                style={{
                  background: "transparent", border: "none", outline: "none",
                  fontSize: 13, fontWeight: 600, fontFamily: G.sans,
                  color: addStoreId ? G.ink : G.mute2,
                  cursor: "pointer", flexShrink: 0, maxWidth: 150,
                }}
              >
                <option value="">Choose store</option>
                {stores.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
              </select>
            )}
            <button
              style={{
                ...btnPrimary, padding: "9px 18px", flexShrink: 0,
                opacity: addTargetStore ? 1 : 0.5,
                cursor: addTargetStore ? "pointer" : "default",
              }}
              onClick={addItem}
              disabled={!addTargetStore}
            >
              {addTargetIsKroger ? "Find" : "Add"}
            </button>
          </div>

          {addTargetIsKroger && (suggestBusy || Array.isArray(suggestions)) && quickAdd.trim().length >= 2 && (
            <div id="kroger-suggestions" role="listbox" aria-label="Kroger products" className="kroger-suggest">
              {suggestBusy && !suggestions?.length && (
                <p className="kroger-suggest-note">Searching Kroger…</p>
              )}
              {!suggestBusy && suggestions?.length === 0 && (
                <p className="kroger-suggest-note">
                  Nothing matched “{quickAdd.trim()}”. Press Add to put it on the list as text.
                </p>
              )}
              {(suggestions || []).map((product, i) => {
                const unit = product.promoPrice ?? product.price;
                return (
                  <button
                    key={product.productId || product.upc || `s-${i}`}
                    type="button"
                    role="option"
                    aria-selected={i === highlight}
                    className={`kroger-suggest-row${i === highlight ? " is-active" : ""}`}
                    onMouseEnter={() => setHighlight(i)}
                    onMouseDown={e => e.preventDefault()} /* keep focus in the input */
                    onClick={() => { dismissSuggestions(); addKrogerItem(product, quickAdd.trim()); }}
                  >
                    <ProductThumb src={product.image} productId={product.productId} alt="" size={32} radius={8} />
                    <span style={{ minWidth: 0 }}>
                      <span className="kroger-suggest-name">{product.description}</span>
                      <span className="kroger-suggest-sub">
                        {[product.brand, product.size, product.aisle].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="kroger-suggest-price">
                      {typeof unit === "number" ? `$${unit.toFixed(2)}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          </div>

          {/* Items */}
          {unchecked.length === 0 && checked.length === 0 && (
            <p style={{ color: G.muted, textAlign: "center", padding: "40px 0", margin: 0, fontFamily: G.sans }}>
              No items yet - add one above.
            </p>
          )}

          {unchecked.length > 0 && (
            isKrogerStore ? (
              // Sectioned in the order you walk the store.
              <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
                {groupByAisle(unchecked).map(group => (
                  <div key={group.key}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
                        textTransform: "uppercase", color: "var(--g-sky)", fontFamily: G.sans,
                      }}>
                        {group.label}
                      </span>
                      <span style={{ flex: 1, height: 1, background: G.hair }} />
                      <span style={{ fontSize: 11, color: G.mute2, fontFamily: G.sans }}>
                        {group.items.length}
                      </span>
                    </div>
                    <div className="shopping-rows">
                      {group.items.map(item => (
                        <KrogerItemRow
                          key={item.id}
                          item={item}
                          onToggle={toggleItem}
                          onDelete={deleteItem}
                          onQuantityChange={setQuantity}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))",
                gap: 12,
              }}>
                {unchecked.map(item => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    storeName={activeStoreId === "all" ? stores.find(s => s.id === item.storeId)?.name : null}
                    storeColor={stores.find(s => s.id === item.storeId)?.color}
                    onToggle={toggleItem}
                    onDelete={deleteItem}
                    onQuantityChange={setQuantity}
                  />
                ))}
              </div>
            )
          )}

          {/* Checked / In cart */}
          {checked.length > 0 && (
            <div style={{ borderTop: `1px solid ${G.hair}`, paddingTop: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <span style={{ fontSize: 12, color: G.muted, fontWeight: 600, fontFamily: G.sans, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  In cart ({checked.length})
                </span>
                <button
                  onClick={clearChecked}
                  style={{
                    all: "unset", cursor: "pointer",
                    fontSize: 12, color: G.brick, fontWeight: 600, fontFamily: G.sans,
                    padding: "4px 10px", borderRadius: 8,
                    background: "var(--g-brick-bg)",
                  }}
                >
                  Clear list
                </button>
              </div>
              {isKrogerStore ? (
                <div className="shopping-rows">
                  {checked.map(item => (
                    <KrogerItemRow
                      key={item.id}
                      item={item}
                      onToggle={toggleItem}
                      onDelete={deleteItem}
                      onQuantityChange={setQuantity}
                    />
                  ))}
                </div>
              ) : (
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))",
                  gap: 12,
                }}>
                  {checked.map(item => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      storeName={activeStoreId === "all" ? stores.find(s => s.id === item.storeId)?.name : null}
                      storeColor={stores.find(s => s.id === item.storeId)?.color}
                      onToggle={toggleItem}
                      onDelete={deleteItem}
                      onQuantityChange={setQuantity}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Store actions */}
          {activeStoreId !== "all" && activeStore && (
            <div style={{ display: "flex", gap: 8, paddingTop: 8 }}>
              <button style={btnSecondary} onClick={() => setStoreModal({ ...activeStore })}>Edit store</button>
              <button
                onClick={() => setDeleteStoreId(activeStore.id)}
                style={{ ...btnSecondary, color: G.brick, borderColor: "var(--g-brick-bg)" }}
              >
                Delete store
              </button>
            </div>
          )}
        </>
      )}

      {/* Store modal */}
      {krogerSearch && (
        <KrogerSearchModal
          initialTerm={krogerSearch.term}
          title={`Add to ${activeStore?.name || "Kroger"}`}
          onPick={(product, term) => addKrogerItem(product, term)}
          onSkip={(term) => addKrogerItem(null, term)}
          skipLabel={(term) => (term ? `Add “${term}” as text` : "Add as text")}
          onClose={() => setKrogerSearch(null)}
        />
      )}

      {storeModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setStoreModal(null)}>
          <div className="modal-box" style={{ maxWidth: 380 }}>
            <h3 style={{ margin: "0 0 20px", fontSize: 22, fontWeight: 400, fontFamily: G.serif, color: G.ink }}>
              {storeModal.id ? "Edit store" : "Add store"}
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={labelStyle}>Store name</label>
                <input
                  style={inputStyle}
                  value={storeModal.name}
                  onChange={e => setStoreModal(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Colruyt"
                  onKeyDown={e => e.key === "Enter" && saveStore()}
                  autoFocus
                />
              </div>
              <div>
                <label style={labelStyle}>Colour</label>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="color"
                    value={storeModal.color || "#5a7a5e"}
                    onChange={e => setStoreModal(f => ({ ...f, color: e.target.value }))}
                    style={{ width: 44, height: 38, padding: 2, border: `1px solid ${G.hair}`, borderRadius: 8, cursor: "pointer", background: "none" }}
                  />
                  <span style={{ fontSize: 13, color: G.muted, fontFamily: G.sans }}>{storeModal.color || "#5a7a5e"}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button style={btnPrimary} onClick={saveStore}>Save</button>
                <button style={btnSecondary} onClick={() => setStoreModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteStoreId && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setDeleteStoreId(null)}>
          <div className="modal-box" style={{ maxWidth: 360, textAlign: "center" }}>
            <div style={{ width: 56, height: 56, borderRadius: 18, background: "var(--g-brick-bg)", margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--g-brick)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
              </svg>
            </div>
            <h3 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 400, fontFamily: G.serif, color: G.ink }}>Delete store?</h3>
            <p style={{ margin: "0 0 24px", color: G.muted, fontFamily: G.sans, fontSize: 14 }}>
              All items in this store will also be removed.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                onClick={confirmDeleteStore}
                style={{ ...btnSecondary, color: G.brick, borderColor: "var(--g-brick-bg)", background: "var(--g-brick-bg)" }}
              >
                Delete
              </button>
              <button style={btnSecondary} onClick={() => setDeleteStoreId(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KrogerItemRow({ item, onToggle, onDelete, onQuantityChange }) {
  const kroger = item.kroger || null;
  const unit = kroger?.promoPrice ?? kroger?.price ?? null;
  const qty = Math.max(1, item.quantity || 1);

  return (
    <div
      className={`shopping-row${item.checked ? " is-checked" : ""}`}
      onClick={() => onToggle(item)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(item); } }}
    >
      <span className={`shopping-row-check${item.checked ? " is-on" : ""}`} aria-hidden="true">
        {item.checked && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4 10-12" />
          </svg>
        )}
      </span>

      <ProductThumb src={kroger?.image} productId={kroger?.productId} alt="" size={34} radius={9} />

      <span style={{ minWidth: 0 }}>
        <span className="shopping-row-name">{item.name}</span>
        {(kroger?.brand || kroger?.size) && (
          <span className="shopping-row-sub">{[kroger.brand, kroger.size].filter(Boolean).join(" · ")}</span>
        )}
      </span>

      {typeof unit === "number" ? (
        <span style={{ textAlign: "right", lineHeight: 1.15 }}>
          <span style={{ display: "block", fontFamily: "var(--g-serif)", fontSize: 15, color: item.checked ? "var(--g-mute2)" : "var(--g-ink)" }}>
            ${(unit * qty).toFixed(2)}
          </span>
          {qty > 1 && (
            <span style={{ display: "block", fontSize: 10, color: "var(--g-mute2)" }}>{qty} × ${unit.toFixed(2)}</span>
          )}
        </span>
      ) : <span />}

      {item.checked
        ? <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--g-mute2)" }}>{qty > 1 ? `×${qty}` : ""}</span>
        : <QtyStepper value={qty} onChange={next => onQuantityChange(item, next)} label={`quantity of ${item.name}`} />}

      <button
        onClick={e => { e.stopPropagation(); onDelete(item); }}
        aria-label={`Remove ${item.name}`}
        className="shopping-row-remove"
      >
        ×
      </button>
    </div>
  );
}

function QtyStepper({ value, onChange, size = "sm", label }) {
  const compact = size === "sm";
  const btn = {
    all: "unset",
    cursor: "pointer",
    width: compact ? 18 : 24,
    height: compact ? 18 : 24,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    color: "var(--g-ink2)",
    fontSize: compact ? 13 : 15,
    lineHeight: 1,
    userSelect: "none",
  };
  return (
    <span
      onClick={e => e.stopPropagation()}
      style={{
        display: "inline-flex", alignItems: "center", gap: compact ? 2 : 6,
        padding: compact ? "2px 3px" : "3px 5px",
        borderRadius: 9, background: "var(--g-bg2)", flexShrink: 0,
        fontFamily: "var(--g-sans)",
      }}
    >
      <button
        type="button"
        style={{ ...btn, opacity: value <= 1 ? 0.35 : 1 }}
        disabled={value <= 1}
        aria-label={label ? `Decrease ${label}` : "Decrease quantity"}
        onClick={e => { e.stopPropagation(); onChange(value - 1); }}
      >
        −
      </button>
      <span
        aria-live="polite"
        style={{
          minWidth: compact ? 14 : 18, textAlign: "center",
          fontSize: compact ? 12 : 13.5, fontWeight: 700, color: "var(--g-ink)",
        }}
      >
        {value}
      </span>
      <button
        type="button"
        style={btn}
        aria-label={label ? `Increase ${label}` : "Increase quantity"}
        onClick={e => { e.stopPropagation(); onChange(value + 1); }}
      >
        +
      </button>
    </span>
  );
}

function StoreTab({ active, label, color, count, onClick, onEdit }) {
  return (
    <button
      onClick={onClick}
      onDoubleClick={onEdit}
      title={onEdit ? "Double-click to edit" : undefined}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 14px",
        borderRadius: 999,
        fontFamily: "var(--g-sans)",
        fontWeight: 600,
        fontSize: 13,
        background: active ? (color || "var(--g-sage)") : "var(--g-card)",
        color: active ? "#fff" : "var(--g-ink2)",
        boxShadow: active ? "0 2px 8px rgba(0,0,0,0.12)" : "var(--g-shadow-sm)",
        border: `1px solid ${active ? "transparent" : "var(--g-hair)"}`,
        transition: "all 0.15s",
      }}
    >
      {!active && color && (
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
      )}
      {label}
      {count > 0 && (
        <span style={{
          fontWeight: 700, fontSize: 11,
          background: active ? "rgba(255,255,255,0.25)" : "var(--g-sage-bg)",
          color: active ? "#fff" : "var(--g-sage-dark)",
          padding: "1px 6px", borderRadius: 999,
        }}>
          {count}
        </span>
      )}
    </button>
  );
}

function ItemCard({ item, storeName, storeColor, showAisle = false, onToggle, onDelete, onQuantityChange }) {
  const [hover, setHover] = useState(false);
  const iconKey = detectGroceryIcon(item.name);
  const kroger = item.kroger || null;
  const price = kroger?.promoPrice ?? kroger?.price ?? null;
  const qty = Math.max(1, item.quantity || 1);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onToggle(item)}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "16px 12px 14px",
        borderRadius: 18,
        cursor: "pointer",
        background: item.checked ? "var(--g-bg)" : "var(--g-card)",
        border: `1px solid ${item.checked ? "var(--g-hair2)" : "var(--g-hair)"}`,
        boxShadow: item.checked ? "none" : "var(--g-shadow-sm)",
        transition: "all 0.15s",
        opacity: item.checked ? 0.6 : 1,
        minHeight: 110,
        userSelect: "none",
      }}
    >
      {/* Checkmark overlay */}
      {item.checked && (
        <div style={{
          position: "absolute", top: 8, right: 8,
          width: 20, height: 20, borderRadius: 7,
          background: "var(--g-sage)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4 10-12"/>
          </svg>
        </div>
      )}

      {/* Delete on hover */}
      {hover && !item.checked && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(item); }}
          style={{
            position: "absolute", top: 7, right: 7,
            all: "unset", cursor: "pointer",
            background: "var(--g-brick-bg)",
            color: "var(--g-brick)",
            fontSize: 14, lineHeight: 1,
            width: 20, height: 20, borderRadius: 6,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          x
        </button>
      )}

      {/* Product photo when Kroger gave us one, otherwise the drawn icon */}
      {kroger?.image ? (
        <span style={{ opacity: item.checked ? 0.55 : 1 }}>
          <ProductThumb src={kroger.image} productId={kroger.productId} alt="" size={48} radius={14} />
        </span>
      ) : (
        <div style={{
          width: 48, height: 48,
          borderRadius: 14,
          background: item.checked ? "var(--g-bg)" : "var(--g-sage-bg)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <GroceryIcon
            name={iconKey}
            size={28}
            stroke={item.checked ? "var(--g-mute2)" : "var(--g-sage-dark)"}
            strokeWidth={2}
          />
        </div>
      )}

      <span style={{
        fontSize: 13, fontWeight: 600,
        color: item.checked ? "var(--g-muted)" : "var(--g-ink)",
        textAlign: "center",
        textDecoration: item.checked ? "line-through" : "none",
        lineHeight: 1.3,
        wordBreak: "break-word",
        maxWidth: "100%",
        fontFamily: "var(--g-sans)",
      }}>
        {item.name}
      </span>

      {onQuantityChange && !item.checked && (
        <QtyStepper
          value={qty}
          onChange={next => onQuantityChange(item, next)}
          label={`quantity of ${item.name}`}
        />
      )}

      {item.checked && qty > 1 && (
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--g-mute2)", fontFamily: "var(--g-sans)" }}>
          ×{qty}
        </span>
      )}

      {kroger && (kroger.brand || kroger.size) && (
        <span style={{ fontSize: 10.5, color: "var(--g-mute2)", fontFamily: "var(--g-sans)", textAlign: "center", lineHeight: 1.25 }}>
          {[kroger.brand, kroger.size].filter(Boolean).join(" · ")}
        </span>
      )}

      {typeof price === "number" && (
        <span style={{ textAlign: "center", lineHeight: 1.15 }}>
          <span style={{
            display: "block",
            fontFamily: "var(--g-serif)", fontSize: 17, lineHeight: 1,
            color: item.checked ? "var(--g-mute2)" : "var(--g-ink)",
          }}>
            ${(price * qty).toFixed(2)}
          </span>
          {qty > 1 && (
            <span style={{ display: "block", marginTop: 2, fontSize: 10, color: "var(--g-mute2)", fontFamily: "var(--g-sans)" }}>
              {qty} × ${price.toFixed(2)}
            </span>
          )}
        </span>
      )}

      {showAisle && kroger?.aisle && <AisleChip aisle={kroger.aisle} bay={kroger.bay} small />}

      {storeName && (
        <span style={{
          fontSize: 10, fontWeight: 700,
          color: storeColor || "var(--g-sage)",
          background: (storeColor || "var(--g-sage)") + "20",
          padding: "2px 7px", borderRadius: 6,
          textTransform: "uppercase", letterSpacing: "0.04em",
          fontFamily: "var(--g-sans)",
        }}>
          {storeName}
        </span>
      )}
    </div>
  );
}
