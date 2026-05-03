'use strict';

const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// KeyboardKey enum — Windows Virtual-Key codes used by the hotkey system.
// Values match the VK_* constants a hotkey system needs.
// ---------------------------------------------------------------------------
const KeyboardKey = {
  // Special / editing keys
  Back:      0x08,  // VK_BACK    — Backspace
  Tab:       0x09,  // VK_TAB
  Return:    0x0D,  // VK_RETURN  — Enter
  Escape:    0x1B,  // VK_ESCAPE
  Space:     0x20,  // VK_SPACE
  Prior:     0x21,  // VK_PRIOR   — Page Up
  Next:      0x22,  // VK_NEXT    — Page Down
  End:       0x23,  // VK_END
  Home:      0x24,  // VK_HOME
  Left:      0x25,  // VK_LEFT
  Up:        0x26,  // VK_UP
  Right:     0x27,  // VK_RIGHT
  Down:      0x28,  // VK_DOWN
  Delete:    0x2E,  // VK_DELETE

  // Modifier keys (main)
  Shift:     0x10,  // VK_SHIFT
  Control:   0x11,  // VK_CONTROL
  Menu:      0x12,  // VK_MENU    — Alt
  Capital:   0x14,  // VK_CAPITAL — Caps Lock
  LWin:      0x5B,  // VK_LWIN   — Left Super/Meta
  RWin:      0x5C,  // VK_RWIN   — Right Super/Meta

  // Left / right variants
  LShift:    0xA0,  // VK_LSHIFT
  RShift:    0xA1,  // VK_RSHIFT
  LControl:  0xA2,  // VK_LCONTROL
  RControl:  0xA3,  // VK_RCONTROL
  LMenu:     0xA4,  // VK_LMENU  — Left Alt
  RMenu:     0xA5,  // VK_RMENU  — Right Alt

  // Digits 0–9 (0x30–0x39)
  Zero:  0x30, One:   0x31, Two:   0x32, Three: 0x33, Four:  0x34,
  Five:  0x35, Six:   0x36, Seven: 0x37, Eight: 0x38, Nine:  0x39,

  // Letters A–Z (0x41–0x5A)
  A: 0x41, B: 0x42, C: 0x43, D: 0x44, E: 0x45, F: 0x46, G: 0x47,
  H: 0x48, I: 0x49, J: 0x4A, K: 0x4B, L: 0x4C, M: 0x4D, N: 0x4E,
  O: 0x4F, P: 0x50, Q: 0x51, R: 0x52, S: 0x53, T: 0x54, U: 0x55,
  V: 0x56, W: 0x57, X: 0x58, Y: 0x59, Z: 0x5A,

  // Function keys F1–F12 (0x70–0x7B)
  F1:  0x70, F2:  0x71, F3:  0x72, F4:  0x73,
  F5:  0x74, F6:  0x75, F7:  0x76, F8:  0x77,
  F9:  0x78, F10: 0x79, F11: 0x7A, F12: 0x7B,
};

// ---------------------------------------------------------------------------
// Platform / version spoofs — required for the Cowork availability check.
// The in-process JS gate does getPlatform() === "darwin"; we satisfy it here.
// ---------------------------------------------------------------------------
function getOSVersion()        { return '14.0.0'; }  // macOS Sonoma spoof
function getPlatform()         { return 'darwin'; }   // must stay "darwin"
function getPlatformName()     { return 'macOS'; }    // display name for UI
function getPlatformInfo()     { return { platform: 'darwin', name: 'macOS', version: '14.0.0', arch: process.arch }; }
function isReady()               { return true; }
function isCoworkSupported()   { return true; }
function getCoworkAvailability() { return { status: 'supported' }; }
function isDispatchSupported()   { return true; }
function getDispatchAvailability() { return { status: 'supported' }; }
function getFeatureAvailability(feature) {
  return { status: 'supported', supported: true };
}

