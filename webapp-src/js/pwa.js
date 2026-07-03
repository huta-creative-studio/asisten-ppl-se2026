// ===== PROGRESSIVE WEB APP: SERVICE WORKER + INSTALL PROMPT + OFFLINE BADGE =====
// (Konsolidasi — sebelumnya logic ini terduplikasi di 2 <script> berbeda dengan
// listener 'beforeinstallprompt' ganda, menambah beban tanpa manfaat.)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[PWA] SW registered:', reg.scope))
      .catch(err => console.warn('[PWA] SW registration failed:', err));
  });
}

let _deferredInstallPrompt = null;
const _installBanner = document.getElementById('installBanner');
const _btnInstallYes = document.getElementById('installYes');
const _btnInstallNo  = document.getElementById('installNo');
const _btnInstallPWA = document.getElementById('btnInstallPWA');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  if (_btnInstallPWA) _btnInstallPWA.style.display = 'flex';
  setTimeout(() => {
    if (_deferredInstallPrompt && _installBanner) _installBanner.classList.add('visible');
  }, 3000);
});

async function _triggerInstallPrompt() {
  if (!_deferredInstallPrompt) {
    if (typeof showToast === 'function') showToast('💡 Buka menu browser → "Add to Home Screen" / "Install App"');
    return;
  }
  _deferredInstallPrompt.prompt();
  const { outcome } = await _deferredInstallPrompt.userChoice;
  if (outcome === 'accepted' && typeof showToast === 'function') showToast('✅ App terinstall di Home Screen!');
  _deferredInstallPrompt = null;
  if (_installBanner) _installBanner.classList.remove('visible');
  if (_btnInstallPWA) _btnInstallPWA.style.display = 'none';
}
window.installPWA = _triggerInstallPrompt;

if (_btnInstallYes) _btnInstallYes.addEventListener('click', _triggerInstallPrompt);
if (_btnInstallNo) _btnInstallNo.addEventListener('click', () => {
  if (_installBanner) _installBanner.classList.remove('visible');
});

window.addEventListener('appinstalled', () => {
  if (_installBanner) _installBanner.classList.remove('visible');
  if (_btnInstallPWA) _btnInstallPWA.style.display = 'none';
  if (typeof showToast === 'function') showToast('✅ Asisten SE2026 terpasang');
});

// ===== OFFLINE DETECTOR =====
const _offlineBadge = document.getElementById('offlineBadge');
function updateOnlineStatus() {
  if (!_offlineBadge) return;
  if (!navigator.onLine) _offlineBadge.classList.add('show');
  else _offlineBadge.classList.remove('show');
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();
