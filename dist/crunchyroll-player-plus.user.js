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

    // TOP (crunchyroll.com) storage
    const STORAGE_KEY_VIDEO_MODE_TOP = "ld_cr_mode_video_enabled";
    const STORAGE_KEY_NEXT_BY_SECONDS_MAP = "ld_cr_next_by_seconds_map"; // { "GRMG8ZQZR/one-piece": 35, ... }

    // IFRAME (player.html) storage
    const STORAGE_KEY_SKIP_INTRO = "ld_vilos_skip_intro_enabled";

    const DEFAULT_VIDEO_MODE = true;
    const DEFAULT_SKIP_INTRO = false;

    const isTop = window.top === window.self;
    const isPlayerFrame = /static\.crunchyroll\.com\/vilos-v2\/web\/vilos\/player\.html/i.test(location.href);

    const GUARD_KEY = isTop ? "__LD_CR_INIT_TOP_v140" : "__LD_CR_INIT_IFRAME_v140";
    if (window[GUARD_KEY]) return;
    window[GUARD_KEY] = true;

    if (isTop && !isPlayerFrame) initTopPage();
    else initPlayerIframe();

    // =========================
    // TOP (www.crunchyroll.com)
    // =========================
    function initTopPage() {
        const state = {
            enabled: loadBool(STORAGE_KEY_VIDEO_MODE_TOP, DEFAULT_VIDEO_MODE),
            lastUrl: location.href,
            observer: null,
        };

        GM_addStyle(`
      html.ld-cr-video-mode,
      body.ld-cr-video-mode {
        overflow: hidden !important;
        background: #000 !important;
      }

      .ld-cr-video-mode .app-layout__header--ywueY,
      .ld-cr-video-mode .erc-large-header,
      .ld-cr-video-mode header[data-t="header-default"],
      .ld-cr-video-mode .app-layout__footer--jgOfu,
      .ld-cr-video-mode [data-t="footer"],
      .ld-cr-video-mode .app-layout__aside--IG1cw,
      .ld-cr-video-mode .banner-wrapper,
      .ld-cr-video-mode .content-wrapper--MF5LS,
      .ld-cr-video-mode .videos-wrapper,
      .ld-cr-video-mode .erc-watch-episode .content-wrapper--MF5LS,
      .ld-cr-video-mode .erc-watch-episode .videos-wrapper {
        display: none !important;
      }

      .ld-cr-video-mode .erc-watch-episode,
      .ld-cr-video-mode .erc-watch-episode-layout {
        margin: 0 !important;
        padding: 0 !important;
        max-width: none !important;
        width: 100% !important;
        background: #000 !important;
      }

      .ld-cr-video-mode .video-player-wrapper {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 2147483000 !important;
        background: #000 !important;
      }

      .ld-cr-video-mode .video-player-spacer { display:none !important; }

      .ld-cr-video-mode iframe.video-player {
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
            if (!ev || !ev.data) return;

            if (ev.data.type === "LD_CR_TOGGLE_VIDEO_MODE") toggle();

            if (ev.data.type === "LD_CR_GO_NEXT_EPISODE") goNextEpisode();

            if (ev.data.type === "LD_CR_GET_ANIME_AND_NEXTCFG") {
                const animeKey = getAnimeKey();
                const map = loadJson(STORAGE_KEY_NEXT_BY_SECONDS_MAP, {});
                const seconds = animeKey ? Number(map[animeKey]) || 0 : 0;
                ev.source?.postMessage({ type: "LD_CR_ANIME_AND_NEXTCFG", animeKey, seconds }, "*");
            }

            if (ev.data.type === "LD_CR_SET_NEXT_SECONDS_FOR_ANIME") {
                const animeKey = getAnimeKey();
                if (!animeKey) return;

                const seconds = clampInt(ev.data.seconds, 0, 600);
                const map = loadJson(STORAGE_KEY_NEXT_BY_SECONDS_MAP, {});
                map[animeKey] = seconds;
                saveJson(STORAGE_KEY_NEXT_BY_SECONDS_MAP, map);

                // avisa iframe imediatamente
                const iframe = document.querySelector("iframe.video-player");
                iframe?.contentWindow?.postMessage({ type: "LD_CR_ANIME_AND_NEXTCFG", animeKey, seconds }, "*");
            }
        });

        // Atalho B fora do iframe
        document.addEventListener(
            "keydown",
            (e) => {
                if (!isWatchRoute()) return;

                const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
                if (tag === "input" || tag === "textarea" || (e.target && e.target.isContentEditable)) return;

                if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === "b") {
                    e.preventDefault();
                    toggle();
                }
            },
            true,
        );

        routeApply();
        startSpaWatchers();

        function toggle() {
            if (!isWatchRoute()) return;

            state.enabled = !state.enabled;
            saveBool(STORAGE_KEY_VIDEO_MODE_TOP, state.enabled);
            apply(state.enabled);
            notifyIframeVideoMode(state.enabled);
        }

        function apply(enable) {
            $("html, body").toggleClass("ld-cr-video-mode", enable);
            if (enable) nudgePlayerSizing();
        }

        function routeApply() {
            if (!isWatchRoute()) {
                $("html, body").removeClass("ld-cr-video-mode");
                return;
            }

            apply(state.enabled);
            notifyIframeVideoMode(state.enabled);

            // sempre que entrar em /watch, manda também cfg do anime pro iframe
            notifyIframeAnimeCfg();
        }

        function startSpaWatchers() {
            setInterval(() => {
                if (location.href !== state.lastUrl) {
                    state.lastUrl = location.href;
                    setTimeout(routeApply, 250);
                }
            }, 400);

            if (state.observer) state.observer.disconnect();
            state.observer = new MutationObserver(() => {
                if (!isWatchRoute()) return;
                if (state.enabled) nudgePlayerSizing();
                notifyIframeVideoMode(state.enabled);
                notifyIframeAnimeCfg();
            });
            state.observer.observe(document.documentElement, { childList: true, subtree: true });
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

        function notifyIframeVideoMode(enable) {
            const iframe = document.querySelector("iframe.video-player");
            if (!iframe || !iframe.contentWindow) return;
            iframe.contentWindow.postMessage({ type: "LD_CR_VIDEO_MODE_STATE", enabled: !!enable }, "*");
        }

        function notifyIframeAnimeCfg() {
            const iframe = document.querySelector("iframe.video-player");
            if (!iframe || !iframe.contentWindow) return;

            const animeKey = getAnimeKey();
            const map = loadJson(STORAGE_KEY_NEXT_BY_SECONDS_MAP, {});
            const seconds = animeKey ? Number(map[animeKey]) || 0 : 0;

            iframe.contentWindow.postMessage({ type: "LD_CR_ANIME_AND_NEXTCFG", animeKey, seconds }, "*");
        }

        function goNextEpisode() {
            const next = document.querySelector('[data-t="next-episode"] a[href*="/watch/"]') || document.querySelector('.erc-prev-next-episode[data-t="next-episode"] a[href*="/watch/"]') || document.querySelector('a[href*="/watch/"][aria-label*="Próximo"]');

            if (next) {
                next.click();
                return;
            }

            const cur = location.pathname;
            const any = [...document.querySelectorAll('a[href*="/watch/"]')].find((a) => a.href && !a.href.includes(cur));
            any?.click();
        }

        function getAnimeKey() {
            const a = document.querySelector('.current-media-parent-ref a.show-title-link[href*="/series/"]');
            const href = a?.getAttribute("href") || "";
            // /pt-br/series/GRMG8ZQZR/one-piece
            const m = href.match(/\/series\/([^/]+)\/([^/?#]+)/i);
            if (m) return `${m[1]}/${m[2]}`;
            return null;
        }
    }

    // ==================================
    // IFRAME (player.html)
    // ==================================
    function initPlayerIframe() {
        const STORAGE_KEY_SKIP_INTRO = "ld_vilos_skip_intro_enabled";
        const CR_ORANGE = "#F47521";

        const iframeState = {
            videoModeEnabled: false,
            skipIntroEnabled: loadBool(STORAGE_KEY_SKIP_INTRO, false),

            animeKey: null,
            nextSeconds: 0,

            firedForThisEpisode: false,

            // resets robustos
            lastVideoSrcKey: null,
            lastAnimeKey: null,

            lastRenderedNextSeconds: null,

            // cancel logic
            introIgnoreUntilSkipGone: false, // <- ESC makes this true until skip button disappears
            nextCancelUntil: 0,
            nextArmed: false,
        };

        // ---------- UI ----------
        GM_addStyle(`
    #ld-toast {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      padding: 10px 12px;
      border-radius: 12px;
      color: #fff;
      background: rgba(0,0,0,.65);
      border: 1px solid rgba(255,255,255,.16);
      font: 13px/1.2 Arial, sans-serif;
      backdrop-filter: blur(6px);
      display: none;
      white-space: nowrap;
    }

    #ld-netflix-countdown {
      position: fixed;
      right: 18px;
      bottom: 18px;
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

        const toast = document.createElement("div");
        toast.id = "ld-toast";
        document.documentElement.appendChild(toast);

        function showToast(msg) {
            toast.textContent = msg;
            toast.style.display = "block";
            clearTimeout(showToast._t);
            showToast._t = setTimeout(() => {
                toast.style.display = "none";
            }, 2200);
        }

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
        document.documentElement.appendChild(nc);

        const ncProg = nc.querySelector("#ld-nc-progress");
        const ncSec = nc.querySelector("#ld-nc-sec");
        const ncTitle = nc.querySelector("#ld-nc-title");

        const countdown = {
            active: false,
            kind: null, // "intro" | "next"
            endAt: 0,
            totalMs: 5000,
            raf: null,
            onDone: null,
        };

        function startCountdown(kind, title, onDone) {
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

                const now2 = Date.now();
                const left = Math.max(0, countdown.endAt - now2);
                const done = left <= 0;

                ncSec.textContent = String(Math.ceil(left / 1000));
                const pct = 100 - Math.round((left / countdown.totalMs) * 100);
                ncProg.setAttribute("stroke-dasharray", `${pct}, 100`);

                if (done) {
                    const fn = countdown.onDone;
                    stopCountdown(false);
                    try {
                        fn?.();
                    } catch (_) {}
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

            // cancel behavior:
            // - intro: ESC should ignore until skip button disappears
            if (isCancel && oldKind === "intro") {
                iframeState.introIgnoreUntilSkipGone = true;
            }
            // - next: short cooldown prevents rapid rearming while paused/scrubbing
            if (isCancel && oldKind === "next") {
                iframeState.nextCancelUntil = Date.now() + 6000;
            }
        }

        // ESC cancels
        document.addEventListener(
            "keydown",
            (e) => {
                if (e.key === "Escape" && countdown.active) {
                    e.preventDefault();
                    stopCountdown(true);
                }
            },
            true,
        );

        // ---------- Messaging ----------
        window.addEventListener("message", (ev) => {
            if (!ev || !ev.data) return;

            if (ev.data.type === "LD_CR_VIDEO_MODE_STATE") {
                iframeState.videoModeEnabled = !!ev.data.enabled;
                updateMenuVisualsSafely();
            }

            if (ev.data.type === "LD_CR_ANIME_AND_NEXTCFG") {
                iframeState.animeKey = ev.data.animeKey || iframeState.animeKey;
                iframeState.nextSeconds = clampInt(ev.data.seconds, 0, 600);
                updateMenuVisualsSafely();
            }
        });

        window.parent.postMessage({ type: "LD_CR_GET_ANIME_AND_NEXTCFG" }, "*");

        // Hotkeys
        document.addEventListener(
            "keydown",
            (e) => {
                if (!isPlainKey(e, "b")) return;
                e.preventDefault();
                window.parent.postMessage({ type: "LD_CR_TOGGLE_VIDEO_MODE" }, "*");
            },
            true,
        );

        document.addEventListener(
            "keydown",
            (e) => {
                if (!isPlainKey(e, "n")) return;
                e.preventDefault();

                const v = document.querySelector("video");
                if (!v || !isFinite(v.duration) || !isFinite(v.currentTime) || v.duration <= 0) {
                    showToast("Não consegui ler o tempo do vídeo ainda.");
                    return;
                }
                const remaining = Math.max(0, Math.round(v.duration - v.currentTime));
                window.parent.postMessage({ type: "LD_CR_SET_NEXT_SECONDS_FOR_ANIME", seconds: remaining }, "*");
                showToast(`Atualizado: Próximo episódio em ${remaining}s`);
            },
            true,
        );

        // ---------- Polling loops ----------
        setInterval(() => {
            enablePiPOnVideo();
            injectMenuOncePerMenuInstance();
            updateMenuVisualsSafely();
            autoSkipIntroWithCountdown();
        }, 400);

        setInterval(() => {
            maybeNextEpisodeWithCountdown();
        }, 400);

        // ---------- PiP ----------
        function enablePiPOnVideo() {
            const video = document.querySelector("video");
            if (!video) return;

            try {
                video.disablePictureInPicture = false;
            } catch (_) {}
            if (video.hasAttribute("controlsList")) {
                const cl = video.getAttribute("controlsList") || "";
                if (cl.includes("nopictureinpicture")) {
                    video.setAttribute("controlsList", cl.replace("nopictureinpicture", "").trim());
                }
            }
        }

        // ---------- Robust episode reset ----------
        function getVideoSrcKey() {
            const v = document.querySelector("video");
            if (!v) return null;

            // currentSrc is the best; if empty, fallback to <source src>
            const src = v.currentSrc || v.src || "";
            if (src) return src;

            const s = v.querySelector("source")?.getAttribute("src") || "";
            return s || null;
        }

        function resetForNewEpisodeIfNeeded() {
            const srcKey = getVideoSrcKey();
            const animeKey = iframeState.animeKey || null;

            if (animeKey && animeKey !== iframeState.lastAnimeKey) {
                iframeState.lastAnimeKey = animeKey;
                iframeState.firedForThisEpisode = false;
                iframeState.nextArmed = false;
                iframeState.introIgnoreUntilSkipGone = false;
                if (countdown.kind === "next") stopCountdown(false);
                if (countdown.kind === "intro") stopCountdown(false);
            }

            if (srcKey && srcKey !== iframeState.lastVideoSrcKey) {
                iframeState.lastVideoSrcKey = srcKey;
                iframeState.firedForThisEpisode = false;
                iframeState.nextArmed = false;
                iframeState.introIgnoreUntilSkipGone = false;
                // clear per-episode skip markers
                const sb = document.querySelector('[data-testid="skipButton"]');
                if (sb) sb.dataset.ldSkipped = "0";
                if (countdown.kind === "next") stopCountdown(false);
                if (countdown.kind === "intro") stopCountdown(false);
            }
        }

        // ---------- Skip Intro ----------
        function autoSkipIntroWithCountdown() {
            resetForNewEpisodeIfNeeded();

            const v = document.querySelector("video");

            // if paused, cancel intro countdown
            if (v && v.paused && countdown.kind === "intro") stopCountdown(true);

            if (!iframeState.skipIntroEnabled) {
                if (countdown.kind === "intro") stopCountdown(false);
                return;
            }

            const skipContainer = document.querySelector('[data-testid="skipButton"]');

            // If user canceled via ESC, ignore until the skip button disappears
            if (iframeState.introIgnoreUntilSkipGone) {
                if (!skipContainer) {
                    iframeState.introIgnoreUntilSkipGone = false; // button gone, allow again
                }
                if (countdown.kind === "intro") stopCountdown(false);
                return;
            }

            if (!skipContainer) {
                if (countdown.kind === "intro") stopCountdown(false);
                return;
            }

            if (skipContainer.dataset.ldSkipped === "1") {
                if (countdown.kind === "intro") stopCountdown(false);
                return;
            }

            const btn = skipContainer.querySelector('[role="button"][tabindex="0"]') || skipContainer.querySelector('[role="button"]');
            const aria = btn?.getAttribute("aria-label") || "";
            const txt = (skipContainer.querySelector('[data-testid="skipIntroText"]')?.textContent || "").trim();
            const isIntro = /abertura/i.test(aria) || /abertura/i.test(txt);

            if (!isIntro) {
                if (countdown.kind === "intro") stopCountdown(false);
                return;
            }

            startCountdown("intro", "Pulando abertura", () => {
                const v2 = document.querySelector("video");
                if (v2 && v2.paused) return;

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
        }

        // ---------- Next Episode ----------
        function maybeNextEpisodeWithCountdown() {
            resetForNewEpisodeIfNeeded();

            const v = document.querySelector("video");
            if (!v || !isFinite(v.duration) || !isFinite(v.currentTime) || v.duration <= 0) return;

            // pause cancels next countdown
            if (v.paused) {
                if (countdown.kind === "next") stopCountdown(true);
                return;
            }

            if (iframeState.nextSeconds <= 0 || iframeState.firedForThisEpisode) {
                if (countdown.kind === "next") stopCountdown(false);
                iframeState.nextArmed = false;
                return;
            }

            // cooldown after ESC cancel while still in window
            if (Date.now() < iframeState.nextCancelUntil) {
                if (countdown.kind === "next") stopCountdown(false);
                return;
            }

            const remaining = v.duration - v.currentTime;

            // outside window => allow rearm later
            if (remaining > iframeState.nextSeconds) {
                iframeState.nextArmed = false;
                if (countdown.kind === "next") stopCountdown(false);
                return;
            }

            // inside window but already armed => do nothing
            if (iframeState.nextArmed) return;
            iframeState.nextArmed = true;

            startCountdown("next", "Próximo episódio", () => {
                const v2 = document.querySelector("video");
                if (!v2 || v2.paused) {
                    iframeState.nextArmed = false;
                    return;
                }

                const rem2 = v2.duration - v2.currentTime;
                if (rem2 <= iframeState.nextSeconds && !iframeState.firedForThisEpisode) {
                    iframeState.firedForThisEpisode = true;
                    window.parent.postMessage({ type: "LD_CR_GO_NEXT_EPISODE" }, "*");
                } else {
                    iframeState.nextArmed = false;
                }
            });
        }

        // ---------- Menu injection ----------
        function injectMenuOncePerMenuInstance() {
            const menu = document.getElementById("velocity-settings-menu");
            if (!menu) return;

            if (!menu.dataset.ldMenuInstance) {
                menu.dataset.ldMenuInstance = String(Date.now()) + String(Math.random()).slice(2);
            }
            if (menu.dataset.ldInjected === "1") return;

            const autoplayItem = menu.querySelector('[data-testid="vilos-settings_autoplay_toggle"]');
            if (!autoplayItem) return;

            const videoModeItem = ensureToggleLikeAutoplay({
                menu,
                autoplayItem,
                testId: "ld-vilos-settings_video_mode_toggle",
                label: "Modo Teatro (B)",
                onToggle: () => {
                    window.parent.postMessage({ type: "LD_CR_TOGGLE_VIDEO_MODE" }, "*");
                    kickControlsAutohide();
                },
            });

            const skipIntroItem = ensureToggleLikeAutoplay({
                menu,
                autoplayItem,
                testId: "ld-vilos-settings_skip_intro_toggle",
                label: "Pular Abertura",
                insertAfter: videoModeItem,
                onToggle: () => {
                    iframeState.skipIntroEnabled = !iframeState.skipIntroEnabled;
                    saveBool(STORAGE_KEY_SKIP_INTRO, iframeState.skipIntroEnabled);
                    kickControlsAutohide();
                },
            });

            ensureSecondsRowLikeMenu({
                menu,
                templateItem: autoplayItem,
                testId: "ld-vilos-settings_next_episode_seconds",
                label: "Próximo Episódio em",
                insertAfter: skipIntroItem,
                onClick: () => {
                    const cur = iframeState.nextSeconds || 0;
                    const val = prompt(`Pular para o próximo episódio em quantos segundos? (0 = não pular)\nAnime: ${iframeState.animeKey || "(carregando...)"}`, String(cur));
                    if (val === null) return;
                    const n = clampInt(val, 0, 600);
                    window.parent.postMessage({ type: "LD_CR_SET_NEXT_SECONDS_FOR_ANIME", seconds: n }, "*");
                    showToast(`Atualizado: Próximo episódio em ${n}s`);
                    kickControlsAutohide();
                },
            });

            menu.dataset.ldInjected = "1";
            iframeState.lastRenderedNextSeconds = null;
        }

        function updateMenuVisualsSafely() {
            const menu = document.getElementById("velocity-settings-menu");
            if (!menu || menu.dataset.ldInjected !== "1") return;

            updateToggleVisual(menu, "ld-vilos-settings_video_mode_toggle", iframeState.videoModeEnabled);
            updateToggleVisual(menu, "ld-vilos-settings_skip_intro_toggle", iframeState.skipIntroEnabled);

            if (iframeState.lastRenderedNextSeconds !== iframeState.nextSeconds) {
                updateSecondsRow(menu, "ld-vilos-settings_next_episode_seconds", iframeState.nextSeconds);
                iframeState.lastRenderedNextSeconds = iframeState.nextSeconds;
            }
        }

        function ensureToggleLikeAutoplay({ menu, autoplayItem, testId, label, insertAfter = null, onToggle }) {
            const existing = menu.querySelector(`[data-testid="${testId}"]`);
            if (existing) return existing;

            const clone = autoplayItem.cloneNode(true);
            clone.setAttribute("data-testid", testId);
            clone.setAttribute("tabindex", "-1");

            const labelEl = findTextParent(clone, "Autoplay") || clone.querySelector('[dir="auto"]');
            if (labelEl) labelEl.textContent = label;

            const innerToggleButton = clone.querySelector("[aria-checked][data-test-state]") || clone.querySelector("[aria-checked]");

            const toggleTrack = clone.querySelector('[style*="border-color"]');
            const toggleKnob = clone.querySelector('[style*="transform: translateX"]') || (toggleTrack ? toggleTrack.querySelector("div") : null);

            if (innerToggleButton) innerToggleButton.setAttribute("data-ld-role", `${testId}-btn`);
            if (toggleTrack) toggleTrack.setAttribute("data-ld-role", `${testId}-track`);
            if (toggleKnob) toggleKnob.setAttribute("data-ld-role", `${testId}-knob`);

            clone.addEventListener(
                "click",
                () => {
                    onToggle?.();
                    if (testId === "ld-vilos-settings_video_mode_toggle") iframeState.videoModeEnabled = !iframeState.videoModeEnabled;
                    if (testId === "ld-vilos-settings_skip_intro_toggle") iframeState.skipIntroEnabled = !iframeState.skipIntroEnabled;
                    updateMenuVisualsSafely();
                },
                false,
            );

            const anchor = insertAfter || autoplayItem;
            anchor.insertAdjacentElement("afterend", clone);
            return clone;
        }

        function ensureSecondsRowLikeMenu({ menu, templateItem, testId, label, insertAfter, onClick }) {
            const existing = menu.querySelector(`[data-testid="${testId}"]`);
            if (existing) return existing;

            const row = templateItem.cloneNode(true);
            row.setAttribute("data-testid", testId);
            row.setAttribute("tabindex", "-1");

            const labelEl = findTextParent(row, "Autoplay") || row.querySelector('[dir="auto"]');
            if (labelEl) labelEl.textContent = label;

            const track = row.querySelector('[style*="border-color"]');
            if (track) track.remove();

            const inner = row.querySelector("[aria-checked][data-test-state]") || row.querySelector("[aria-checked]") || row.firstElementChild || row;

            const labelTextNode = inner.querySelector('[dir="auto"]') || inner.querySelector("div");

            const value = document.createElement("div");
            value.setAttribute("data-ld-role", `${testId}-value`);

            // dynamic class copy
            if (labelTextNode?.classList?.length) {
                value.className = Array.from(labelTextNode.classList).join(" ");
            }

            // requested pill style
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

            value.textContent = `${clampInt(iframeState.nextSeconds, 0, 600)}s`;

            inner.appendChild(value);

            row.addEventListener("click", () => onClick?.(), false);
            insertAfter.insertAdjacentElement("afterend", row);
            return row;
        }

        function updateSecondsRow(menu, testId, seconds) {
            const item = menu.querySelector(`[data-testid="${testId}"]`);
            if (!item) return;

            const value = item.querySelector(`[data-ld-role="${testId}-value"]`);
            if (!value) return;

            value.textContent = `${clampInt(seconds, 0, 600)}s`;
        }

        function updateToggleVisual(menu, testId, on) {
            const item = menu.querySelector(`[data-testid="${testId}"]`);
            if (!item) return;

            const innerToggleButton = item.querySelector(`[data-ld-role="${testId}-btn"]`);
            const toggleTrack = item.querySelector(`[data-ld-role="${testId}-track"]`);
            const toggleKnob = item.querySelector(`[data-ld-role="${testId}-knob"]`);

            if (innerToggleButton) {
                innerToggleButton.setAttribute("aria-checked", on ? "true" : "false");
                innerToggleButton.setAttribute("data-test-state", on ? "true" : "false");
            }

            const autoplay = menu.querySelector('[data-testid="vilos-settings_autoplay_toggle"]');
            const autoplayBtnTrue = autoplay?.querySelector('[data-test-state="true"]');
            const autoplayBtnFalse = autoplay?.querySelector('[data-test-state="false"]');

            const trackTrue = autoplayBtnTrue?.querySelector('[style*="border-color"]');
            const knobTrue = trackTrue?.querySelector('[style*="background-color"]') || trackTrue?.querySelector("div");

            const trackFalse = autoplayBtnFalse?.querySelector('[style*="border-color"]');
            const knobFalse = trackFalse?.querySelector('[style*="background-color"]') || trackFalse?.querySelector("div");

            const onBorder = trackTrue?.style?.borderColor || "rgb(40, 189, 187)";
            const onBg = knobTrue?.style?.backgroundColor || "rgb(40, 189, 187)";
            const offBorder = trackFalse?.style?.borderColor || "rgb(160, 160, 160)";
            const offBg = knobFalse?.style?.backgroundColor || "rgb(160, 160, 160)";

            const knobXOn = "translateX(24px)";
            const knobXOff = "translateX(4px)";

            if (toggleTrack) toggleTrack.style.borderColor = on ? onBorder : offBorder;
            if (toggleKnob) {
                toggleKnob.style.backgroundColor = on ? onBg : offBg;
                toggleKnob.style.transform = on ? knobXOn : knobXOff;
            }
        }

        function kickControlsAutohide() {
            try {
                document.activeElement?.blur?.();
            } catch (_) {}
            setTimeout(() => {
                try {
                    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 2, clientY: 2 }));
                } catch (_) {}
            }, 50);
            setTimeout(() => {
                try {
                    const root = document.querySelector("video") || document.body;
                    root.dispatchEvent(new Event("mouseleave", { bubbles: true }));
                    root.dispatchEvent(new Event("mouseout", { bubbles: true }));
                } catch (_) {}
            }, 250);
        }

        function findTextParent(root, exactText) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
                acceptNode: (node) => ((node.nodeValue || "").trim() === exactText ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
            });
            return walker.nextNode() ? walker.currentNode.parentElement : null;
        }

        function isPlainKey(e, key) {
            const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
            if (tag === "input" || tag === "textarea" || (e.target && e.target.isContentEditable)) return false;
            return !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === key;
        }
    }

    // ========= helpers =========
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
        try {
            localStorage.setItem(key, v ? "1" : "0");
        } catch {}
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
        try {
            localStorage.setItem(key, JSON.stringify(obj));
        } catch {}
    }
})();