// ---------------------------------------------------------------------------
// Push notification stubs — required for Dispatch message delivery.
//
// On macOS, Dispatch registers with APNs to receive a device token that is
// used for mobile-to-desktop message routing.  On Linux there is no APNs;
// we return a plausible-looking token so the registration path succeeds and
// the app's Dispatch message handler is not gated behind a token check.
//
// When the app calls any of these:
//   registerForPushNotifications()
//   requestPushToken() / getPushToken()
//   registerForRemoteNotifications(callback)
//   getDeviceToken()
//
// We return a synthetic token that passes any string/non-null check but will
// not deliver real APNs push messages (background delivery is a known
// non-goal — the app must be running for Dispatch to function on Linux).
// ---------------------------------------------------------------------------
const LINUX_PUSH_TOKEN = (function() {
  let machineId = '';
  try {
    machineId = require('fs').readFileSync('/etc/machine-id', 'utf8').trim();
  } catch (_) {
    try {
      machineId = require('fs').readFileSync('/var/lib/dbus/machine-id', 'utf8').trim();
    } catch (_) {
      machineId = require('os').hostname().replace(/[^a-z0-9]/gi, '') || 'unknown';
    }
  }
  return 'linux-dispatch-stub-' + machineId.slice(0, 32);
})();

function registerForPushNotifications(callback) {
  process.stderr.write('[claude-native stub] registerForPushNotifications → synthetic token\n');
  if (typeof callback === 'function') {
    setImmediate(() => callback(null, LINUX_PUSH_TOKEN));
  }
  return Promise.resolve({ token: LINUX_PUSH_TOKEN, success: true, authorized: true });
}

function requestPushToken() {
  process.stderr.write('[claude-native stub] requestPushToken → synthetic token\n');
  return Promise.resolve({ token: LINUX_PUSH_TOKEN, success: true });
}

function getPushToken() {
  return LINUX_PUSH_TOKEN;
}

function getDeviceToken() {
  return Promise.resolve(LINUX_PUSH_TOKEN);
}

function requestNotificationAuthorization() {
  return Promise.resolve({ authorized: true, granted: true });
}

function isPushNotificationsEnabled() { return true; }
function isPushNotificationsRegistered() { return true; }

// ---------------------------------------------------------------------------
// AuthRequest — handles the claude:// OAuth deep-link callback.
// Uses detached+stdio:ignore+unref so the opener does not block Electron.
// ---------------------------------------------------------------------------
class AuthRequest {
  static isAvailable() { return true; }

  constructor() {
    this._callbackURLScheme = 'claude';
  }

  /**
   * Open the system browser for OAuth and return a Promise that resolves
   * with { callbackUrl: string } when the claude:// redirect arrives.
   *
   * The app calls: new AuthRequest(); then await request.start(url)
   * The URL is passed to start(), not the constructor.
   *
   * On Linux, open-url-bridge.js forwards the second-instance event to
   * app.emit('open-url', ...) which we listen for here.
   */
  start(url) {
    const scheme = this._callbackURLScheme;
    const authUrl = url;

    // Open the browser immediately (fire-and-forget).
    try {
      const child = spawn('xdg-open', [authUrl], { detached: true, stdio: 'ignore' });
      child.unref();
      process.stderr.write(`[claude-native stub] Opened browser for OAuth: ${authUrl}\n`);
    } catch {
      process.stderr.write(`[claude-native stub] xdg-open unavailable. Open manually:\n  ${authUrl}\n`);
    }

    // Return a Promise that resolves when the claude:// callback arrives.
    // open-url-bridge.js emits 'open-url' on the Electron app when a
    // second instance is launched with the callback URL in its argv.
    let app;
    try {
      app = require('electron').app;
    } catch {
      // Not running inside Electron — resolve immediately with a stub URL.
      process.stderr.write(`[claude-native stub] Not in Electron context; resolving stub callbackUrl.\n`);
      return Promise.resolve({ callbackUrl: `${scheme}://` });
    }

    return new Promise((resolve) => {
      const onOpenUrl = (event, cbUrl) => {
        if (typeof cbUrl === 'string' && cbUrl.toLowerCase().startsWith(`${scheme}://`)) {
          process.stderr.write(`[claude-native stub] OAuth callback received: ${cbUrl}\n`);
          app.removeListener('open-url', onOpenUrl);
          resolve({ callbackUrl: cbUrl });
        }
      };
      app.on('open-url', onOpenUrl);

      // Safety timeout: after 5 minutes give up so the UI can show an error.
      const timer = setTimeout(() => {
        app.removeListener('open-url', onOpenUrl);
        process.stderr.write(`[claude-native stub] OAuth timeout — no ${scheme}:// callback received.\n`);
        resolve({ callbackUrl: `${scheme}://timeout` });
      }, 5 * 60 * 1000);

      // Don't keep the Node event loop alive just for the timeout.
      if (timer.unref) timer.unref();
    });
  }

  // Legacy alias
  open(...args) { return this.start(...args); }
}

