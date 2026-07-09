import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api.js';

export default function ShoppingList({ isOffline }) {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [newItem, setNewItem] = useState('');
  const [adding, setAdding]   = useState(false);
  const inputRef              = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.shopping.get();
      setItems(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const uncheckedCount = items.filter((i) => !i.checked).length;

  async function handleAdd() {
    const name = newItem.trim();
    if (!name) return;
    if (isOffline) return;
    setAdding(true);
    try {
      const created = await api.shopping.add(name);
      setItems((prev) => [...prev, created]);
      setNewItem('');
    } catch (e) {
      // ignore
    } finally {
      setAdding(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  }

  async function handleToggle(id) {
    if (isOffline) return;
    // Optimistic update
    setItems((prev) =>
      prev.map((it) => it.id === id ? { ...it, checked: !it.checked } : it)
    );
    try {
      const updated = await api.shopping.toggle(id);
      setItems((prev) => prev.map((it) => it.id === id ? updated : it));
    } catch (e) {
      // revert
      setItems((prev) =>
        prev.map((it) => it.id === id ? { ...it, checked: !it.checked } : it)
      );
    }
  }

  async function handleDelete(id) {
    if (isOffline) return;
    setItems((prev) => prev.filter((it) => it.id !== id));
    try {
      await api.shopping.remove(id);
    } catch (e) {
      await load();
    }
  }

  async function handleClearChecked() {
    if (isOffline) return;
    const checked = items.filter((i) => i.checked);
    if (checked.length === 0) return;
    setItems((prev) => prev.filter((i) => !i.checked));
    try {
      await api.shopping.clearChecked();
    } catch (e) {
      await load();
    }
  }

  if (loading) {
    return (
      <div className="page-pad">
        <div className="state-center">
          <div className="spinner" aria-label="Loading shopping list" />
          <span>Loading…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="page-pad shop-max">
      {/* Header */}
      <div className="shop-header">
        <div>
          <div className="eyebrow">{uncheckedCount} to buy</div>
          <h1 className="page-title">Shopping List</h1>
        </div>
        <button
          className="btn-clear"
          onClick={handleClearChecked}
          disabled={!items.some((i) => i.checked) || isOffline}
          aria-label="Clear all checked items"
        >
          Clear checked
        </button>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button
            className="btn btn-ghost"
            onClick={load}
            style={{ marginLeft: 10, height: 28, fontSize: 12 }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Add item input */}
      <div className="add-item-row">
        <input
          ref={inputRef}
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add an item…"
          aria-label="New shopping list item"
          disabled={adding || isOffline}
        />
        <button
          className="btn-add-item"
          onClick={handleAdd}
          disabled={adding || !newItem.trim() || isOffline}
          aria-label="Add item"
        >
          Add
        </button>
      </div>

      {/* List */}
      <div className="shop-list" role="list" aria-label="Shopping list">
        {items.length === 0 && !error && (
          <div className="state-center">
            <p id="shop-empty-desktop" style={{ display: 'none', margin: 0 }}>
              Your list is empty. Add recipes or type an item above.
            </p>
            <style>{`@media (min-width:768px){#shop-empty-desktop{display:block}}`}</style>
            <p id="shop-empty-phone" style={{ display: 'none', margin: 0 }}>List is empty.</p>
            <style>{`@media (max-width:767px){#shop-empty-phone{display:block}}`}</style>
          </div>
        )}
        {items.map((item) => (
          <div key={item.id} className="shop-item" role="listitem">
            <button
              className={`shop-checkbox ${item.checked ? 'checked' : ''}`}
              onClick={() => handleToggle(item.id)}
              aria-label={item.checked ? `Uncheck ${item.name}` : `Check ${item.name}`}
              aria-pressed={item.checked}
              disabled={isOffline}
            >
              {item.checked && (
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.5" aria-hidden="true">
                  <path d="M2 6l3 3 5-5"/>
                </svg>
              )}
            </button>
            <span className={`shop-item-name ${item.checked ? 'checked' : ''}`}>
              {item.name}
            </span>
            {item.qty && (
              <span className="shop-item-qty">{item.qty}</span>
            )}
            <button
              className="shop-item-delete"
              onClick={() => handleDelete(item.id)}
              aria-label={`Delete ${item.name}`}
              disabled={isOffline}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
