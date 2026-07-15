"use strict";

const CONFIG = window.ENDFIELD_CONFIG || {};
const GAS_URL = String(CONFIG.gasUrl || "");
const AUTO_SYNC_MS = Math.max(
  1000,
  Number(CONFIG.autoSyncMs || 5000)
);
const REQUEST_TIMEOUT_MS = Math.max(
  30000,
  Number(CONFIG.requestTimeoutMs || 90000)
);
const PIN_SHA256 = String(CONFIG.pinSha256 || "");

const SESSION_KEY = "endfield_protocol_authorized";
const SELECTED_ACCOUNT_KEY = "endfield_selected_account";
const NOTIFICATION_STORAGE_KEY =
  "endfield_notification_history_v1";
const NOTIFICATION_CONDITION_KEY =
  "endfield_notification_conditions_v1";
const MAX_NOTIFICATION_HISTORY = 60;
const DEVICE_NOTIFICATION_ICON =
  "https://raw.githubusercontent.com/Yue-plus/endfield_icons/main/svg/endfield-industries.svg";

const FALLBACK_ACCOUNTS = [
  { slug: "muzaka" },
  { slug: "orion" },
  { slug: "naskara" }
];


const state = {
  selectedSlug:
    localStorage.getItem(SELECTED_ACCOUNT_KEY) ||
    FALLBACK_ACCOUNTS[0].slug,
  data: null,
  autoTimer: null,
  countdownTimer: null,
  requestInProgress: false,
  checkingIn: false,
  lastRevision: null,
  lastDataSignature: null,
  networkPulseTimer: null,
  copyLabelTimer: null,
  avatarManifest: null,
  avatarManifestVersion: null,
  avatarManifestTimer: null,
  notifications: [],
  notificationConditions: {},
  notificationPanelOpen: false
};

const operationProgressState = {
  refresh: {
    timer: null,
    startedAt: 0,
    progress: 0
  },
  checkin: {
    timer: null,
    startedAt: 0,
    progress: 0
  }
};

const OPERATION_BUTTONS = {
  refresh: [
    "#refreshButton",
    "#sidebarRefreshButton"
  ],
  checkin: [
    "#checkinButton",
    "#sidebarCheckinButton"
  ]
};

const $ = selector => document.querySelector(selector);
const $$ = selector =>
  Array.from(document.querySelectorAll(selector));

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function gasConfigured() {
  return (
    GAS_URL.startsWith("https://script.google.com/") &&
    GAS_URL.includes("/exec")
  );
}

/**
 * JSONP dipakai agar GitHub Pages dapat membaca Google Apps Script
 * tanpa bergantung pada header CORS.
 */
function gasRequest(action, parameters = {}) {
  if (!gasConfigured()) {
    return Promise.reject(
      new Error("URL Google Apps Script belum benar di config.js.")
    );
  }

  return new Promise((resolve, reject) => {
    const callbackName =
      `__endfieldJsonp_${Date.now()}_` +
      `${Math.random().toString(36).slice(2)}`;

    const script = document.createElement("script");
    let timeoutId = null;
    let completed = false;

    const cleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }

      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }

      try {
        delete window[callbackName];
      } catch (_) {
        window[callbackName] = undefined;
      }
    };

    const finish = handler => value => {
      if (completed) return;
      completed = true;
      cleanup();
      handler(value);
    };

    window[callbackName] = finish(resolve);

    script.onerror = finish(() => {
      reject(
        new Error(
          "Google Apps Script tidak dapat dihubungi. " +
          "Pastikan deployment dapat diakses oleh Anyone."
        )
      );
    });

    const query = new URLSearchParams({
      action,
      callback: callbackName,
      _: String(Date.now()),
      ...Object.fromEntries(
        Object.entries(parameters).map(([key, value]) => [
          key,
          String(value)
        ])
      )
    });

    script.src = `${GAS_URL}?${query.toString()}`;
    script.async = true;

    timeoutId = setTimeout(
      finish(() => {
        reject(
          new Error(
            "Permintaan Google Apps Script melewati batas waktu."
          )
        );
      }),
      REQUEST_TIMEOUT_MS
    );

    document.head.appendChild(script);
  });
}

function normalizeDashboardPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Respons dashboard kosong.");
  }

  if (payload.success === false) {
    throw new Error(
      payload.message || "Google Apps Script mengembalikan error."
    );
  }

  const dashboardState =
    payload.state ||
    payload.dashboardState ||
    (
      payload.accounts &&
      typeof payload.accounts === "object"
        ? payload
        : null
    );

  if (!dashboardState?.accounts) {
    throw new Error(
      "Respons tidak memiliki data akun dashboard."
    );
  }

  return dashboardState;
}

function clampPercent(current, maximum) {
  const currentValue = Number(current);
  const maximumValue = Number(maximum);

  if (
    !Number.isFinite(currentValue) ||
    !Number.isFinite(maximumValue) ||
    maximumValue <= 0
  ) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(100, (currentValue / maximumValue) * 100)
  );
}

function setProgress(element, current, maximum) {
  if (!element) return;
  element.style.width =
    `${clampPercent(current, maximum)}%`;
}

function formatNumber(value, fallback = "—") {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? String(parsed)
    : fallback;
}

function formatDateWib(value, includeSeconds = true) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {})
  }) + " WIB";
}

function browserTimeWib() {
  return new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }) + " WIB";
}

async function sha256Text(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes
  );

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function allAccountEntries() {
  const accounts = state.data?.accounts;

  return FALLBACK_ACCOUNTS.map((fallback, index) => ({
    slot_index: index + 1,
    ...fallback,
    ...(accounts?.[fallback.slug] || {})
  }));
}

function selectedAccount() {
  return (
    allAccountEntries().find(
      account => account.slug === state.selectedSlug
    ) ||
    allAccountEntries()[0]
  );
}

