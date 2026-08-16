import React, { useState, useEffect } from 'react';
import { Bell, Send, CheckCircle2, AlertCircle, X, ExternalLink, ShieldCheck, Flame, Gift, Clock } from 'lucide-react';
import { api } from '../api.js';

interface DiscordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DiscordModal: React.FC<DiscordModalProps> = ({ isOpen, onClose }) => {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [isEnabled, setIsEnabled] = useState(true);
  const [minDealScore, setMinDealScore] = useState(75);
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
        notifyAtlOnly,
        notifyFreeGames,
        cooldownHours
      });
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
              <p className="modal-subtitle">Instant notifications for top wishlist bargains & free games</p>
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
                Minimum Deal Score Threshold: <strong className="text-accent">{minDealScore} / 100</strong>
              </label>
              <span className={`deal-tier-pill tier-${minDealScore >= 85 ? 'exceptional' : minDealScore >= 70 ? 'great' : 'fair'}`}>
                {minDealScore >= 85 ? 'Exceptional Only' : minDealScore >= 70 ? 'Great & Exceptional (Recommended)' : 'Fair & Above'}
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

          {/* Filter Options */}
          <div className="setting-checkbox-group">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={notifyAtlOnly}
                onChange={e => setNotifyAtlOnly(e.target.checked)}
              />
              <div className="checkbox-text">
                <div className="checkbox-title">
                  <ShieldCheck size={15} className="text-success inline-icon" />
                  All-Time Low (ATL) Deals Only
                </div>
                <div className="checkbox-desc">Only send notifications when the game matches or breaks its all-time lowest recorded price</div>
              </div>
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={notifyFreeGames}
                onChange={e => setNotifyFreeGames(e.target.checked)}
              />
              <div className="checkbox-text">
                <div className="checkbox-title">
                  <Gift size={15} className="text-purple inline-icon" />
                  100% Free Game Promotions
                </div>
                <div className="checkbox-desc">Always send an alert whenever any wishlist game becomes temporarily free (0.00 €)</div>
              </div>
            </label>
          </div>

          {/* Anti-Spam Cooldown */}
          <div className="form-group">
            <label className="form-label" htmlFor="discord-cooldown">
              <Clock size={15} className="inline-icon" />
              Notification Cooldown per Game
            </label>
            <select
              id="discord-cooldown"
              className="form-select"
              value={cooldownHours}
              onChange={e => setCooldownHours(parseInt(e.target.value, 10))}
            >
              <option value="12">12 hours (Faster repeated updates)</option>
              <option value="24">24 hours (Recommended - standard daily pacing)</option>
              <option value="48">48 hours (Quiet - at most every 2 days)</option>
              <option value="168">7 days (Weekly deal alerts only)</option>
            </select>
            <p className="form-help-text">
              Prevents pinging Discord repeatedly for the same game unless the price drops further.
            </p>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