// ---------------------------------------------------------------------------
// Computer Use — Linux implementation via xdotool, scrot, wmctrl.
// ---------------------------------------------------------------------------
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const VK_TO_XDOTOOL = {
  0x08: 'BackSpace', 0x09: 'Tab', 0x0D: 'Return', 0x1B: 'Escape',
  0x20: 'space', 0x21: 'Prior', 0x22: 'Next', 0x23: 'End',
  0x24: 'Home', 0x25: 'Left', 0x26: 'Up', 0x27: 'Right', 0x28: 'Down',
  0x2E: 'Delete', 0x10: 'Shift_L', 0x11: 'Control_L', 0x12: 'Alt_L',
  0x14: 'Caps_Lock', 0x5B: 'Super_L', 0x5C: 'Super_R',
  0xA0: 'Shift_L', 0xA1: 'Shift_R', 0xA2: 'Control_L', 0xA3: 'Control_R',
  0xA4: 'Alt_L', 0xA5: 'Alt_R',
  0x70: 'F1', 0x71: 'F2', 0x72: 'F3', 0x73: 'F4',
  0x74: 'F5', 0x75: 'F6', 0x76: 'F7', 0x77: 'F8',
  0x78: 'F9', 0x79: 'F10', 0x7A: 'F11', 0x7B: 'F12',
};

function vkToXdotool(vk) {
  if (VK_TO_XDOTOOL[vk]) return VK_TO_XDOTOOL[vk];
  if (vk >= 0x30 && vk <= 0x39) return String.fromCharCode(vk);
  if (vk >= 0x41 && vk <= 0x5A) return String.fromCharCode(vk + 32);
  return null;
}

function get_window_info() {
  try {
    const out = execFileSync('wmctrl', ['-l', '-p', '-G'], { encoding: 'utf8', timeout: 3000 });
    return out.trim().split('\n').filter(Boolean).map((line) => {
      const parts = line.split(/\s+/);
      const handle = parseInt(parts[0], 16);
      const pid = parseInt(parts[2], 10);
      const x = parseInt(parts[3], 10);
      const y = parseInt(parts[4], 10);
      const w = parseInt(parts[5], 10);
      const h = parseInt(parts[6], 10);
      const title = parts.slice(8).join(' ');
      return { handle, processId: pid, processPath: '', title, x, y, width: w, height: h };
    });
  } catch (_) { return []; }
}

function get_active_window_handle() {
  try {
    const out = execFileSync('xdotool', ['getactivewindow'], { encoding: 'utf8', timeout: 2000 });
    return parseInt(out.trim(), 10) || 0;
  } catch (_) { return 0; }
}

function get_monitor_info() {
  try {
    const out = execFileSync('xrandr', ['--current'], { encoding: 'utf8', timeout: 3000 });
    const match = out.match(/(\d+)x(\d+)\+(\d+)\+(\d+)/);
    if (match) {
      return {
        width: parseInt(match[1], 10),
        height: parseInt(match[2], 10),
        x: parseInt(match[3], 10),
        y: parseInt(match[4], 10),
        monitor_name: 'primary',
        is_primary: true,
      };
    }
  } catch (_) {}
  return { width: 1920, height: 1080, x: 0, y: 0, monitor_name: 'primary', is_primary: true };
}

function focus_window(handle) {
  try {
    execFileSync('xdotool', ['windowactivate', String(handle)], { timeout: 2000 });
  } catch (_) {}
}

function request_accessibility() { return true; }

