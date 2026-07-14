"use strict";

const CONFIG = window.ENDFIELD_CONFIG || {};
const GAS_URL = String(CONFIG.gasUrl || "");
const AUTO_SYNC_MS = Math.max(
  15000,
  Number(CONFIG.autoSyncMs || 30000)
);
const REQUEST_TIMEOUT_MS = Math.max(
  30000,
  Number(CONFIG.requestTimeoutMs || 90000)
);
const PIN_SHA256 = String(CONFIG.pinSha256 || "");

const SESSION_KEY = "endfield_protocol_authorized";
const SELECTED_ACCOUNT_KEY = "endfield_selected_account";

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
  copyLabelTimer: null
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
  } else {
    sessionStorage.removeItem(SESSION_KEY);
    stopAutoSync();
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

function renderAvatar(profile, account) {
  const image = $("#profileAvatarImage");
  const fallback = $("#profileAvatarFallback");
  const avatarUrl = profile?.avatar_url || "";

  if (!avatarUrl) {
    image.hidden = true;
    fallback.hidden = false;
    image.removeAttribute("src");
    return;
  }

  image.onload = () => {
    fallback.hidden = true;
    image.hidden = false;
  };

  image.onerror = () => {
    image.hidden = true;
    fallback.hidden = false;
  };

  image.src = avatarUrl;
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
    formatDateWib(state.data?.updated_at, false);

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

  renderAccountList();
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

function applyDashboardState(dashboardState, source) {
  const nextSignature =
    createDataSignature(dashboardState);

  const previousSignature =
    state.lastDataSignature;

  state.data = dashboardState;
  state.lastRevision =
    dashboardState.revision ??
    dashboardState.updated_at ??
    null;

  state.lastDataSignature =
    nextSignature;

  $("#browserRefreshAt").textContent =
    browserTimeWib();

  $("#cacheBadge").textContent =
    source === "manual"
      ? "SYNC • MANUAL"
      : "SYNC • AUTOMATIC";

  renderAccountList();
  renderSelectedAccount();

  const changed =
    previousSignature !== null &&
    nextSignature !== previousSignature;

  if (changed) {
    pulseNetworkUpdate();
  }

  return changed;
}

function setRefreshButtonsDisabled(disabled) {
  [
    "#refreshButton",
    "#sidebarRefreshButton"
  ].forEach(selector => {
    const button = $(selector);
    if (button) {
      button.disabled = disabled;
    }
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

  if (manual) {
    setRefreshButtonsDisabled(true);
  }

  try {
    const payload = await gasRequest(action);
    const dashboardState =
      normalizeDashboardPayload(payload);

    const changed = applyDashboardState(
      dashboardState,
      manual ? "manual" : "automatic"
    );

    if (manual) {
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
    state.requestInProgress = false;

    if (manual) {
      setRefreshButtonsDisabled(false);
    }
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
    if (button) button.disabled = disabled;
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
  setCheckinState(true);

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
    state.checkingIn = false;
    setCheckinState(false);
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
        }
      }
    }
  );

  window.addEventListener(
    "beforeunload",
    stopAutoSync
  );
}

initialize();
