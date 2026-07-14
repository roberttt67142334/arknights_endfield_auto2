"use strict";

const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbwveP6XYC6ygqYXKqRQalQ-EEb3xJq-QCF09Ifk6RVbRdKABafKHcOZa5RgBcdcY7tl/exec";

const PIN_SHA256 =
  "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92";

const SESSION_KEY = "endfield_protocol_authorized";
const SELECTED_ACCOUNT_KEY = "endfield_selected_account";
const AUTO_REFRESH_MS = 10_000;

const FALLBACK_ACCOUNTS = [
  {
    slug: "muzaka",
    display_name: "Muzaka",
    uid: "4468761606",
    server_name: "Asia"
  },
  {
    slug: "orion",
    display_name: "Orion",
    uid: "4896434342",
    server_name: "Asia"
  },
  {
    slug: "naskara",
    display_name: "Naskara",
    uid: "4367542843",
    server_name: "Asia"
  }
];

const state = {
  selectedSlug:
    localStorage.getItem(SELECTED_ACCOUNT_KEY) ||
    FALLBACK_ACCOUNTS[0].slug,
  data: null,
  refreshing: false,
  checkingIn: false,
  refreshTimer: null,
  countdownTimer: null
};

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function clampPercent(current, maximum) {
  const currentValue = Number(current);
  const maxValue = Number(maximum);

  if (!Number.isFinite(currentValue) ||
      !Number.isFinite(maxValue) ||
      maxValue <= 0) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(100, (currentValue / maxValue) * 100)
  );
}

function setProgress(element, current, maximum) {
  element.style.width =
    `${clampPercent(current, maximum)}%`;
}

function formatNumber(value, fallback = "—") {
  const number = Number(value);
  return Number.isFinite(number)
    ? String(number)
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
  const dataAccounts = state.data?.accounts;

  return FALLBACK_ACCOUNTS.map(fallback => ({
    ...fallback,
    ...(dataAccounts?.[fallback.slug] || {})
  }));
}

function selectedAccount() {
  return (
    allAccountEntries()
      .find(account => account.slug === state.selectedSlug) ||
    allAccountEntries()[0]
  );
}

function setAuthorized(authorized) {
  $("#loginLayer").hidden = authorized;

  if (authorized) {
    sessionStorage.setItem(SESSION_KEY, "1");
    resumeBackgroundVideo();
  } else {
    sessionStorage.removeItem(SESSION_KEY);
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

    await refreshDashboard({ manual: true });
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
              account.display_name ||
              account.slug
            )}
          </span>
          <span class="account-mini-meta">
            UID ${escapeHtml(account.uid || profile.uid || "—")}<br>
            ${escapeHtml(account.server_name || "Asia")}
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
  const displayName =
    profile?.name ||
    account.display_name ||
    account.slug ||
    "?";

  fallback.textContent =
    displayName.slice(0, 1).toUpperCase();

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
    formatNumber(current, "0");
  $(`#${prefix}Max`).textContent =
    formatNumber(maximum, "0");

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
  if (!Number.isFinite(milliseconds) ||
      milliseconds <= 0) {
    return "00:00:00";
  }

  const totalSeconds =
    Math.max(0, Math.floor(milliseconds / 1000));
  const hours =
    Math.floor(totalSeconds / 3600);
  const minutes =
    Math.floor((totalSeconds % 3600) / 60);
  const seconds =
    totalSeconds % 60;

  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0")
  ].join(":");
}

