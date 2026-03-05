// ==UserScript==
// @name         Crunchyroll — Player Plus
// @namespace    https://github.com/leorcdias/
// @version      1.4.0
// @description  Adiciona recursos avançados ao player da Crunchyroll para maratonar: pular abertura automático (com contagem e ESC pra cancelar), modo teatro sem distrações (toggle com B), próximo episódio automático com tempo configurável por anime (atalho N para capturar o timing ideal) e Picture-in-Picture (PiP) habilitado.
// @author       Leonardo Dias
// @homepageURL  https://github.com/leorcdias/crunchyroll-player-plus
// @supportURL   https://github.com/leorcdias/crunchyroll-player-plus/issues
// @icon         https://www.google.com/s2/favicons?sz=64&domain=crunchyroll.com
// @match        https://*.crunchyroll.com/*
// @match        https://static.crunchyroll.com/vilos-v2/web/vilos/player.html*
// @run-at       document-idle
// @require      https://code.jquery.com/jquery-3.7.1.min.js
// @downloadURL  https://raw.githubusercontent.com/leorcdias/crunchyroll-player-plus/main/dist/crunchyroll-player-plus.user.js
// @updateURL    https://raw.githubusercontent.com/leorcdias/crunchyroll-player-plus/main/dist/crunchyroll-player-plus.user.js
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// ==/UserScript==

/* global $ */