function setAuthorized(authorized) {
  $("#loginLayer").hidden = authorized;

  if (authorized) {
    sessionStorage.setItem(SESSION_KEY, "1");
    startAutoSync();
    startAvatarManifestSync();
  } else {
    sessionStorage.removeItem(SESSION_KEY);
    stopAutoSync();
    stopAvatarManifestSync();
  }
}

$("#pinInput").addEventListener("input", event => {
  event.target.value =
    event.target.value.replace(/\D/g, "").slice(0, 6);

  $("#loginMessage").className = "login-message";
  $("#loginMessage").textContent =
    "STATUS: AWAITING AUTHORIZATION";
});

$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();

  const input = $("#pinInput");
  const message = $("#loginMessage");
  const button = $("#loginButton");

  if (!/^\d{6}$/.test(input.value)) {
    message.textContent =
      "ACCESS DENIED: PIN wajib 6 digit.";
    message.classList.add("error");
    return;
  }

  button.disabled = true;
  message.textContent = "AUTHENTICATING...";

  try {
    const hash = await sha256Text(input.value);

    if (hash !== PIN_SHA256) {
      input.value = "";
      message.textContent =
        "ACCESS DENIED: PIN salah.";
      message.classList.add("error");
      return;
    }

    setAuthorized(true);
    input.value = "";

    showToast({
      type: "success",
      title: "Access granted",
      message: "Dashboard operator berhasil dibuka."
    });

    await syncState({
      action: "state",
      manual: false
    });
  } finally {
    button.disabled = false;
  }
});

$("#logoutButton").addEventListener("click", () => {
  setAuthorized(false);
  $("#pinInput").value = "";
  $("#loginMessage").textContent =
    "STATUS: SESSION CLOSED";
});

function renderAccountList() {
  const accounts = allAccountEntries();

  $("#accountMiniList").innerHTML =
    accounts.map(account => {
      const profile = account.profile || {};
      const level = formatNumber(profile.level);

      return `
        <button
          class="account-mini ${
            account.slug === state.selectedSlug
              ? "active"
              : ""
          }"
          type="button"
          data-account="${escapeHtml(account.slug)}">
          <span class="account-mini-name">
            ${escapeHtml(
              profile.name ||
              "—"
            )}
          </span>
          <span class="account-mini-meta">
            UID ${escapeHtml(
              profile.uid ||
              "—"
            )}<br>
            ${escapeHtml(
              account.server_name || "—"
            )}
            • Lv.${escapeHtml(level)}
          </span>
        </button>
      `;
    }).join("");

  $$(".account-mini").forEach(button => {
    button.addEventListener("click", () => {
      state.selectedSlug = button.dataset.account;

      localStorage.setItem(
        SELECTED_ACCOUNT_KEY,
        state.selectedSlug
      );

      renderAccountList();
      renderSelectedAccount();
      closeSidebar();
    });
  });
}

async function loadAvatarManifest({
  force = false
} = {}) {
  try {
    const response = await fetch(
      `./avatar-manifest.json?v=${Date.now()}`,
      {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache"
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `Avatar manifest HTTP ${response.status}`
      );
    }

    const manifest = await response.json();
    const nextVersion =
      manifest?.generated_at ||
      JSON.stringify(manifest?.accounts || {});

    const changed =
      state.avatarManifestVersion !== null &&
      nextVersion !== state.avatarManifestVersion;

    state.avatarManifest = manifest;
    state.avatarManifestVersion = nextVersion;

    if (changed || force) {
      renderSelectedAccount();
    }

    return manifest;
  } catch (error) {
    console.warn(
      "[AVATAR] Manifest belum tersedia:",
      error
    );

    return null;
  }
}

function getGeneratedAvatarUrl(slug) {
  const account =
    state.avatarManifest?.accounts?.[slug];

  if (
    !account ||
    account.available !== true ||
    !account.sha256
  ) {
    return "";
  }

  return (
    `./assets/avatars/${encodeURIComponent(slug)}.png` +
    `?v=${encodeURIComponent(account.sha256)}`
  );
}

function startAvatarManifestSync() {
  stopAvatarManifestSync();

  state.avatarManifestTimer = setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      sessionStorage.getItem(SESSION_KEY) === "1"
    ) {
      loadAvatarManifest();
    }
  }, 30000);
}

function stopAvatarManifestSync() {
  if (state.avatarManifestTimer !== null) {
    clearInterval(state.avatarManifestTimer);
    state.avatarManifestTimer = null;
  }
}

function renderAvatar(profile, account) {
  const image = $("#profileAvatarImage");
  const fallback = $("#profileAvatarFallback");

  const candidates = [
    getGeneratedAvatarUrl(account.slug),
    String(profile?.avatar_url || "").trim()
  ].filter(Boolean);

  const candidatesKey =
    candidates.join("|");

  /*
   * Bila kandidat avatar tidak berubah dan gambar sudah tampil,
   * jangan reset src. Ini mencegah download/flicker setiap 5 detik.
   */
  if (
    candidatesKey &&
    image.dataset.avatarCandidates === candidatesKey &&
    !image.hidden &&
    image.complete &&
    image.naturalWidth > 0
  ) {
    fallback.hidden = true;
    return;
  }

  image.dataset.avatarCandidates =
    candidatesKey;

  let candidateIndex = 0;

  const showFallback = () => {
    image.onload = null;
    image.onerror = null;
    image.hidden = true;
    fallback.hidden = false;
    image.removeAttribute("src");
    image.removeAttribute("data-avatar-source");
  };

  const tryNextCandidate = () => {
    if (candidateIndex >= candidates.length) {
      showFallback();
      return;
    }

    const sourceIndex = candidateIndex;
    const nextUrl = candidates[candidateIndex];
    candidateIndex += 1;

    image.onload = () => {
      fallback.hidden = true;
      image.hidden = false;
      image.setAttribute(
        "data-avatar-source",
        sourceIndex === 0
          ? "endfield-cards"
          : "game-api"
      );
    };

    image.onerror = () => {
      tryNextCandidate();
    };

    image.hidden = true;
    fallback.hidden = false;
    image.src = nextUrl;
  };

  if (candidates.length === 0) {
    showFallback();
    return;
  }

  tryNextCandidate();
}

