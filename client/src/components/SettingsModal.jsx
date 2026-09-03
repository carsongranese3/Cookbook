/**
 * SettingsModal — global app settings, opened from "My Kitchen" in the
 * desktop sidebar footer or the gear icon in the phone header (see
 * AppShell.jsx). Today it holds exactly one section — grocery store + ZIP,
 * shared with the Shopping List's own "Set store" modal via
 * StoreSettingsForm so there is one implementation, not two. Built as a
 * list of `.settings-section` blocks so more settings can be added later
 * without restructuring.
 */
import { useEffect } from 'react';
import StoreSettingsForm from './StoreSettingsForm.jsx';

export default function SettingsModal({ onClose }) {
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="modal-scrim"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div className="modal-box settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header mf-header">
          <span>Settings</span>
          <button className="mf-close-btn" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M1 1l12 12M13 1L1 13"/>
            </svg>
          </button>
        </div>
        <div className="modal-body" style={{ padding: '16px 20px 20px' }}>
          <div className="settings-section">
            <div className="settings-section-label">Grocery store</div>
            <StoreSettingsForm onSaved={onClose} onCancel={onClose} />
          </div>
        </div>
      </div>
    </div>
  );
}