(function () {
  "use strict";

  const isTop = (window.top === window.self);
  const isPlayerFrame = /static\.crunchyroll\.com\/vilos-v2\/web\/vilos\/player\.html/i.test(location.href);

  // =========================
  // TOP (www.crunchyroll.com)
  // =========================
  const STORAGE_KEY_THEATER_MODE_TOP = "ld_cr_mode_theater_enabled";
  const STORAGE_KEY_NEXT_MAP = "ld_cr_next_by_seconds_map";     // { animeKey: seconds }
  const STORAGE_KEY_START_MAP = "ld_cr_start_at_seconds_map";   // { animeKey: seconds }

  const DEFAULT_THEATER_MODE = true;

  if (isTop && !isPlayerFrame) initTopPage();
  else initPlayerIframe();

  function initTopPage() {
    const state = {
      enabled: loadBool(STORAGE_KEY_THEATER_MODE_TOP, DEFAULT_THEATER_MODE),
      lastUrl: location.href,
    };

    GM_addStyle(`
      html.ld-cr-theater-mode,
      body.ld-cr-theater-mode {
        overflow: hidden !important;
        background: #000 !important;
      }

      .ld-cr-theater-mode .app-layout__header--ywueY,
      .ld-cr-theater-mode .erc-large-header,
      .ld-cr-theater-mode header[data-t="header-default"],
      .ld-cr-theater-mode .app-layout__footer--jgOfu,
      .ld-cr-theater-mode [data-t="footer"],
      .ld-cr-theater-mode .app-layout__aside--IG1cw,
      .ld-cr-theater-mode .banner-wrapper,
      .ld-cr-theater-mode .content-wrapper--MF5LS,
      .ld-cr-theater-mode .videos-wrapper,
      .ld-cr-theater-mode .erc-watch-episode .content-wrapper--MF5LS,
      .ld-cr-theater-mode .erc-watch-episode .videos-wrapper {
        display: none !important;
      }

      .ld-cr-theater-mode .erc-watch-episode,
      .ld-cr-theater-mode .erc-watch-episode-layout {
        margin: 0 !important;
        padding: 0 !important;
        max-width: none !important;
        width: 100% !important;
        background: #000 !important;
      }

      .ld-cr-theater-mode .video-player-wrapper {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 2147483000 !important;
        background: #000 !important;
      }

      .ld-cr-theater-mode .video-player-spacer { display:none !important; }

      .ld-cr-theater-mode iframe.video-player {
        position: absolute !important;
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
        border: 0 !important;
        background: #000 !important;
      }
    `);

    GM_registerMenuCommand("Alternar Modo Teatro (Crunchyroll)", () => toggle());

    window.addEventListener("message", (ev) => {
      if (!ev?.data) return;

      if (ev.data.type === "LD_CR_TOGGLE_THEATER_MODE") toggle();
      if (ev.data.type === "LD_CR_GO_NEXT_EPISODE") goNextEpisode();

      if (ev.data.type === "LD_CR_GET_CFG") {
        sendCfgToIframe(ev.source);
      }

      if (ev.data.type === "LD_CR_SET_NEXT_SECONDS") {
        const animeKey = getAnimeKey();
        if (!animeKey) return;
        const map = loadJson(STORAGE_KEY_NEXT_MAP, {});
        map[animeKey] = clampInt(ev.data.seconds, 0, 600);
        saveJson(STORAGE_KEY_NEXT_MAP, map);
        broadcastCfgToIframe();
      }

      if (ev.data.type === "LD_CR_SET_START_SECONDS") {
        const animeKey = getAnimeKey();
        if (!animeKey) return;
        const map = loadJson(STORAGE_KEY_START_MAP, {});
        map[animeKey] = clampInt(ev.data.seconds, 0, 600);
        saveJson(STORAGE_KEY_START_MAP, map);
        broadcastCfgToIframe();
      }
    });

    // Atalho T (Modo Teatro)
    document.addEventListener("keydown", (e) => {
      if (!isWatchRoute()) return;
      if (!isPlainKey(e, "t")) return;
      e.preventDefault();
      toggle();
    }, true);

    routeApply();
    setInterval(() => {
      if (location.href !== state.lastUrl) {
        state.lastUrl = location.href;
        setTimeout(routeApply, 250);
      }
    }, 400);

    function toggle() {
      if (!isWatchRoute()) return;
      state.enabled = !state.enabled;
      saveBool(STORAGE_KEY_THEATER_MODE_TOP, state.enabled);
      apply(state.enabled);
      notifyIframeTheaterMode(state.enabled);
    }

    function apply(enable) {
      $("html, body").toggleClass("ld-cr-theater-mode", enable);
      if (enable) nudgePlayerSizing();
    }

    function routeApply() {
      if (!isWatchRoute()) {
        $("html, body").removeClass("ld-cr-theater-mode");
        return;
      }
      apply(state.enabled);
      notifyIframeTheaterMode(state.enabled);
      broadcastCfgToIframe();
    }

    function notifyIframeTheaterMode(enable) {
      const iframe = document.querySelector("iframe.video-player");
      iframe?.contentWindow?.postMessage({ type: "LD_CR_THEATER_MODE_STATE", enabled: !!enable }, "*");
    }

    function broadcastCfgToIframe() {
      const iframe = document.querySelector("iframe.video-player");
      if (!iframe?.contentWindow) return;
      sendCfgToIframe(iframe.contentWindow);
    }

    function sendCfgToIframe(targetWin) {
      if (!targetWin) return;

      const animeKey = getAnimeKey();
      const nextMap = loadJson(STORAGE_KEY_NEXT_MAP, {});
      const startMap = loadJson(STORAGE_KEY_START_MAP, {});
      const nextSeconds = animeKey ? (Number(nextMap[animeKey]) || 0) : 0;
      const startSeconds = animeKey ? (Number(startMap[animeKey]) || 0) : 0;

      targetWin.postMessage({
        type: "LD_CR_CFG",
        animeKey,
        nextSeconds,
        startSeconds
      }, "*");
    }

    function nudgePlayerSizing() {
      const tryFix = () => {
        const iframe = document.querySelector("iframe.video-player");
        const wrapper = document.querySelector(".video-player-wrapper");
        if (!iframe || !wrapper) return false;
        iframe.setAttribute("allowfullscreen", "");
        iframe.style.border = "0";
        return true;
      };
      if (tryFix()) return;

      let tries = 0;
      const t = setInterval(() => {
        tries++;
        if (tryFix() || tries > 30) clearInterval(t);
      }, 250);
    }

    function goNextEpisode() {
      const next =
        document.querySelector('[data-t="next-episode"] a[href*="/watch/"]') ||
        document.querySelector('.erc-prev-next-episode[data-t="next-episode"] a[href*="/watch/"]') ||
        [...document.querySelectorAll('a[href*="/watch/"]')].find(a => a.href && !a.href.includes(location.pathname));

      next?.click();
    }

    function getAnimeKey() {
      const a = document.querySelector('.current-media-parent-ref a.show-title-link[href*="/series/"]');
      const href = a?.getAttribute("href") || "";
      const m = href.match(/\/series\/([^/]+)\/([^/?#]+)/i);
      if (m) return `${m[1]}/${m[2]}`;
      return null;
    }
  }

  // ==================================
  // IFRAME (player.html)
  // ==================================
  function initPlayerIframe() {
    const CR_ORANGE = "#F47521";

    const STORAGE_KEY_SKIP_INTRO = "ld_vilos_skip_intro_enabled";
    const STORAGE_KEY_SKIP_RECAP = "ld_vilos_skip_recap_enabled";

    const state = {
      theaterModeEnabled: false,

      skipIntroEnabled: loadBool(STORAGE_KEY_SKIP_INTRO, false),
      skipRecapEnabled: loadBool(STORAGE_KEY_SKIP_RECAP, false),

      animeKey: null,
      nextSeconds: 0,
      startSeconds: 0,

      firedNextForEpisode: false,
      appliedStartForEpisode: false,
      lastVideoSrcKey: null,
      lastAnimeKey: null,

      introIgnoreUntilGone: false,
      recapIgnoreUntilGone: false,
      nextCancelUntil: 0,

      nextArmed: false,
    };

    // Fullscreen-safe UI root
    function uiRoot() {
      return document.fullscreenElement || document.webkitFullscreenElement || document.documentElement;
    }

    GM_addStyle(`
      #ld-netflix-countdown {
        position: fixed;
        right: 18px;
        bottom: 92px;
        z-index: 2147483647;
        display: none;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(0,0,0,.60);
        border: 1px solid rgba(255,255,255,.16);
        color: rgba(255,255,255,.92);
        backdrop-filter: blur(8px);
        pointer-events: none;
      }
      #ld-netflix-countdown .ld-nc-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 170px;
      }
      #ld-netflix-countdown .ld-nc-title {
        font: 700 13px/1.1 Arial, sans-serif;
        color: rgba(255,255,255,.95);
      }
      #ld-netflix-countdown .ld-nc-sub {
        font: 12px/1.1 Arial, sans-serif;
        color: rgba(255,255,255,.72);
      }
      #ld-netflix-countdown .ld-nc-circle { width:34px; height:34px; flex:0 0 34px; }
      #ld-netflix-countdown .ld-nc-sec { font: 900 12px/1 Arial, sans-serif; fill: rgba(255,255,255,.95); }
    `);

    const nc = document.createElement("div");
    nc.id = "ld-netflix-countdown";
    nc.innerHTML = `
      <div class="ld-nc-circle">
        <svg width="34" height="34" viewBox="0 0 36 36" aria-hidden="true">
          <path d="M18 2.5 a 15.5 15.5 0 0 1 0 31 a 15.5 15.5 0 0 1 0 -31"
            fill="none" stroke="rgba(255,255,255,.18)" stroke-width="3"/>
          <path id="ld-nc-progress"
            d="M18 2.5 a 15.5 15.5 0 0 1 0 31 a 15.5 15.5 0 0 1 0 -31"
            fill="none" stroke="${CR_ORANGE}" stroke-width="3" stroke-linecap="round"
            stroke-dasharray="0, 100"/>
          <text id="ld-nc-sec" x="18" y="21" text-anchor="middle" class="ld-nc-sec">5</text>
        </svg>
      </div>
      <div class="ld-nc-text">
        <div id="ld-nc-title" class="ld-nc-title">...</div>
        <div class="ld-nc-sub">Pressione ESC para cancelar</div>
      </div>
    `;
    uiRoot().appendChild(nc);

    const ncProg = nc.querySelector("#ld-nc-progress");
    const ncSec = nc.querySelector("#ld-nc-sec");
    const ncTitle = nc.querySelector("#ld-nc-title");

    function remountUI() {
      const root = uiRoot();
      if (nc.parentElement !== root) root.appendChild(nc);
    }
    document.addEventListener("fullscreenchange", remountUI);
    document.addEventListener("webkitfullscreenchange", remountUI);

    const countdown = {
      active: false,
      kind: null,   // "intro" | "recap" | "next"
      endAt: 0,
      totalMs: 5000,
      raf: null,
      onDone: null
    };

    function startCountdown(kind, title, onDone) {
      remountUI();

      const now = Date.now();
      if (countdown.active && countdown.kind === kind && now < countdown.endAt) return;

      stopCountdown(false);

      countdown.active = true;
      countdown.kind = kind;
      countdown.endAt = now + countdown.totalMs;
      countdown.onDone = onDone;

      ncTitle.textContent = title;
      nc.style.display = "flex";

      const tick = () => {
        if (!countdown.active) return;

        const v = document.querySelector("video");
        if (v && v.paused) {
          stopCountdown(true);
          return;
        }

        const left = Math.max(0, countdown.endAt - Date.now());

        ncSec.textContent = String(Math.ceil(left / 1000));
        const pct = 100 - Math.round((left / countdown.totalMs) * 100);
        ncProg.setAttribute("stroke-dasharray", `${pct}, 100`);

        if (left <= 0) {
          const fn = countdown.onDone;
          stopCountdown(false);
          try { fn?.(); } catch (_) {}
          return;
        }
        countdown.raf = requestAnimationFrame(tick);
      };

      countdown.raf = requestAnimationFrame(tick);
    }

    function stopCountdown(isCancel) {
      if (countdown.raf) cancelAnimationFrame(countdown.raf);
      countdown.raf = null;

      const oldKind = countdown.kind;

      countdown.active = false;
      countdown.kind = null;
      countdown.endAt = 0;
      countdown.onDone = null;

      nc.style.display = "none";

      if (!isCancel) return;

      if (oldKind === "intro") state.introIgnoreUntilGone = true;
      if (oldKind === "recap") state.recapIgnoreUntilGone = true;
      if (oldKind === "next") state.nextCancelUntil = Date.now() + 6000;
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && countdown.active) {
        e.preventDefault();
        stopCountdown(true);
      }
    }, true);

    // Messages from TOP
    window.addEventListener("message", (ev) => {
      if (!ev?.data) return;

      if (ev.data.type === "LD_CR_THEATER_MODE_STATE") {
        state.theaterModeEnabled = !!ev.data.enabled;
        updateMenuVisuals(true);
      }

      if (ev.data.type === "LD_CR_CFG") {
        state.animeKey = ev.data.animeKey || state.animeKey;
        state.nextSeconds = clampInt(ev.data.nextSeconds, 0, 600);
        state.startSeconds = clampInt(ev.data.startSeconds, 0, 600);
        updateMenuVisuals(true);
      }
    });

    window.parent.postMessage({ type: "LD_CR_GET_CFG" }, "*");

    // Hotkeys in iframe
    document.addEventListener("keydown", (e) => {
      if (!isPlainKey(e, "t")) return;
      e.preventDefault();
      window.parent.postMessage({ type: "LD_CR_TOGGLE_THEATER_MODE" }, "*");
    }, true);

    document.addEventListener("keydown", (e) => {
      if (!isPlainKey(e, "n")) return;
      e.preventDefault();
      const v = document.querySelector("video");
      if (!v || !isFinite(v.duration) || !isFinite(v.currentTime) || v.duration <= 0) return;

      const remaining = Math.max(0, Math.round(v.duration - v.currentTime));
      window.parent.postMessage({ type: "LD_CR_SET_NEXT_SECONDS", seconds: remaining }, "*");
    }, true);

    // Poll
    setInterval(() => {
      remountUI();
      enablePiPOnVideo();
      resetForNewEpisodeIfNeeded();
      injectMenuOnce();
      updateMenuVisuals();
      applyStartAtInstant();
      handleSkipButtons();
      handleNext();
    }, 400);

    function enablePiPOnVideo() {
      const video = document.querySelector("video");
      if (!video) return;
      try { video.disablePictureInPicture = false; } catch (_) {}
      if (video.hasAttribute("controlsList")) {
        const cl = video.getAttribute("controlsList") || "";
        if (cl.includes("nopictureinpicture")) {
          video.setAttribute("controlsList", cl.replace("nopictureinpicture", "").trim());
        }
      }
    }

    function getVideoSrcKey() {
      const v = document.querySelector("video");
      if (!v) return null;
      return v.currentSrc || v.src || v.querySelector("source")?.getAttribute("src") || null;
    }

    function resetForNewEpisodeIfNeeded() {
      const srcKey = getVideoSrcKey();
      const animeKey = state.animeKey || null;

      if (animeKey && animeKey !== state.lastAnimeKey) {
        state.lastAnimeKey = animeKey;
        state.firedNextForEpisode = false;
        state.appliedStartForEpisode = false;
        state.nextArmed = false;
        state.introIgnoreUntilGone = false;
        state.recapIgnoreUntilGone = false;
        if (countdown.kind) stopCountdown(false);
      }

      if (srcKey && srcKey !== state.lastVideoSrcKey) {
        state.lastVideoSrcKey = srcKey;
        state.firedNextForEpisode = false;
        state.appliedStartForEpisode = false;
        state.nextArmed = false;
        state.introIgnoreUntilGone = false;
        state.recapIgnoreUntilGone = false;
        if (countdown.kind) stopCountdown(false);

        const sb = document.querySelector('[data-testid="skipButton"]');
        if (sb) delete sb.dataset.ldSkipped;
      }
    }

    // Começar em Xs: agora é instantâneo (sem 5s)
    function applyStartAtInstant() {
      const v = document.querySelector("video");
      if (!v || !isFinite(v.currentTime)) return;

      if (state.startSeconds <= 0) return;
      if (state.appliedStartForEpisode) return;

      // só no começo
      if (v.currentTime > 1.5) return;

      state.appliedStartForEpisode = true;
      try { v.currentTime = state.startSeconds; } catch (_) {}
    }

    function handleSkipButtons() {
      const v = document.querySelector("video");
      if (v?.paused) {
        if (countdown.kind === "intro" || countdown.kind === "recap") stopCountdown(true);
        return;
      }

      const skipContainer = document.querySelector('[data-testid="skipButton"]');

      if (state.introIgnoreUntilGone && !skipContainer) state.introIgnoreUntilGone = false;
      if (state.recapIgnoreUntilGone && !skipContainer) state.recapIgnoreUntilGone = false;

      if (!skipContainer) {
        if (countdown.kind === "intro" || countdown.kind === "recap") stopCountdown(false);
        return;
      }

      const btn = skipContainer.querySelector('[role="button"][tabindex="0"]') || skipContainer.querySelector('[role="button"]');
      const aria = btn?.getAttribute("aria-label") || "";
      const txt = (skipContainer.querySelector('[data-testid="skipIntroText"]')?.textContent || "").trim();

      const isIntro = /abertura/i.test(aria) || /abertura/i.test(txt);
      const isRecap = /recapitula/i.test(aria) || /recapitula/i.test(txt);

      if (skipContainer.dataset.ldSkipped === "1") return;

      if (isIntro) {
        if (!state.skipIntroEnabled || state.introIgnoreUntilGone) {
          if (countdown.kind === "intro") stopCountdown(false);
          return;
        }

        startCountdown("intro", "Pulando abertura", () => {
          const v2 = document.querySelector("video");
          if (v2?.paused) return;

          const sc = document.querySelector('[data-testid="skipButton"]');
          if (!sc || sc.dataset.ldSkipped === "1") return;

          const b = sc.querySelector('[role="button"][tabindex="0"]') || sc.querySelector('[role="button"]');
          const a = b?.getAttribute("aria-label") || "";
          const t = (sc.querySelector('[data-testid="skipIntroText"]')?.textContent || "").trim();

          if (/abertura/i.test(a) || /abertura/i.test(t)) {
            sc.dataset.ldSkipped = "1";
            b?.click();
          }
        });
        return;
      }

      if (isRecap) {
        if (!state.skipRecapEnabled || state.recapIgnoreUntilGone) {
          if (countdown.kind === "recap") stopCountdown(false);
          return;
        }

        startCountdown("recap", "Pulando recapitulação", () => {
          const v2 = document.querySelector("video");
          if (v2?.paused) return;

          const sc = document.querySelector('[data-testid="skipButton"]');
          if (!sc || sc.dataset.ldSkipped === "1") return;

          const b = sc.querySelector('[role="button"][tabindex="0"]') || sc.querySelector('[role="button"]');
          const a = b?.getAttribute("aria-label") || "";
          const t = (sc.querySelector('[data-testid="skipIntroText"]')?.textContent || "").trim();

          if (/recapitula/i.test(a) || /recapitula/i.test(t)) {
            sc.dataset.ldSkipped = "1";
            b?.click();
          }
        });
        return;
      }

      if (countdown.kind === "intro" || countdown.kind === "recap") stopCountdown(false);
    }

    function handleNext() {
      const v = document.querySelector("video");
      if (!v || !isFinite(v.duration) || !isFinite(v.currentTime) || v.duration <= 0) return;

      if (v.paused) {
        if (countdown.kind === "next") stopCountdown(true);
        return;
      }

      if (state.nextSeconds <= 0 || state.firedNextForEpisode) {
        if (countdown.kind === "next") stopCountdown(false);
        state.nextArmed = false;
        return;
      }

      if (Date.now() < state.nextCancelUntil) {
        if (countdown.kind === "next") stopCountdown(false);
        return;
      }

      const remaining = v.duration - v.currentTime;

      if (remaining > state.nextSeconds) {
        state.nextArmed = false;
        if (countdown.kind === "next") stopCountdown(false);
        return;
      }

      if (state.nextArmed) return;
      state.nextArmed = true;

      startCountdown("next", "Próximo episódio", () => {
        const v2 = document.querySelector("video");
        if (!v2 || v2.paused) { state.nextArmed = false; return; }

        const rem2 = v2.duration - v2.currentTime;
        if (rem2 <= state.nextSeconds && !state.firedNextForEpisode) {
          state.firedNextForEpisode = true;
          window.parent.postMessage({ type: "LD_CR_GO_NEXT_EPISODE" }, "*");
        } else {
          state.nextArmed = false;
        }
      });
    }

    // Settings Menu
    function injectMenuOnce() {
      const menu = document.getElementById("velocity-settings-menu");
      if (!menu) return;
      if (menu.dataset.ldInjected === "1") return;

      const autoplayItem = menu.querySelector('[data-testid="vilos-settings_autoplay_toggle"]');
      if (!autoplayItem) return;

      const theaterModeItem = ensureToggleLikeAutoplay(menu, autoplayItem, {
        testId: "ld-vilos-theater-mode",
        label: "Modo Teatro (T)",
        getState: () => state.theaterModeEnabled,
        onToggle: () => window.parent.postMessage({ type: "LD_CR_TOGGLE_THEATER_MODE" }, "*")
      });

      const skipIntroItem = ensureToggleLikeAutoplay(menu, autoplayItem, {
        testId: "ld-vilos-skip-intro",
        label: "Pular abertura",
        insertAfter: theaterModeItem,
        getState: () => state.skipIntroEnabled,
        onToggle: () => {
          state.skipIntroEnabled = !state.skipIntroEnabled;
          saveBool(STORAGE_KEY_SKIP_INTRO, state.skipIntroEnabled);
        }
      });

      const skipRecapItem = ensureToggleLikeAutoplay(menu, autoplayItem, {
        testId: "ld-vilos-skip-recap",
        label: "Pular recapitulação",
        insertAfter: skipIntroItem,
        getState: () => state.skipRecapEnabled,
        onToggle: () => {
          state.skipRecapEnabled = !state.skipRecapEnabled;
          saveBool(STORAGE_KEY_SKIP_RECAP, state.skipRecapEnabled);
        }
      });

      const startRow = ensureSecondsRow(menu, autoplayItem, {
        testId: "ld-vilos-start-at",
        label: "Começar em",
        insertAfter: skipRecapItem,
        getValue: () => state.startSeconds,
        onClick: () => {
          const cur = state.startSeconds || 0;
          const val = prompt(`Começar em (segundos)\n0 = não pular\nAnime: ${state.animeKey || "(carregando...)"}`, String(cur));
          if (val === null) return;
          const n = clampInt(val, 0, 600);
          window.parent.postMessage({ type: "LD_CR_SET_START_SECONDS", seconds: n }, "*");
        }
      });

      ensureSecondsRow(menu, autoplayItem, {
        testId: "ld-vilos-next-episode",
        label: "Próximo episódio",
        insertAfter: startRow,
        getValue: () => state.nextSeconds,
        onClick: () => {
          const cur = state.nextSeconds || 0;
          const val = prompt(`Próximo episódio (segundos)\n0 = não pular\nAnime: ${state.animeKey || "(carregando...)"}`, String(cur));
          if (val === null) return;
          const n = clampInt(val, 0, 600);
          window.parent.postMessage({ type: "LD_CR_SET_NEXT_SECONDS", seconds: n }, "*");
        }
      });

      menu.dataset.ldInjected = "1";
      updateMenuVisuals(true);
    }

    function updateMenuVisuals(force = false) {
      const menu = document.getElementById("velocity-settings-menu");
      if (!menu || menu.dataset.ldInjected !== "1") return;

      updateToggleVisual(menu, "ld-vilos-theater-mode", state.theaterModeEnabled);
      updateToggleVisual(menu, "ld-vilos-skip-intro", state.skipIntroEnabled);
      updateToggleVisual(menu, "ld-vilos-skip-recap", state.skipRecapEnabled);

      updateSecondsVisual(menu, "ld-vilos-start-at", state.startSeconds, force);
      updateSecondsVisual(menu, "ld-vilos-next-episode", state.nextSeconds, force);
    }

    function ensureToggleLikeAutoplay(menu, autoplayItem, opts) {
      const { testId, label, insertAfter, getState, onToggle } = opts;
      const existing = menu.querySelector(`[data-testid="${testId}"]`);
      if (existing) return existing;

      const clone = autoplayItem.cloneNode(true);
      clone.setAttribute("data-testid", testId);
      clone.setAttribute("tabindex", "-1");

      const labelEl = findTextParent(clone, "Autoplay") || clone.querySelector('[dir="auto"]');
      if (labelEl) labelEl.textContent = label;

      const innerBtn = clone.querySelector('[aria-checked][data-test-state]') || clone.querySelector('[aria-checked]');
      const track = clone.querySelector('[style*="border-color"]');
      const knob = clone.querySelector('[style*="transform: translateX"]') || (track ? track.querySelector("div") : null);

      innerBtn?.setAttribute("data-ld-role", `${testId}-btn`);
      track?.setAttribute("data-ld-role", `${testId}-track`);
      knob?.setAttribute("data-ld-role", `${testId}-knob`);

      clone.addEventListener("click", () => {
        onToggle?.();
        updateMenuVisuals();
      }, false);

      (insertAfter || autoplayItem).insertAdjacentElement("afterend", clone);
      return clone;
    }

    function ensureSecondsRow(menu, templateItem, opts) {
      const { testId, label, insertAfter, getValue, onClick } = opts;
      const existing = menu.querySelector(`[data-testid="${testId}"]`);
      if (existing) return existing;

      const row = templateItem.cloneNode(true);
      row.setAttribute("data-testid", testId);
      row.setAttribute("tabindex", "-1");

      const labelEl = findTextParent(row, "Autoplay") || row.querySelector('[dir="auto"]');
      if (labelEl) labelEl.textContent = label;

      row.querySelector('[style*="border-color"]')?.remove();

      const inner =
        row.querySelector('[aria-checked][data-test-state]') ||
        row.querySelector('[aria-checked]') ||
        row.firstElementChild ||
        row;

      const labelNode = inner.querySelector('[dir="auto"]') || inner.querySelector("div");

      const value = document.createElement("div");
      value.setAttribute("data-ld-role", `${testId}-value`);
      if (labelNode?.classList?.length) value.className = Array.from(labelNode.classList).join(" ");

      value.style.minWidth = "64px";
      value.style.lineHeight = "18px";
      value.style.color = "rgb(218, 218, 218)";
      value.style.padding = "6px 10px";
      value.style.borderRadius = "10px";
      value.style.border = "1px solid rgba(255,255,255,.18)";
      value.style.background = "rgba(255,255,255,.06)";
      value.style.fontWeight = "700";
      value.style.textAlign = "right";
      value.style.marginLeft = "auto";
      value.style.whiteSpace = "nowrap";

      value.textContent = `${clampInt(getValue?.(), 0, 600)}s`;
      inner.appendChild(value);

      row.addEventListener("click", () => onClick?.(), false);
      insertAfter.insertAdjacentElement("afterend", row);
      return row;
    }

    function updateSecondsVisual(menu, testId, seconds, force) {
      const item = menu.querySelector(`[data-testid="${testId}"]`);
      if (!item) return;
      const value = item.querySelector(`[data-ld-role="${testId}-value"]`);
      if (!value) return;

      const nextText = `${clampInt(seconds, 0, 600)}s`;
      if (!force && value.textContent === nextText) return;
      value.textContent = nextText;
    }

    function updateToggleVisual(menu, testId, on) {
      const item = menu.querySelector(`[data-testid="${testId}"]`);
      if (!item) return;

      const innerBtn = item.querySelector(`[data-ld-role="${testId}-btn"]`);
      const track = item.querySelector(`[data-ld-role="${testId}-track"]`);
      const knob = item.querySelector(`[data-ld-role="${testId}-knob"]`);

      if (innerBtn) {
        innerBtn.setAttribute("aria-checked", on ? "true" : "false");
        innerBtn.setAttribute("data-test-state", on ? "true" : "false");
      }

      const autoplay = menu.querySelector('[data-testid="vilos-settings_autoplay_toggle"]');
      const btnTrue = autoplay?.querySelector('[data-test-state="true"]');
      const btnFalse = autoplay?.querySelector('[data-test-state="false"]');

      const trackTrue = btnTrue?.querySelector('[style*="border-color"]');
      const knobTrue = trackTrue?.querySelector('[style*="background-color"]') || trackTrue?.querySelector('div');

      const trackFalse = btnFalse?.querySelector('[style*="border-color"]');
      const knobFalse = trackFalse?.querySelector('[style*="background-color"]') || trackFalse?.querySelector('div');

      const onBorder = (trackTrue?.style?.borderColor) || "rgb(40, 189, 187)";
      const onBg = (knobTrue?.style?.backgroundColor) || "rgb(40, 189, 187)";
      const offBorder = (trackFalse?.style?.borderColor) || "rgb(160, 160, 160)";
      const offBg = (knobFalse?.style?.backgroundColor) || "rgb(160, 160, 160)";

      if (track) track.style.borderColor = on ? onBorder : offBorder;
      if (knob) {
        knob.style.backgroundColor = on ? onBg : offBg;
        knob.style.transform = on ? "translateX(24px)" : "translateX(4px)";
      }
    }

    function findTextParent(root, exactText) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => ((node.nodeValue || "").trim() === exactText ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)
      });
      return walker.nextNode() ? walker.currentNode.parentElement : null;
    }
  }

  // ========= shared helpers =========
  function isWatchRoute(url = location.href) {
    return /\/watch\//i.test(url);
  }

  function loadBool(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return raw === "1";
    } catch {
      return fallback;
    }
  }

  function saveBool(key, v) {
    try { localStorage.setItem(key, v ? "1" : "0"); } catch {}
  }

  function clampInt(v, min, max) {
    const n = Math.round(Number(v));
    if (!isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function loadJson(key, fallbackObj) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallbackObj;
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : fallbackObj;
    } catch {
      return fallbackObj;
    }
  }

  function saveJson(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch {}
  }

  function isPlainKey(e, key) {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || (e.target && e.target.isContentEditable)) return false;
    return !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === key;
  }
})();