function renderTask(prefix, task) {
  const current = Number(task?.current ?? 0);
  const maximum = Number(task?.max ?? 0);

  $(`#${prefix}Current`).textContent =
    task ? formatNumber(current, "0") : "—";

  $(`#${prefix}Max`).textContent =
    task ? formatNumber(maximum, "0") : "—";

  setProgress(
    $(`#${prefix}Progress`),
    current,
    maximum
  );
}

function clearCountdown() {
  if (state.countdownTimer !== null) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
}

function formatDuration(milliseconds) {
  if (
    !Number.isFinite(milliseconds) ||
    milliseconds <= 0
  ) {
    return "00:00:00";
  }

  const totalSeconds =
    Math.max(0, Math.floor(milliseconds / 1000));

  const hours = Math.floor(totalSeconds / 3600);
  const minutes =
    Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0")
  ].join(":");
}

function startSanityCountdown(sanity) {
  clearCountdown();

  if (!sanity) {
    $("#sanityRecoveryText").textContent =
      "Live stamina data unavailable";
    $("#sanityRecoveryTime").textContent = "—";
    return;
  }

  const current = Number(sanity.current ?? 0);
  const maximum = Number(sanity.max ?? 0);
  const recoverAt = sanity.full_recover_at;

  if (maximum > 0 && current >= maximum) {
    $("#sanityRecoveryText").textContent =
      "Stamina is full";
    $("#sanityRecoveryTime").textContent = "FULL";
    return;
  }

  if (!recoverAt) {
    $("#sanityRecoveryText").textContent =
      "Full recovery time unavailable";
    $("#sanityRecoveryTime").textContent = "—";
    return;
  }

  const recoverDate = new Date(recoverAt);

  if (Number.isNaN(recoverDate.getTime())) {
    $("#sanityRecoveryText").textContent =
      "Full recovery time unavailable";
    $("#sanityRecoveryTime").textContent = "—";
    return;
  }

  const update = () => {
    const remaining =
      recoverDate.getTime() - Date.now();

    if (remaining <= 0) {
      $("#sanityRecoveryText").textContent =
        "Stamina should be full • waiting for next sync";
      $("#sanityRecoveryTime").textContent =
        "00:00:00";
      clearCountdown();
      return;
    }

    const duration = formatDuration(remaining);

    $("#sanityRecoveryText").textContent =
      `${duration} until stamina is full`;

    $("#sanityRecoveryTime").textContent =
      duration;
  };

  update();

  state.countdownTimer =
    setInterval(update, 1000);
}

function setSourceStatus(element, ok, stale = false) {
  element.className = "";

  if (ok && !stale) {
    element.textContent = "Online";
    element.classList.add("status-ok");
    return;
  }

  if (ok && stale) {
    element.textContent = "Cached / stale";
    element.classList.add("status-warning");
    return;
  }

  element.textContent = "Unavailable";
  element.classList.add("status-error");
}

function renderSelectedAccount() {
  const account = selectedAccount();
  const profile = account.profile || {};
  const live = account.live || {};
  const sanity = live.sanity || null;

  renderAvatar(profile, account);

  $("#profileName").textContent =
    profile.name || "—";

  $("#profileLevelLabel").textContent =
    `Lv.${formatNumber(profile.level)}`;

  $("#profileUid").textContent =
    profile.uid || "—";

  $("#profileServer").textContent =
    account.server_name || "—";

  $("#operatorCount").textContent =
    formatNumber(profile.operator_count);

  $("#authorityLevel").textContent =
    formatNumber(profile.level);

  $("#explorationLevel").textContent =
    formatNumber(profile.exploration_level);

  const sanityCurrent =
    sanity ? Number(sanity.current ?? 0) : null;

  const sanityMax =
    sanity ? Number(sanity.max ?? 0) : null;

  $("#sanityCurrent").textContent =
    sanity ? formatNumber(sanityCurrent, "0") : "—";

  $("#sanityMax").textContent =
    sanity ? formatNumber(sanityMax, "0") : "—";

  setProgress(
    $("#sanityProgress"),
    sanityCurrent,
    sanityMax
  );

  startSanityCountdown(sanity);

  renderTask("daily", live.daily_activity);
  renderTask("weekly", live.weekly_routine);
  renderTask("protocol", live.protocol_pass);

  $("#dataUpdatedAt").textContent =
    formatDateWib(
      account.live_updated_at ||
      account.profile_updated_at ||
      state.data?.checked_at ||
      state.data?.updated_at,
      true
    );

  $("#selectedAccountStatus").textContent =
    profile.name || "—";

  setSourceStatus(
    $("#profileSourceStatus"),
    Boolean(account.profile_available),
    Boolean(account.profile_stale)
  );

  setSourceStatus(
    $("#liveSourceStatus"),
    Boolean(account.live_available),
    Boolean(account.live_stale)
  );

  const errors =
    Array.isArray(account.errors)
      ? account.errors.filter(Boolean)
      : [];

  const errorsElement = $("#sourceErrors");

  if (errors.length > 0) {
    errorsElement.hidden = false;
    errorsElement.textContent =
      errors.map(error => `• ${error}`).join("\n");
  } else {
    errorsElement.hidden = true;
    errorsElement.textContent = "";
  }

}

function readJsonStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);

    if (!value) {
      return fallback;
    }

    return JSON.parse(value);
  } catch (error) {
    console.warn(
      `[STORAGE] Gagal membaca ${key}:`,
      error
    );

    return fallback;
  }
}