function captureScreen(options) {
  const tmpFile = path.join(os.tmpdir(), `claude-screenshot-${Date.now()}.png`);
  try {
    if (options && options.windowHandle) {
      execFileSync('scrot', ['-o', tmpFile, '--window', String(options.windowHandle)], { timeout: 5000 });
    } else if (options && options.region) {
      const { x, y, width, height } = options.region;
      execFileSync('scrot', ['-o', tmpFile, '-a', `${x},${y},${width},${height}`], { timeout: 5000 });
    } else {
      execFileSync('scrot', ['-o', tmpFile], { timeout: 5000 });
    }
    const data = fs.readFileSync(tmpFile);
    try { fs.unlinkSync(tmpFile); } catch (_) {}
    return { success: true, data, path: tmpFile };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function captureScreenBase64(options) {
  const result = captureScreen(options);
  if (result.success && result.data) {
    return { success: true, base64: result.data.toString('base64'), format: 'png' };
  }
  return result;
}

class InputEmulator {
  constructor() { this._held = []; }

  type_text(text) {
    try { execFileSync('xdotool', ['type', '--clearmodifiers', text], { timeout: 5000 }); }
    catch (_) {}
  }

  press_chars(text) {
    try { execFileSync('xdotool', ['type', '--clearmodifiers', text], { timeout: 5000 }); }
    catch (_) {}
  }

  release_chars(_text) {}

  press_key(keys) {
    const keyNames = (Array.isArray(keys) ? keys : [keys]).map(vkToXdotool).filter(Boolean);
    if (keyNames.length > 0) {
      try { execFileSync('xdotool', ['keydown', ...keyNames], { timeout: 2000 }); }
      catch (_) {}
      this._held.push(...keyNames);
    }
  }

  release_key(vk) {
    const name = vkToXdotool(vk);
    if (name) {
      try { execFileSync('xdotool', ['keyup', name], { timeout: 2000 }); }
      catch (_) {}
      this._held = this._held.filter(k => k !== name);
    }
  }

  press_then_release_key(keys) {
    const keyNames = (Array.isArray(keys) ? keys : [keys]).map(vkToXdotool).filter(Boolean);
    if (keyNames.length > 0) {
      try { execFileSync('xdotool', ['key', keyNames.join('+')], { timeout: 2000 }); }
      catch (_) {}
    }
  }

  held() { return this._held.map(k => Object.entries(VK_TO_XDOTOOL).find(([_, v]) => v === k)?.[0] || 0); }

  copy() { this.press_then_release_key([0xA2, 0x43]); }
  cut() { this.press_then_release_key([0xA2, 0x58]); }
  paste() { this.press_then_release_key([0xA2, 0x56]); }
  undo() { this.press_then_release_key([0xA2, 0x5A]); }
  select_all() { this.press_then_release_key([0xA2, 0x41]); }

  get_mouse_position() {
    try {
      const out = execFileSync('xdotool', ['getmouselocation'], { encoding: 'utf8', timeout: 2000 });
      const xm = out.match(/x:(\d+)/);
      const ym = out.match(/y:(\d+)/);
      return { x: xm ? parseInt(xm[1], 10) : 0, y: ym ? parseInt(ym[1], 10) : 0 };
    } catch (_) { return { x: 0, y: 0 }; }
  }

  set_mouse_position(x, y) {
    try { execFileSync('xdotool', ['mousemove', String(x), String(y)], { timeout: 2000 }); }
    catch (_) {}
  }

  set_button_click(button) {
    const btn = button === 1 ? '2' : button === 2 ? '3' : '1';
    try { execFileSync('xdotool', ['click', btn], { timeout: 2000 }); }
    catch (_) {}
  }

  set_button_toggle(button, down) {
    const btn = button === 1 ? '2' : button === 2 ? '3' : '1';
    const action = down ? 'mousedown' : 'mouseup';
    try { execFileSync('xdotool', [action, btn], { timeout: 2000 }); }
    catch (_) {}
  }

  set_mouse_scroll(direction, amount) {
    const btn = direction === 0 ? '4' : '5';
    const clicks = Math.max(1, Math.abs(amount || 3));
    try {
      for (let i = 0; i < clicks; i++) {
        execFileSync('xdotool', ['click', btn], { timeout: 2000 });
      }
    } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Proxy — any unknown property returns a no-op function, with a one-time
// warning to stderr so callers are visible in logs.
// ---------------------------------------------------------------------------
const _warned = new Set();

const _base = {
  KeyboardKey, getOSVersion, getPlatform, getPlatformName, getPlatformInfo,
  isReady,
  isCoworkSupported, getCoworkAvailability,
  isDispatchSupported, getDispatchAvailability, getFeatureAvailability,
  // Push notification stubs for Dispatch
  registerForPushNotifications, requestPushToken, getPushToken, getDeviceToken,
  requestNotificationAuthorization,
  isPushNotificationsEnabled, isPushNotificationsRegistered,
  AuthRequest,
  // Computer Use — Linux implementations
  get_window_info, getWindowInfo: get_window_info,
  get_active_window_handle, getActiveWindowHandle: get_active_window_handle,
  get_monitor_info, getMonitorInfo: get_monitor_info,
  focus_window, focusWindow: focus_window,
  request_accessibility, requestAccessibility: request_accessibility,
  captureScreen, captureScreenBase64,
  InputEmulator,
};

module.exports = new Proxy(_base, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (!_warned.has(prop)) {
      _warned.add(prop);
      process.stderr.write(`[claude-native stub] unknown property accessed: ${String(prop)}\n`);
    }
    return function noop() {};
  },
});
