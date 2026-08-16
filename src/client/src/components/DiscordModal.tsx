import React, { useState, useEffect } from 'react';
import { Bell, Send, CheckCircle2, AlertCircle, X, ShieldCheck, Flame, Gift, Clock, Database } from 'lucide-react';
import { api } from '../api.js';

interface DiscordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DiscordModal: React.FC<DiscordModalProps> = ({ isOpen, onClose }) => {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [isEnabled, setIsEnabled] = useState(true);
  const [minDealScore, setMinDealScore] = useState(75);
  const [minConfidence, setMinConfidence] = useState(40);
  const [notifyAtlOnly, setNotifyAtlOnly] = useState(false);
  const [notifyFreeGames, setNotifyFreeGames] = useState(true);
  const [cooldownHours, setCooldownHours] = useState(24);

  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadSettings();
      setTestResult(null);
      setSaveSuccess(false);
      setErrorMessage('');
    }
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const data = await api.getDiscordSettings();
      setWebhookUrl(data.webhookUrl || '');
      setIsEnabled(data.isEnabled);
      setMinDealScore(data.minDealScore ?? 75);
      setMinConfidence((data as any).minConfidence ?? 40);
      setNotifyAtlOnly(data.notifyAtlOnly ?? false);
      setNotifyFreeGames(data.notifyFreeGames ?? true);
      setCooldownHours(data.cooldownHours ?? 24);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load Discord settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      setLoading(true);
      setErrorMessage('');
      await api.saveDiscordSettings({
        webhookUrl: webhookUrl.trim(),
        isEnabled,
        minDealScore,
        minConfidence,
        notifyAtlOnly,
        notifyFreeGames,
        cooldownHours
      } as any);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    if (!webhookUrl.trim()) {
      setErrorMessage('Please enter a Discord Webhook URL first.');
      return;
    }

    try {
      setTesting(true);
      setTestResult(null);
      setErrorMessage('');
      const res = await api.testDiscordWebhook(webhookUrl.trim());
      setTestResult({ success: true, message: res.message || 'Test alert delivered to Discord!' });
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'Failed to deliver test message to Discord.' });
    } finally {
      setTesting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content discord-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-icon-badge discord-badge">
              <Bell size={20} />
            </div>
            <div>
              <h3>Discord Deal Alerts</h3>
              <p className="modal-subtitle">Instant notifications for verified wishlist bargains & free games</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        {errorMessage && (
          <div className="alert-banner alert-error">
            <AlertCircle size={16} />
            <span>{errorMessage}</span>
          </div>
        )}

        {saveSuccess && (
          <div className="alert-banner alert-success">
            <CheckCircle2 size={16} />
            <span>Discord notification settings saved successfully!</span>
          </div>
        )}

        {testResult && (
          <div className={`alert-banner ${testResult.success ? 'alert-success' : 'alert-error'}`}>
            {testResult.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{testResult.message}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="modal-body">
          {/* Master Enable Toggle */}
          <div className="setting-card">
            <div className="setting-card-info">
              <div className="setting-card-title">Enable Discord Notifications</div>
              <div className="setting-card-desc">Automatically post alerts to Discord when price sync finds qualifying deals</div>
            </div>
            <label className="toggle-switch">
              <input 
                type="checkbox" 
                checked={isEnabled} 
                onChange={e => setIsEnabled(e.target.checked)} 
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          {/* Webhook URL Input */}
          <div className="form-group">
            <label className="form-label" htmlFor="discord-webhook-url">
              Discord Webhook URL
            </label>
            <div className="input-with-button">
              <input
                id="discord-webhook-url"
                type="url"
                className="form-input"
                placeholder="https://discord.com/api/webhooks/..."
                value={webhookUrl}
                onChange={e => setWebhookUrl(e.target.value)}
                required={isEnabled}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleTest}
                disabled={testing || !webhookUrl.trim()}
                title="Send a sample alert to test your webhook"
              >
                {testing ? (
                  <span className="spinner-small"></span>
                ) : (
                  <>
                    <Send size={14} />
                    <span>Test</span>
                  </>
                )}
              </button>
            </div>
            <p className="form-help-text">
              Channel Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL
            </p>
          </div>

          {/* Minimum Deal Score Slider */}
          <div className="form-group">
            <div className="form-label-row">
              <label className="form-label" htmlFor="discord-min-deal-score">
                <Flame size={15} className="text-warning inline-icon" />
                Minimum Deal Score: <strong className="text-accent">{minDealScore} / 100</strong>
              </label>
              <span className={`deal-tier-pill tier-${minDealScore >= 85 ? 'exceptional' : minDealScore >= 70 ? 'great' : 'fair'}`}>
                {minDealScore >= 85 ? 'Exceptional Only (85+)' : minDealScore >= 70 ? 'Great & Exceptional (70+)' : 'Fair+'}
              </span>
            </div>
            <input
              id="discord-min-deal-score"
              type="range"
              min="40"
              max="95"
              step="5"
              className="range-slider"
              value={minDealScore}
              onChange={e => setMinDealScore(parseInt(e.target.value, 10))}
            />
            <div className="range-ticks">
              <span onClick={() => setMinDealScore(50)} className={minDealScore === 50 ? 'active' : ''}>50 (Fair)</span>
              <span onClick={() => setMinDealScore(70)} className={minDealScore === 70 ? 'active' : ''}>70 (Great)</span>
              <span onClick={() => setMinDealScore(85)} className={minDealScore === 85 ? 'active' : ''}>85 (Exceptional)</span>
            </div>
          </div>

          {/* Price History Verification Level */}
          <div className="form-group">
            <label className="form-label" htmlFor="discord-min-conf">
              <ShieldCheck size={15} className="text-accent inline-icon" />
              Historical Verification Level
            </label>
            <select
              id="discord-min-conf"
              className="select-input"
              value={minConfidence >= 75 ? 75 : minConfidence >= 40 ? 40 : 20}
              onChange={e => setMinConfidence(parseInt(e.target.value, 10))}
            >
              <option value="40">Standard (Recommended) — Requires verified price history</option>
              <option value="75">Strict — Extensive multi-source historical confirmation only</option>
              <option value="20">Permissive — Include newly tracked & provisional deals</option>
            </select>
            <p className="form-help-text">
              Filters out false-alarm discounts on newly added games until adequate historical sale patterns are recorded.
            </p>
          </div>

          {/* Filter Options */}
          <div className="setting-checkbox-group">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={notifyAtlOnly}
                onChange={e => setNotifyAtlOnly(e.target.checked)}
              />
              <div className="checkbox-content">
                <div className="checkbox-title">
                  <Flame size={14} color="#f59e0b" />
                  <span>Notify for All-Time Low (ATL) only</span>
                </div>
                <div className="checkbox-desc">Only send alerts when an offer matches or beats the historical all-time low price</div>
              </div>
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={notifyFreeGames}
                onChange={e => setNotifyFreeGames(e.target.checked)}
              />
              <div className="checkbox-content">
                <div className="checkbox-title">
                  <Gift size={14} color="#a855f7" />
                  <span>100% Free Game Promotions</span>
                </div>
                <div className="checkbox-desc">Always send an instant alert if a game on your wishlist becomes free (100% off)</div>
              </div>
            </label>
          </div>

          {/* Cooldown Settings */}
          <div className="form-group">
            <label className="form-label" htmlFor="discord-cooldown">
              <Clock size={15} className="inline-icon" />
              Anti-Spam Cooldown Window
            </label>
            <select
              id="discord-cooldown"
              className="select-input"
              value={cooldownHours}
              onChange={e => setCooldownHours(parseInt(e.target.value, 10))}
            >
              <option value="6">6 hours between repeated alerts for same game</option>
              <option value="12">12 hours between repeated alerts</option>
              <option value="24">24 hours (Recommended: once a day)</option>
              <option value="48">48 hours</option>
              <option value="72">72 hours</option>
            </select>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <span className="spinner-small"></span> : 'Save Settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