function loadNotificationStorage() {
  const storedNotifications =
    readJsonStorage(
      NOTIFICATION_STORAGE_KEY,
      []
    );

  const storedConditions =
    readJsonStorage(
      NOTIFICATION_CONDITION_KEY,
      {}
    );

  state.notifications =
    Array.isArray(storedNotifications)
      ? storedNotifications
          .filter(item =>
            item &&
            typeof item === "object" &&
            item.id
          )
          .slice(0, MAX_NOTIFICATION_HISTORY)
      : [];

  state.notificationConditions =
    storedConditions &&
    typeof storedConditions === "object"
      ? storedConditions
      : {};
}

function saveNotificationStorage() {
  try {
    localStorage.setItem(
      NOTIFICATION_STORAGE_KEY,
      JSON.stringify(
        state.notifications.slice(
          0,
          MAX_NOTIFICATION_HISTORY
        )
      )
    );

    localStorage.setItem(
      NOTIFICATION_CONDITION_KEY,
      JSON.stringify(
        state.notificationConditions
      )
    );
  } catch (error) {
    console.warn(
      "[STORAGE] Gagal menyimpan notifikasi:",
      error
    );
  }
}

function getWibDateKey(date = new Date()) {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Asia/Jakarta",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    ).formatToParts(date);

  const values =
    Object.fromEntries(
      parts.map(part => [
        part.type,
        part.value
      ])
    );

  return (
    `${values.year}-` +
    `${values.month}-` +
    `${values.day}`
  );
}