function startSanityCountdown(sanity) {
  clearCountdown();

  const current = Number(sanity?.current ?? 0);
  const maximum = Number(sanity?.max ?? 0);
  const recoverAt = sanity?.full_recover_at;

  if (maximum > 0 && current >= maximum) {
    $("#sanityRecoveryText").textContent =
      "Stamina is full";
    $("#sanityRecoveryTime").textContent =
      "FULL";
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
        "Stamina should be full • refresh data";
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
    window.setInterval(update, 1000);
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
  const sanity = live.sanity || {};

  renderAvatar(profile, account);

  $("#profileName").textContent =
    profile.name ||
    account.display_name ||
    account.slug ||
    "Unknown";

  $("#profileLevelLabel").textContent =
    `Lv.${formatNumber(profile.level)}`;

  $("#profileUid").textContent =
    profile.uid ||
    account.uid ||
    "—";

  $("#operatorCount").textContent =
    formatNumber(profile.operator_count);

  $("#authorityLevel").textContent =
    formatNumber(profile.level);

  $("#explorationLevel").textContent =
    formatNumber(profile.exploration_level);

  const sanityCurrent =
    Number(sanity.current ?? 0);
  const sanityMax =
    Number(sanity.max ?? 0);

  $("#sanityCurrent").textContent =
    formatNumber(sanityCurrent, "0");
  $("#sanityMax").textContent =
    formatNumber(sanityMax, "0");

  setProgress(
    $("#sanityProgress"),
    sanityCurrent,
    sanityMax
  );

  startSanityCountdown(sanity);

  renderTask(
    "daily",
    live.daily_activity
  );
  renderTask(
    "weekly",
    live.weekly_routine
  );
  renderTask(
    "protocol",
    live.protocol_pass
  );

  $("#dataUpdatedAt").textContent =
    formatDateWib(state.data?.updated_at, false);

  $("#selectedAccountStatus").textContent =
    account.display_name ||
    profile.name ||
    account.slug;

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

async function loadDashboardData() {
  const cacheBuster =
    `${Date.now()}-${Math.random()}`;

  const response = await fetch(
    `./data/accounts.json?v=${cacheBuster}`,
    {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache"
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `Data dashboard gagal dimuat: HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (!data ||
      typeof data !== "object" ||
      !data.accounts) {
    throw new Error(
      "Struktur data/accounts.json tidak valid."
    );
  }

  return data;
}

function setRefreshState(refreshing) {
  [
    "#refreshButton",
    "#sidebarRefreshButton"
  ].forEach(selector => {
    const button = $(selector);
    if (button) button.disabled = refreshing;
  });

  $("#toolbarInfo").textContent =
    refreshing
      ? "Mengambil data terbaru..."
      : "Auto-refresh data setiap 10 detik.";
}

async function refreshDashboard({
  manual = false
} = {}) {
  if (state.refreshing) return;

  state.refreshing = true;
  setRefreshState(true);

  try {
    state.data = await loadDashboardData();

    $("#cacheBadge").textContent =
      "Cached • latest";

    $("#browserRefreshAt").textContent =
      browserTimeWib();

    renderAccountList();
    renderSelectedAccount();

    if (manual) {
      showToast({
        type: "success",
        title: "Dashboard refreshed",
        message:
          "Data profil, stamina, dan aktivitas terbaru berhasil dimuat."
      });
    }
  } catch (error) {
    console.error(error);

    $("#cacheBadge").textContent =
      "Data unavailable";

    if (manual) {
      showToast({
        type: "error",
        title: "Refresh failed",
        message:
          error?.message ||
          "Tidak dapat memuat data dashboard."
      });
    }
  } finally {
    state.refreshing = false;
    setRefreshState(false);
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
    () => refreshDashboard({ manual: true })
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
  if (!response?.success ||
      !Array.isArray(response.data)) {
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
    const response = await fetch(
      `${WEB_APP_URL}?action=run&t=${Date.now()}`,
      {
        method: "GET",
        redirect: "follow",
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const summary =
      summarizeCheckinResponse(data);

    showToast({
      type: summary.type,
      title: summary.title,
      message: summary.message,
      duration: 8000
    });

    window.setTimeout(
      () => refreshDashboard({ manual: false }),
      1200
    );
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

    window.setTimeout(
      () => toast.remove(),
      180
    );
  };

  toast
    .querySelector(".toast-close")
    .addEventListener("click", remove);

  window.setTimeout(remove, duration);
}

async function resumeBackgroundVideo() {
  const video = $("#backgroundVideo");
  if (!video) return;

  video.style.display = "block";
  video.style.visibility = "visible";
  video.style.opacity = "0.1";

  try {
    await video.play();
  } catch (_) {
    // Autoplay dapat diblokir sampai ada interaksi pengguna.
  }
}

function startAutoRefresh() {
  if (state.refreshTimer !== null) {
    clearInterval(state.refreshTimer);
  }

  state.refreshTimer =
    window.setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        sessionStorage.getItem(SESSION_KEY) === "1"
      ) {
        refreshDashboard({ manual: false });
      }
    }, AUTO_REFRESH_MS);
}

async function initialize() {
  renderAccountList();
  renderSelectedAccount();
  startAutoRefresh();
  resumeBackgroundVideo();

  const authorized =
    sessionStorage.getItem(SESSION_KEY) === "1";

  setAuthorized(authorized);

  if (authorized) {
    await refreshDashboard({ manual: false });
  }

  document.addEventListener(
    "visibilitychange",
    () => {
      if (!document.hidden) {
        resumeBackgroundVideo();

        if (
          sessionStorage.getItem(SESSION_KEY) === "1"
        ) {
          refreshDashboard({ manual: false });
        }
      }
    }
  );

  window.addEventListener(
    "focus",
    resumeBackgroundVideo
  );
}

initialize();
