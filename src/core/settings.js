// Persistent per-viewer settings. Storage may be unavailable (private mode, file://), so every access is guarded.
const KEY = 'fau-campus-settings-v1';

const DEFAULTS = {
  lang: 'zh',            // 'zh' | 'de'
  quality: 'auto',       // 'auto' | 'low' | 'medium' | 'high'
  sensitivity: 1.0,
  invertY: false,
  volume: 0.8,
  weather: 'autumn',     // autumn | sunny | overcast | rain | night
  showFps: false,
  subtitlesDe: true,     // show German original under Chinese dialogue lines
  view: 'first',         // 'first' | 'third' person camera
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (e) { /* storage blocked */ }
  return { ...DEFAULTS };
}

export const settings = load();
const listeners = new Set();

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

export function setSetting(key, value) {
  if (settings[key] === value) return;
  settings[key] = value;
  saveSettings();
  for (const fn of listeners) fn(key, value);
}

export function onSettingChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