function getNotificationIconSvg(type) {
  if (type === "energy") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m13 2-8 12h6l-1 8 9-13h-6l0-7Z"></path>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 3h14v18H5z"></path>
      <path d="M8 7h8M8 11h8M8 15h4"></path>
      <path d="m14.5 16.5 1.5 1.5 3-3"></path>
    </svg>
  `;
}

function formatNotificationTime(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString(
    "id-ID",
    {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    }
  ) + " WIB";
}

function unreadNotificationCount() {
  return state.notifications.filter(
    notification => !notification.read
  ).length;
}

function updateDeviceNotificationButton() {
  const button =
    $("#enableDeviceNotifications");

  if (!button) {
    return;
  }

  if (!("Notification" in window)) {
    button.textContent =
      "Notifikasi perangkat tidak didukung";
    button.disabled = true;
    return;
  }

  if (Notification.permission === "granted") {
    button.textContent =
      "Notifikasi perangkat aktif";
    button.disabled = true;
    return;
  }

  if (Notification.permission === "denied") {
    button.textContent =
      "Notifikasi perangkat diblokir";
    button.disabled = true;
    return;
  }

  button.textContent =
    "Aktifkan notifikasi perangkat";
  button.disabled = false;
}

function renderNotificationCenter() {
  const badge =
    $("#notificationBadge");

  const list =
    $("#notificationList");

  if (!badge || !list) {
    return;
  }

  const unreadCount =
    unreadNotificationCount();

  badge.hidden =
    unreadCount === 0;

  badge.textContent =
    unreadCount > 99
      ? "99+"
      : String(unreadCount);

  if (state.notifications.length === 0) {
    list.innerHTML = `
      <div class="notification-empty">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"></path>
          <path d="M10 21h4"></path>
        </svg>
        <strong>Belum ada notifikasi</strong>
        <span>
          Peringatan energi penuh dan Activity Point 0/100
          akan muncul di sini.
        </span>
      </div>
    `;

    updateDeviceNotificationButton();
    return;
  }

  list.innerHTML =
    state.notifications.map(notification => `
      <button
        class="notification-item ${
          escapeHtml(notification.type)
        } ${
          notification.read
            ? "read"
            : "unread"
        }"
        type="button"
        data-notification-id="${
          escapeHtml(notification.id)
        }">
        <span class="notification-item-icon">
          ${getNotificationIconSvg(
            notification.type
          )}
        </span>

        <span class="notification-item-copy">
          <span class="notification-item-title">
            ${escapeHtml(notification.title)}
          </span>

          <span class="notification-item-message">
            ${escapeHtml(notification.message)}
          </span>

          <span class="notification-item-time">
            ${escapeHtml(
              formatNotificationTime(
                notification.createdAt
              )
            )}
          </span>
        </span>
      </button>
    `).join("");

  list
    .querySelectorAll(
      "[data-notification-id]"
    )
    .forEach(button => {
      button.addEventListener(
        "click",
        () => {
          markNotificationRead(
            button.dataset.notificationId
          );
        }
      );
    });

  updateDeviceNotificationButton();
}

function markNotificationRead(id) {
  let changed = false;

  state.notifications =
    state.notifications.map(notification => {
      if (
        notification.id === id &&
        !notification.read
      ) {
        changed = true;

        return {
          ...notification,
          read: true
        };
      }

      return notification;
    });

  if (changed) {
    saveNotificationStorage();
    renderNotificationCenter();
  }
}

function markAllNotificationsRead() {
  let changed = false;

  state.notifications =
    state.notifications.map(notification => {
      if (!notification.read) {
        changed = true;

        return {
          ...notification,
          read: true
        };
      }

      return notification;
    });

  if (changed) {
    saveNotificationStorage();
    renderNotificationCenter();
  }
}

function clearNotificationHistory() {
  state.notifications = [];
  saveNotificationStorage();
  renderNotificationCenter();
}

function toggleNotificationPanel(forceOpen) {
  const panel =
    $("#notificationPanel");

  const button =
    $("#notificationButton");

  if (!panel || !button) {
    return;
  }

  const nextOpen =
    typeof forceOpen === "boolean"
      ? forceOpen
      : !state.notificationPanelOpen;

  state.notificationPanelOpen =
    nextOpen;

  panel.hidden =
    !nextOpen;

  document.body.classList.toggle(
    "notification-open",
    nextOpen
  );

  button.setAttribute(
    "aria-expanded",
    String(nextOpen)
  );
}

async function requestDeviceNotifications() {
  if (!("Notification" in window)) {
    return;
  }

  try {
    const permission =
      await Notification.requestPermission();

    updateDeviceNotificationButton();

    if (permission === "granted") {
      showToast({
        type: "success",
        title: "Notifikasi perangkat aktif",
        message:
          "Peringatan Endfield dapat muncul sebagai notifikasi browser.",
        duration: 3600
      });
    } else {
      showToast({
        type: "warning",
        title: "Izin tidak diberikan",
        message:
          "Notifikasi tetap tersimpan di ikon lonceng dashboard.",
        duration: 4200
      });
    }
  } catch (error) {
    console.warn(
      "[NOTIFICATION] Permission error:",
      error
    );
  }
}

function showDeviceNotification(
  title,
  message,
  tag
) {
  if (
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return;
  }

  try {
    const notification =
      new Notification(
        title,
        {
          body: message,
          icon: DEVICE_NOTIFICATION_ICON,
          badge: DEVICE_NOTIFICATION_ICON,
          tag: tag,
          renotify: false
        }
      );

    notification.onclick = () => {
      window.focus();
      toggleNotificationPanel(true);
      notification.close();
    };
  } catch (error) {
    console.warn(
      "[NOTIFICATION] Browser notification gagal:",
      error
    );
  }
}

function addGameNotification({
  type,
  accountSlug,
  title,
  message,
  toastType = "warning"
}) {
  const notification = {
    id:
      `${Date.now()}-` +
      `${Math.random().toString(36).slice(2)}`,
    type,
    accountSlug,
    title,
    message,
    createdAt:
      new Date().toISOString(),
    read: false
  };

  state.notifications = [
    notification,
    ...state.notifications
  ].slice(0, MAX_NOTIFICATION_HISTORY);

  saveNotificationStorage();
  renderNotificationCenter();

  showToast({
    type: toastType,
    title,
    message,
    duration: 6500
  });

  showDeviceNotification(
    title,
    message,
    `${type}-${accountSlug}`
  );
}

function cleanupOldActivityConditions(todayKey) {
  Object.keys(
    state.notificationConditions
  ).forEach(key => {
    if (
      key.startsWith("activity-zero:") &&
      !key.endsWith(`:${todayKey}`)
    ) {
      delete state.notificationConditions[key];
    }
  });
}

function evaluateGameNotifications(
  dashboardState
) {
  const accounts =
    dashboardState?.accounts;

  if (
    !accounts ||
    typeof accounts !== "object"
  ) {
    return;
  }

  const todayKey =
    getWibDateKey();

  cleanupOldActivityConditions(
    todayKey
  );

  FALLBACK_ACCOUNTS.forEach(fallback => {
    const account =
      accounts[fallback.slug];

    const profile =
      account?.profile;

    const live =
      account?.live;

    if (!profile || !live) {
      return;
    }

    const accountName =
      String(
        profile.name ||
        account.display_name ||
        fallback.slug
      );

    const sanityCurrent =
      Number(live.sanity?.current);

    const sanityMax =
      Number(live.sanity?.max);

    const energyFull =
      Number.isFinite(sanityCurrent) &&
      Number.isFinite(sanityMax) &&
      sanityMax > 0 &&
      sanityCurrent >= sanityMax;

    const energyConditionKey =
      `energy-full:${fallback.slug}`;

    const energyWasFull =
      state.notificationConditions[
        energyConditionKey
      ] === true;

    if (
      energyFull &&
      !energyWasFull
    ) {
      addGameNotification({
        type: "energy",
        accountSlug: fallback.slug,
        title: "Energi sudah penuh",
        message:
          `${accountName}: energi telah penuh ` +
          `(${sanityCurrent}/${sanityMax}).`,
        toastType: "success"
      });
    }

    /*
     * Kondisi di-reset ketika energi dipakai.
     * Siklus penuh berikutnya dapat membuat notifikasi baru.
     */
    state.notificationConditions[
      energyConditionKey
    ] = energyFull;

    const activityCurrent =
      Number(
        live.daily_activity?.current
      );

    const activityMax =
      Number(
        live.daily_activity?.max
      );

    const activityIsZero =
      Number.isFinite(activityCurrent) &&
      Number.isFinite(activityMax) &&
      activityCurrent === 0 &&
      activityMax === 100;

    const activityConditionKey =
      `activity-zero:` +
      `${fallback.slug}:` +
      `${todayKey}`;

    if (
      activityIsZero &&
      state.notificationConditions[
        activityConditionKey
      ] !== true
    ) {
      addGameNotification({
        type: "activity",
        accountSlug: fallback.slug,
        title: "Activity Point masih 0/100",
        message:
          `${accountName}: aktivitas harian belum dikerjakan.`,
        toastType: "warning"
      });

      state.notificationConditions[
        activityConditionKey
      ] = true;
    }
  });

  saveNotificationStorage();
}

function bindNotificationCenter() {
  $("#notificationButton")
    .addEventListener(
      "click",
      event => {
        event.stopPropagation();
        toggleNotificationPanel();
      }
    );

  $("#notificationPanel")
    .addEventListener(
      "click",
      event => {
        event.stopPropagation();
      }
    );

  $("#markAllNotificationsRead")
    .addEventListener(
      "click",
      markAllNotificationsRead
    );

  $("#clearNotifications")
    .addEventListener(
      "click",
      clearNotificationHistory
    );

  $("#enableDeviceNotifications")
    .addEventListener(
      "click",
      requestDeviceNotifications
    );

  document.addEventListener(
    "click",
    () => {
      if (state.notificationPanelOpen) {
        toggleNotificationPanel(false);
      }
    }
  );

  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Escape" &&
        state.notificationPanelOpen
      ) {
        toggleNotificationPanel(false);
      }
    }
  );
}

function createDataSignature(dashboardState) {
  const accounts = dashboardState?.accounts || {};

  const comparable = FALLBACK_ACCOUNTS.map(fallback => {
    const account = accounts[fallback.slug] || {};
    const profile = account.profile || {};
    const live = account.live || {};
    const sanity = live.sanity || {};
    const daily = live.daily_activity || {};
    const weekly = live.weekly_routine || {};
    const protocol = live.protocol_pass || {};

    return {
      slug: fallback.slug,
      display_name:
        account.display_name ?? null,
      server_name:
        account.server_name ?? null,
      profile: {
        name: profile.name ?? null,
        uid: profile.uid ?? account.uid ?? null,
        level: profile.level ?? null,
        exploration_level:
          profile.exploration_level ?? null,
        operator_count:
          profile.operator_count ?? null,
        avatar_url:
          profile.avatar_url ?? null
      },
      live: {
        sanity: {
          current: sanity.current ?? null,
          max: sanity.max ?? null,
          full_recover_at:
            sanity.full_recover_at ?? null
        },
        daily_activity: {
          current: daily.current ?? null,
          max: daily.max ?? null
        },
        weekly_routine: {
          current: weekly.current ?? null,
          max: weekly.max ?? null
        },
        protocol_pass: {
          current: protocol.current ?? null,
          max: protocol.max ?? null
        }
      }
    };
  });

  return JSON.stringify(comparable);
}

function pulseNetworkUpdate() {
  const indicator = $("#networkIndicator");

  if (!indicator) {
    return;
  }

  indicator.classList.add("data-update");

  if (state.networkPulseTimer !== null) {
    clearTimeout(state.networkPulseTimer);
  }

  state.networkPulseTimer = setTimeout(() => {
    indicator.classList.remove("data-update");
    state.networkPulseTimer = null;
  }, 4200);
}

function renderSelectedAccountSyncMeta() {
  const account = selectedAccount();
  const profile = account.profile || {};

  $("#browserRefreshAt").textContent =
    browserTimeWib();

  $("#dataUpdatedAt").textContent =
    formatDateWib(
      account.live_updated_at ||
      account.profile_updated_at ||
      state.data?.checked_at ||
      state.data?.updated_at,
      true
    );

  $("#selectedAccountStatus").textContent =
    profile.name || "—";

  setSourceStatus(
    $("#profileSourceStatus"),
    Boolean(account.profile_available),
    Boolean(account.profile_stale)
  );

  setSourceStatus(
    $("#liveSourceStatus"),
    Boolean(account.live_available),
    Boolean(account.live_stale)
  );
}

function applyDashboardState(dashboardState, source) {
  const nextSignature =
    createDataSignature(dashboardState);

  const previousSignature =
    state.lastDataSignature;

  const firstLoad =
    previousSignature === null;

  const changed =
    !firstLoad &&
    nextSignature !== previousSignature;

  state.data = dashboardState;
  state.lastRevision =
    dashboardState.revision ??
    dashboardState.updated_at ??
    null;

  state.lastDataSignature =
    nextSignature;

  /*
   * Full render hanya saat pertama load, data berubah, atau refresh manual.
   * Sinkronisasi 5 detik yang nilainya sama cukup memperbarui metadata.
   */
  if (
    firstLoad ||
    changed ||
    source === "manual"
  ) {
    renderAccountList();
    renderSelectedAccount();
  } else {
    renderSelectedAccountSyncMeta();
  }

  evaluateGameNotifications(
    dashboardState
  );

  if (changed) {
    pulseNetworkUpdate();
  }

  return changed;
}

function getOperationButtons(operationName) {
  return (
    OPERATION_BUTTONS[operationName] || []
  )
    .map(selector => $(selector))
    .filter(Boolean);
}

function getButtonOperationLabel(button) {
  const spans =
    Array.from(
      button.querySelectorAll("span")
    );

  return spans.length
    ? spans[spans.length - 1]
    : button;
}

function rememberOriginalButtonLabel(button) {
  if (button.dataset.originalLabel) {
    return;
  }

  const label =
    getButtonOperationLabel(button);

  button.dataset.originalLabel =
    label.textContent.trim();
}

function setButtonOperationLabel(
  button,
  value
) {
  const label =
    getButtonOperationLabel(button);

  label.textContent = value;
}

function operationColorForProgress(progress) {
  /*
   * Perubahan warna:
   * merah → magenta → biru → cyan → hijau.
   */
  const clamped =
    Math.max(0, Math.min(100, progress));

  const hue =
    Math.round(
      350 - clamped * 2.3
    );

  return `hsl(${hue} 94% 58%)`;
}

function paintOperationProgress(
  operationName,
  progress
) {
  const safeProgress =
    Math.max(
      0,
      Math.min(100, progress)
    );

  const rounded =
    Math.floor(safeProgress);

  const color =
    operationColorForProgress(
      safeProgress
    );

  operationProgressState[
    operationName
  ].progress = safeProgress;

  getOperationButtons(
    operationName
  ).forEach(button => {
    rememberOriginalButtonLabel(button);

    button.classList.add("is-loading");
    button.classList.remove(
      "is-success",
      "is-error"
    );

    button.style.setProperty(
      "--operation-progress",
      `${safeProgress}%`
    );

    button.style.setProperty(
      "--operation-color",
      color
    );

    setButtonOperationLabel(
      button,
      `${rounded}%`
    );
  });
}

function startOperationProgress(
  operationName
) {
  const operation =
    operationProgressState[
      operationName
    ];

  if (!operation) {
    return;
  }

  if (operation.timer !== null) {
    clearInterval(operation.timer);
  }

  operation.startedAt =
    performance.now();

  operation.progress = 0;

  paintOperationProgress(
    operationName,
    0
  );

  operation.timer =
    setInterval(() => {
      const elapsed =
        performance.now() -
        operation.startedAt;

      /*
       * Progress diperkirakan karena Google Apps Script tidak
       * mengirim streaming byte/progress. Nilai bergerak cepat
       * di awal lalu menahan maksimal 94% sampai respons tiba.
       */
      const estimated =
        Math.min(
          94,
          94 *
          (
            1 -
            Math.exp(
              -elapsed / 5200
            )
          )
        );

      const nextProgress =
        Math.max(
          operation.progress,
          estimated
        );

      paintOperationProgress(
        operationName,
        nextProgress
      );
    }, 140);
}

function clearOperationTimer(
  operationName
) {
  const operation =
    operationProgressState[
      operationName
    ];

  if (
    operation &&
    operation.timer !== null
  ) {
    clearInterval(operation.timer);
    operation.timer = null;
  }
}

function restoreOperationButtons(
  operationName
) {
  clearOperationTimer(
    operationName
  );

  getOperationButtons(
    operationName
  ).forEach(button => {
    const originalLabel =
      button.dataset.originalLabel || "";

    button.classList.remove(
      "is-loading",
      "is-success",
      "is-error"
    );

    button.style.removeProperty(
      "--operation-progress"
    );

    button.style.removeProperty(
      "--operation-color"
    );

    if (originalLabel) {
      setButtonOperationLabel(
        button,
        originalLabel
      );
    }
  });

  operationProgressState[
    operationName
  ].progress = 0;
}

async function finishOperationProgress(
  operationName,
  successful
) {
  clearOperationTimer(
    operationName
  );

  const statusClass =
    successful
      ? "is-success"
      : "is-error";

  const statusText =
    successful
      ? "Berhasil"
      : "Gagal";

  const statusColor =
    successful
      ? "#35e58b"
      : "#ff3048";

  getOperationButtons(
    operationName
  ).forEach(button => {
    rememberOriginalButtonLabel(button);

    button.classList.remove(
      "is-loading",
      "is-success",
      "is-error"
    );

    button.classList.add(
      statusClass
    );

    button.style.setProperty(
      "--operation-progress",
      "100%"
    );

    button.style.setProperty(
      "--operation-color",
      statusColor
    );

    setButtonOperationLabel(
      button,
      statusText
    );
  });

  await new Promise(resolve => {
    setTimeout(resolve, 3000);
  });

  restoreOperationButtons(
    operationName
  );
}

function setRefreshButtonsDisabled(disabled) {
  [
    "#refreshButton",
    "#sidebarRefreshButton"
  ].forEach(selector => {
    const button = $(selector);

    if (!button) {
      return;
    }

    button.disabled = disabled;
    button.setAttribute(
      "aria-busy",
      String(disabled)
    );
  });
}

async function syncState({
  action = "state",
  manual = false
} = {}) {
  if (state.requestInProgress) {
    return;
  }

  state.requestInProgress = true;
  let manualSuccessful = false;

  if (manual) {
    setRefreshButtonsDisabled(true);
    startOperationProgress("refresh");
  }

  try {
    const payload = await gasRequest(action);

    if (manual) {
      await loadAvatarManifest({
        force: true
      });
    }

    const dashboardState =
      normalizeDashboardPayload(payload);

    const changed = applyDashboardState(
      dashboardState,
      manual ? "manual" : "automatic"
    );

    if (manual) {
      manualSuccessful = true;

      showToast({
        type: "success",
        title: "Manual refresh selesai",
        message:
          "Level, Operator, Exploration, Stamina, dan Activity sudah diperiksa."
      });
    }
  } catch (error) {
    console.error("[SYNC]", error);

    $("#cacheBadge").textContent =
      "SYNC • ERROR";

    if (manual || !state.data) {
      showToast({
        type: "error",
        title: "Sinkronisasi gagal",
        message:
          error?.message ||
          "Tidak dapat membaca data Google Apps Script.",
        duration: 8000
      });
    }
  } finally {
    if (manual) {
      await finishOperationProgress(
        "refresh",
        manualSuccessful
      );

      setRefreshButtonsDisabled(false);
    }

    state.requestInProgress = false;
  }
}

function startAutoSync() {
  stopAutoSync();

  state.autoTimer = setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      sessionStorage.getItem(SESSION_KEY) === "1"
    ) {
      syncState({
        action: "state",
        manual: false
      });
    }
  }, AUTO_SYNC_MS);
}

function stopAutoSync() {
  if (state.autoTimer !== null) {
    clearInterval(state.autoTimer);
    state.autoTimer = null;
  }
}

function closeSidebar() {
  $("#sidebar").classList.remove("open");
}

$("#mobileMenuButton").addEventListener(
  "click",
  () => $("#sidebar").classList.toggle("open")
);

[
  "#refreshButton",
  "#sidebarRefreshButton"
].forEach(selector => {
  $(selector).addEventListener(
    "click",
    () => syncState({
      action: "sync",
      manual: true
    })
  );
});

function setCheckinState(disabled) {
  [
    "#checkinButton",
    "#sidebarCheckinButton"
  ].forEach(selector => {
    const button = $(selector);

    if (!button) {
      return;
    }

    button.disabled = disabled;
    button.setAttribute(
      "aria-busy",
      String(disabled)
    );
  });
}

function cleanStatusText(value) {
  return String(value || "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/✅|❌|☑️|⚠️/g, "")
    .trim();
}

function summarizeCheckinResponse(response) {
  if (
    !response?.success ||
    !Array.isArray(response.data)
  ) {
    return {
      type: "error",
      title: "Check-in failed",
      message:
        response?.message ||
        "Respons Google Apps Script tidak valid."
    };
  }

  const rows = response.data.map(item => {
    const name =
      item.accountName || "Unknown";

    const text =
      cleanStatusText(
        item.statusMsg || "Tidak ada status."
      );

    const isError =
      Boolean(item.isError);

    return {
      name,
      text,
      isError,
      already:
        /sudah pernah|already|hasToday/i.test(text)
    };
  });

  const hasError =
    rows.some(row => row.isError);

  const allAlready =
    rows.length > 0 &&
    rows.every(
      row => row.already && !row.isError
    );

  if (hasError) {
    return {
      type: "error",
      title: "Some accounts failed",
      message: rows
        .map(row =>
          `${row.isError ? "✕" : "✓"} ` +
          `${row.name}: ${row.text}`
        )
        .join("\n")
    };
  }

  if (allAlready) {
    return {
      type: "info",
      title: "Already checked in today",
      message: rows
        .map(row =>
          `${row.name}: sudah check-in.`
        )
        .join("\n")
    };
  }

  return {
    type: "success",
    title: "Check-in completed",
    message: rows
      .map(row =>
        `${row.name}: ${row.text}`
      )
      .join("\n")
  };
}

async function runCheckin() {
  if (state.checkingIn) return;

  state.checkingIn = true;
  let checkinSuccessful = false;

  setCheckinState(true);
  startOperationProgress("checkin");

  showToast({
    type: "info",
    title: "Check-in processing",
    message:
      "Menghubungkan seluruh akun ke layanan attendance Endfield.",
    duration: 3500
  });

  try {
    const response = await gasRequest("run");
    const summary =
      summarizeCheckinResponse(response);

    checkinSuccessful =
      summary.type !== "error";

    showToast({
      type: summary.type,
      title: summary.title,
      message: summary.message,
      duration: 8000
    });

    if (response.state?.accounts) {
      applyDashboardState(
        response.state,
        "manual"
      );
    } else {
      setTimeout(() => {
        syncState({
          action: "sync",
          manual: false
        });
      }, 1200);
    }
  } catch (error) {
    showToast({
      type: "error",
      title: "Check-in failed",
      message:
        error?.message ||
        "Tidak dapat terhubung ke Google Apps Script.",
      duration: 8000
    });
  } finally {
    await finishOperationProgress(
      "checkin",
      checkinSuccessful
    );

    setCheckinState(false);
    state.checkingIn = false;
  }
}

[
  "#checkinButton",
  "#sidebarCheckinButton"
].forEach(selector => {
  $(selector).addEventListener(
    "click",
    runCheckin
  );
});

function showToast({
  type = "info",
  title,
  message,
  duration = 6000
}) {
  const toast =
    document.createElement("article");

  toast.className =
    `toast ${type === "info" ? "" : type}`.trim();

  const icon =
    type === "success"
      ? "✓"
      : type === "warning"
        ? "!"
        : type === "error"
          ? "✕"
          : "ⓘ";

  toast.innerHTML = `
    <button class="toast-close"
            type="button"
            aria-label="Tutup">×</button>
    <div class="toast-title">
      <span>${icon}</span>
      <span>${escapeHtml(title)}</span>
    </div>
    <div class="toast-message">
      ${escapeHtml(message)}
    </div>
    <div class="toast-progress"
         style="animation-duration:${duration}ms"></div>
  `;

  $("#toastRegion").appendChild(toast);

  const remove = () => {
    toast.style.opacity = "0";
    toast.style.transform =
      "translateX(12px)";
    toast.style.transition =
      "0.18s ease";

    setTimeout(() => toast.remove(), 180);
  };

  toast
    .querySelector(".toast-close")
    .addEventListener("click", remove);

  setTimeout(remove, duration);
}

async function copyTextToClipboard(text) {
  const value = String(text || "").trim();

  if (!value || value === "—") {
    throw new Error("UID belum tersedia.");
  }

  if (
    navigator.clipboard &&
    window.isSecureContext
  ) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Clipboard tidak tersedia.");
  }
}

async function copyCurrentUid() {
  const uidElement = $("#profileUid");
  const uid = uidElement?.textContent?.trim() || "";

  try {
    await copyTextToClipboard(uid);

    uidElement.classList.add("copied");

    if (state.copyLabelTimer !== null) {
      clearTimeout(state.copyLabelTimer);
    }

    state.copyLabelTimer = setTimeout(() => {
      uidElement.classList.remove("copied");
      state.copyLabelTimer = null;
    }, 5000);

    showToast({
      type: "success",
      title: "UID copied",
      message: `UID ${uid} berhasil disalin.`,
      duration: 2200
    });
  } catch (error) {
    showToast({
      type: "warning",
      title: "UID belum dapat disalin",
      message:
        error?.message ||
        "Data UID belum tersedia.",
      duration: 3200
    });
  }
}

function bindCopyUidInteraction() {
  const uidElement = $("#profileUid");

  if (!uidElement) {
    return;
  }

  uidElement.addEventListener(
    "click",
    copyCurrentUid
  );

  uidElement.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        copyCurrentUid();
      }
    }
  );
}

async function initialize() {
  loadNotificationStorage();
  bindNotificationCenter();
  renderNotificationCenter();

  await loadAvatarManifest();

  renderAccountList();
  renderSelectedAccount();
  bindCopyUidInteraction();

  const authorized =
    sessionStorage.getItem(SESSION_KEY) === "1";

  setAuthorized(authorized);

  if (authorized) {
    await syncState({
      action: "state",
      manual: false
    });
  }

  document.addEventListener(
    "visibilitychange",
    () => {
      if (!document.hidden) {
        if (
          sessionStorage.getItem(SESSION_KEY) === "1"
        ) {
          syncState({
            action: "state",
            manual: false
          });

          loadAvatarManifest();
        }
      }
    }
  );

  window.addEventListener(
    "beforeunload",
    () => {
      stopAutoSync();
      stopAvatarManifestSync();
    }
  );
}

initialize();
