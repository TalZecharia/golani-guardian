import { STR } from './i18n.js';

export const $ = id => document.getElementById(id);

const KEY = 'golani_guardian_v1';
export const settings = { lang: 'he', quality: 'auto', gyro: true, sens: 1, vol: 0.8, hi: 0 };
try {
  const s = JSON.parse(localStorage.getItem(KEY) || '{}');
  Object.assign(settings, s);
} catch (e) {}
if (!/he|en/.test(settings.lang)) settings.lang = 'he';
export function saveSettings() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {} }

export const t = k => (STR[settings.lang] && STR[settings.lang][k] !== undefined ? STR[settings.lang][k] : (STR.en[k] !== undefined ? STR.en[k] : k));

export function applyLang() {
  const L = settings.lang;
  document.documentElement.lang = L; document.documentElement.dir = L === 'he' ? 'rtl' : 'ltr';
  document.title = t('title');
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
  $('hiTxt').textContent = settings.hi;
}

let toastT = 0;
export function toast(msg, ms = 2200) {
  const el = $('toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), ms);
}
export function banner(msg) {
  const el = $('banner'); el.textContent = msg; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
let storyT = 0;
export function story(msg, ms = 3600) {
  const el = $('story'); el.textContent = msg; el.classList.add('show');
  clearTimeout(storyT); storyT = setTimeout(() => el.classList.remove('show'), ms);
}
export function hideStory() { clearTimeout(storyT); $('story').classList.remove('show'); }
export function show(id) { $(id).classList.remove('hidden'); }
export function hide(id) { $(id).classList.add('hidden'); }

export function hitmark(head) {
  const h = $('hitmark'); h.classList.toggle('head', !!head); h.classList.add('show');
  clearTimeout(hitmark.t); hitmark.t = setTimeout(() => h.classList.remove('show'), 90);
}
export function vignette() {
  const v = $('vig'); v.classList.add('on'); clearTimeout(vignette.t); vignette.t = setTimeout(() => v.classList.remove('on'), 120);
}
