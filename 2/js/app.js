/**
 * ============================================================================
 * TV MIDE CG DESK PRO — SMART BROADCAST ARCHITECTURE
 * Includes: Kurdish Stemmer, Focus Zone Crop, Web Audio Beeper, Normalizer
 * ============================================================================
 */

(function () {
  "use strict";

  // --- AUDIO SYNTHESIS ALERT (ZERO EXTERNAL FILES) ---
  const StudioAudio = {
    ctx: null,
    enabled: true,
    playAlert: function() {
      if (!this.enabled) return;
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!this.ctx) this.ctx = new AudioContext();
        if (this.ctx.state === "suspended") this.ctx.resume();

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = "sine";
        // Soft broadcast double-chime (880Hz -> 440Hz)
        osc.frequency.setValueAtTime(880, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, this.ctx.currentTime + 0.15);

        gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.2);
      } catch (e) {
        console.warn("Audio Context error", e);
      }
    }
  };

  // --- KURDISH MORPHOLOGY & STEMMER ENGINE ---
  // لێکردنەوەی پاشگر و پێشگرە بڵاوەکانی کوردی بە شێوەی زانستی
  const KurdishMorphology = {
    prefixes: ["لە", "بە", "بۆ", "وەک", "بێ", "نە"],
    suffixes: [
      "ەکانمان", "ەکانتان", "ەکانیان", "ەکانەوە", "ەکانیش",
      "ەکانم", "ەکانت", "ەکانی", "ەکان",
      "مانەوە", "تانەوە", "یانەوە",
      "مان", "تان", "یان",
      "ێکمان", "ێکتان", "ێکیان", "ێک",
      "ەوە", "دا", "یش", "تیر", "ترین",
      "ەکە", "ەکەی", "ەکەم", "ەکەت", "ە"
    ],
    
    // ئایا ئەم وشەیە دەتوانرێت بگەڕێنرێتەوە بۆ بنەچەیەکی فەرهەنگ؟
    matchStem: function(rawWord, dictionarySet) {
      if (dictionarySet.has(rawWord)) return true;

      // 1. تاقیکردنەوەی لێکردنەوەی پاشگرەکان
      for (let s of this.suffixes) {
        if (rawWord.endsWith(s) && rawWord.length > s.length + 2) {
          let candidate = rawWord.slice(0, -s.length);
          if (dictionarySet.has(candidate)) return true;
        }
      }

      // 2. تاقیکردنەوەی پێشگرەکان
      for (let p of this.prefixes) {
        if (rawWord.startsWith(p) && rawWord.length > p.length + 2) {
          let candidate = rawWord.slice(p.length);
          if (dictionarySet.has(candidate)) return true;
        }
      }

      // 3. هەردووکیان پێکەوە (وەک: لە + کوردستان + ەوە)
      for (let p of this.prefixes) {
        if (rawWord.startsWith(p)) {
          let withoutPrefix = rawWord.slice(p.length);
          for (let s of this.suffixes) {
            if (withoutPrefix.endsWith(s) && withoutPrefix.length > s.length + 2) {
              let candidate = withoutPrefix.slice(0, -s.length);
              if (dictionarySet.has(candidate)) return true;
            }
          }
        }
      }

      return false;
    }
  };

  // --- APPLICATION STATE ---
  const STATE = {
    currentLang: "sorani",
    activeStream: null,
    streamType: null,
    isOcrBusy: false,
    autoScanTimer: null,
    isAutoScanActive: false,
    cropZone: "lower-third", // 'full' | 'lower-third' | 'ticker'
    userDictionaries: {},
    lastRecognizedWords: [],
    useStemmer: true,
    proFilters: {
      contrast: 130,
      brightness: 100,
      grayscale: true,
      invert: false
    },
    hudHideTimeout: null
  };

  const STORAGE_KEYS = {
    USER_WORDS: "tv_mide_user_words_v3",
    HISTORY: "tv_mide_history_v3"
  };

  const LANG_CONFIG = {
    sorani:   { ocrCode: "ara", isRTL: true,  name: "Kurdish Sorani" },
    kurmanji: { ocrCode: "eng", isRTL: false, name: "Kurdish Kurmancî" },
    arabic:   { ocrCode: "ara", isRTL: true,  name: "Arabic" },
    english:  { ocrCode: "eng", isRTL: false, name: "English" },
    turkish:  { ocrCode: "tur", isRTL: false, name: "Turkish" },
    persian:  { ocrCode: "fas", isRTL: true,  name: "Persian" }
  };

  // --- DOM CACHE ---
  const DOM = {
    globalLangSelect: document.getElementById("global-lang-select"),
    tabLinks: document.querySelectorAll(".tab-link"),
    tabPanes: document.querySelectorAll(".tab-pane"),
    
    viewfinderContainer: document.getElementById("viewfinder-container"),
    stageWrapper: document.getElementById("stage-wrapper"),
    videoFeed: document.getElementById("video-feed"),
    overlayCanvas: document.getElementById("overlay-canvas"),
    liveIndicator: document.getElementById("live-indicator"),
    sourceLabel: document.getElementById("current-source-label"),
    ocrBadge: document.getElementById("ocr-badge"),
    cropBoxIndicator: document.getElementById("crop-box-indicator"),
    cropZoneSelect: document.getElementById("crop-zone-select"),
    btnToggleSound: document.getElementById("btn-toggle-sound"),
    
    btnStartCamera: document.getElementById("btn-start-camera"),
    btnShareScreen: document.getElementById("btn-share-screen"),
    btnScanFrame: document.getElementById("btn-scan-frame"),
    btnToggleAuto: document.getElementById("btn-toggle-auto"),
    btnFullscreen: document.getElementById("btn-fullscreen"),
    btnStopStream: document.getElementById("btn-stop-stream"),
    imageFileInput: document.getElementById("image-file-input"),
    
    camProHud: document.getElementById("cam-pro-hud"),
    hudHint: document.getElementById("hud-hint"),
    filterContrast: document.getElementById("filter-contrast"),
    filterBrightness: document.getElementById("filter-brightness"),
    toggleGrayscale: document.getElementById("toggle-grayscale"),
    toggleInvert: document.getElementById("toggle-invert"),
    toggleStemmer: document.getElementById("toggle-stemmer"),
    autoScanInterval: document.getElementById("auto-scan-interval"),
    
    countApproved: document.getElementById("count-approved"),
    countUnregistered: document.getElementById("count-unregistered"),
    unregisteredPills: document.getElementById("unregistered-word-pills"),
    ocrRawText: document.getElementById("ocr-raw-text"),
    
    manualTextInput: document.getElementById("manual-text-input"),
    btnCheckText: document.getElementById("btn-check-text"),
    btnClearText: document.getElementById("btn-clear-text"),
    btnCopyCleanText: document.getElementById("btn-copy-clean-text"),
    textAnnotatedResult: document.getElementById("text-annotated-result"),
    textUnregisteredPills: document.getElementById("text-unregistered-pills"),
    
    activeDictLabel: document.getElementById("active-dict-label"),
    dictTotalCount: document.getElementById("dict-total-count"),
    formAddWord: document.getElementById("form-add-word"),
    inputNewWord: document.getElementById("input-new-word"),
    dictSearchInput: document.getElementById("dict-search-input"),
    dictTableBody: document.getElementById("dict-table-body"),
    btnExportJson: document.getElementById("btn-export-json"),
    importJsonInput: document.getElementById("import-json-input"),
    btnResetUserWords: document.getElementById("btn-reset-user-words"),
    
    historyTableBody: document.getElementById("history-table-body"),
    btnClearHistory: document.getElementById("btn-clear-history"),
    btnExportReport: document.getElementById("btn-export-full-report")
  };

  // --- INITIALIZATION ---
  function init() {
    loadUserWordsFromStorage();
    setupEventListeners();
    applyActiveLanguage(STATE.currentLang);
    initProHudInteractivity();
    renderHistoryTable();
  }

  // --- ADVANCED UNICODE & KEYBOARD NORMALIZER ---
  function normalizeWord(rawWord, lang) {
    if (!rawWord || typeof rawWord !== "string") return "";
    let w = rawWord.trim();

    // 1. خاوێنکردنەوە لە خاڵبەندی و هێماکان
    w = w.replace(/^[\s\.,\/#!$%\^&\*;:{}=\-_`~()?"'«»‹›،؛؟\[\]]+/u, "");
    w = w.replace(/[\s\.,\/#!$%\^&\*;:{}=\-_`~()?"'«»‹›،؛؟\[\]]+$/u, "");
    w = w.normalize("NFC");

    // 2. یەکخستنی تەواوی پیتە عەرەبی و فارسییەکان بۆ کوردی ستاندارد
    w = w.replace(/ي/g, "ی"); // یای عەرەبی بۆ کوردی
    w = w.replace(/ى/g, "ی"); // ئەلفی مەقسوورە
    w = w.replace(/ك/g, "ک"); // کافی عەرەبی بۆ کوردی
    w = w.replace(/[\u200B-\u200D\uFEFF]/g, ""); // لابردنی نیشانە نەبینراوەکانی کیبۆرد
    w = w.replace(/\u0640/g, ""); // تەتویل (کشیدە)
    w = w.replace(/[\u064B-\u065F\u0670]/g, ""); // تەشکەلی عەرەبی

    if (lang === "turkish") {
      w = w.toLocaleLowerCase("tr-TR");
    } else if (lang === "kurmanji" || lang === "english") {
      w = w.toLowerCase();
    }

    return w;
  }

  function getFullDictionarySet(lang) {
    const core = (window.TV_MIDE_DICTIONARIES && window.TV_MIDE_DICTIONARIES[lang]) || [];
    const user = STATE.userDictionaries[lang] || [];
    const combined = new Set();

    core.forEach(word => {
      const n = normalizeWord(word, lang);
      if (n) combined.add(n);
    });
    user.forEach(word => {
      const n = normalizeWord(word, lang);
      if (n) combined.add(n);
    });

    return combined;
  }

  function isWordRegistered(word, lang) {
    const normalized = normalizeWord(word, lang);
    if (!normalized) return true;
    const dict = getFullDictionarySet(lang);

    // ئەگەر کوردی بێت و ستیلەکە چالاک بێت، بە مۆرفۆلۆجی زیرەک دەپشکنرێت
    if (lang === "sorani" && STATE.useStemmer) {
      return KurdishMorphology.matchStem(normalized, dict);
    }

    return dict.has(normalized);
  }

  function addWordToDictionary(rawWord, lang) {
    const cleaned = normalizeWord(rawWord, lang);
    if (!cleaned) return false;

    if (!STATE.userDictionaries[lang]) {
      STATE.userDictionaries[lang] = [];
    }

    const dictSet = getFullDictionarySet(lang);
    if (dictSet.has(cleaned)) {
      alert(`"${cleaned}" لەناو فەرهەنگدا هەیە.`);
      return false;
    }

    STATE.userDictionaries[lang].push(cleaned);
    saveUserWordsToStorage();
    refreshDictionaryUI();

    if (STATE.lastRecognizedWords.length > 0) {
      reevaluateAndRenderOverlay();
    }
    return true;
  }

  function removeUserWord(word, lang) {
    if (!STATE.userDictionaries[lang]) return;
    const norm = normalizeWord(word, lang);
    STATE.userDictionaries[lang] = STATE.userDictionaries[lang].filter(w => normalizeWord(w, lang) !== norm);
    saveUserWordsToStorage();
    refreshDictionaryUI();
    if (STATE.lastRecognizedWords.length > 0) reevaluateAndRenderOverlay();
  }

  function loadUserWordsFromStorage() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.USER_WORDS);
      STATE.userDictionaries = data ? JSON.parse(data) : {};
    } catch (e) {
      STATE.userDictionaries = {};
    }
  }

  function saveUserWordsToStorage() {
    try {
      localStorage.setItem(STORAGE_KEYS.USER_WORDS, JSON.stringify(STATE.userDictionaries));
    } catch (e) {
      console.error(e);
    }
  }

  function applyActiveLanguage(lang) {
    STATE.currentLang = lang;
    DOM.globalLangSelect.value = lang;
    DOM.activeDictLabel.textContent = LANG_CONFIG[lang].name;
    const dir = LANG_CONFIG[lang].isRTL ? "rtl" : "ltr";
    DOM.manualTextInput.setAttribute("dir", dir);
    DOM.textAnnotatedResult.setAttribute("dir", dir);
    DOM.ocrRawText.setAttribute("dir", dir);

    refreshDictionaryUI();
    if (STATE.lastRecognizedWords.length > 0) reevaluateAndRenderOverlay();
  }

  // --- PRO HUD & FILTERS ---
  function initProHudInteractivity() {
    const showHud = () => {
      DOM.camProHud.classList.remove("hud-hidden");
      DOM.hudHint.style.display = "none";
      clearTimeout(STATE.hudHideTimeout);
      STATE.hudHideTimeout = setTimeout(() => {
        DOM.camProHud.classList.add("hud-hidden");
      }, 4000);
    };

    DOM.stageWrapper.addEventListener("touchstart", showHud, { passive: true });
    DOM.stageWrapper.addEventListener("click", showHud);
    DOM.camProHud.querySelector(".hud-close").addEventListener("click", (e) => {
      e.stopPropagation();
      DOM.camProHud.classList.add("hud-hidden");
    });

    const updateFilters = () => {
      let f = `contrast(${STATE.proFilters.contrast}%) brightness(${STATE.proFilters.brightness}%)`;
      if (STATE.proFilters.grayscale) f += " grayscale(100%)";
      if (STATE.proFilters.invert) f += " invert(100%)";
      DOM.videoFeed.style.filter = f;
    };

    DOM.filterContrast.addEventListener("input", (e) => {
      STATE.proFilters.contrast = e.target.value;
      updateFilters();
    });

    DOM.filterBrightness.addEventListener("input", (e) => {
      STATE.proFilters.brightness = e.target.value;
      updateFilters();
    });

    DOM.toggleGrayscale.addEventListener("click", () => {
      STATE.proFilters.grayscale = !STATE.proFilters.grayscale;
      DOM.toggleGrayscale.classList.toggle("active", STATE.proFilters.grayscale);
      updateFilters();
    });

    DOM.toggleInvert.addEventListener("click", () => {
      STATE.proFilters.invert = !STATE.proFilters.invert;
      DOM.toggleInvert.classList.toggle("active", STATE.proFilters.invert);
      updateFilters();
    });

    DOM.toggleStemmer.addEventListener("click", () => {
      STATE.useStemmer = !STATE.useStemmer;
      DOM.toggleStemmer.classList.toggle("active", STATE.useStemmer);
      if (STATE.lastRecognizedWords.length > 0) reevaluateAndRenderOverlay();
    });

    DOM.btnToggleSound.addEventListener("click", () => {
      StudioAudio.enabled = !StudioAudio.enabled;
      DOM.btnToggleSound.textContent = StudioAudio.enabled ? "🔔 Alert Sound: ON" : "🔕 Alert Sound: OFF";
      DOM.btnToggleSound.classList.toggle("btn-success", StudioAudio.enabled);
    });

    DOM.cropZoneSelect.addEventListener("change", (e) => {
      STATE.cropZone = e.target.value;
      DOM.cropBoxIndicator.className = `crop-box-${e.target.value}`;
    });

    updateFilters();
  }

  // --- STREAMING (CAMERA & SCREEN SHARE) ---
  async function startCameraStream() {
    stopCurrentStream();
    try {
      DOM.ocrBadge.textContent = "Connecting Camera...";
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
        audio: false
      });
      attachStream(stream, "Mobile / Studio Camera", "camera");
    } catch (err) {
      alert("Error: Camera access denied or not HTTPS.");
      DOM.ocrBadge.textContent = "Camera Error";
    }
  }

  async function startScreenShareStream() {
    stopCurrentStream();
    if (!navigator.mediaDevices?.getDisplayMedia) {
      alert("Screen sharing not supported on this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      attachStream(stream, "Screen / Window Stream", "screen");
    } catch (err) {
      DOM.ocrBadge.textContent = "Screen Share Idle";
    }
  }

  function attachStream(stream, label, type) {
    STATE.activeStream = stream;
    STATE.streamType = type;
    DOM.videoFeed.srcObject = stream;
    DOM.sourceLabel.textContent = `Source: ${label}`;
    DOM.liveIndicator.classList.add("active");
    DOM.liveIndicator.innerHTML = '<span class="dot"></span> ON AIR';

    DOM.btnScanFrame.disabled = false;
    DOM.btnToggleAuto.disabled = false;
    DOM.btnStopStream.disabled = false;
    DOM.ocrBadge.textContent = "Feed Active";

    stream.getVideoTracks()[0].addEventListener("ended", stopCurrentStream);
    DOM.videoFeed.onloadedmetadata = adjustCanvasDimensions;
  }

  function stopCurrentStream() {
    if (STATE.autoScanTimer) {
      clearInterval(STATE.autoScanTimer);
      STATE.autoScanTimer = null;
      STATE.isAutoScanActive = false;
      DOM.btnToggleAuto.textContent = "Auto-Scan: OFF";
      DOM.btnToggleAuto.classList.replace("btn-success", "btn-secondary");
    }
    if (STATE.activeStream) {
      STATE.activeStream.getTracks().forEach(t => t.stop());
      STATE.activeStream = null;
    }
    DOM.videoFeed.srcObject = null;
    DOM.sourceLabel.textContent = "Source: None";
    DOM.liveIndicator.classList.remove("active");
    DOM.liveIndicator.innerHTML = '<span class="dot"></span> STANDBY';

    DOM.btnScanFrame.disabled = true;
    DOM.btnToggleAuto.disabled = true;
    DOM.btnStopStream.disabled = true;
    DOM.ocrBadge.textContent = "Engine Ready";
    clearOverlayCanvas();
  }

  function adjustCanvasDimensions() {
    const v = DOM.videoFeed;
    if (!v.videoWidth) return;
    DOM.overlayCanvas.width = v.videoWidth;
    DOM.overlayCanvas.height = v.videoHeight;
    if (STATE.lastRecognizedWords.length > 0) drawBoundingBoxes(STATE.lastRecognizedWords);
  }

  window.addEventListener("resize", adjustCanvasDimensions);
  window.addEventListener("orientationchange", () => setTimeout(adjustCanvasDimensions, 300));

  function toggleFullscreen() {
    const stage = DOM.viewfinderContainer;
    if (!document.fullscreenElement) {
      stage.requestFullscreen ? stage.requestFullscreen() : stage.webkitRequestFullscreen();
      DOM.btnFullscreen.textContent = "✕ Exit Fullscreen";
    } else {
      document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen();
      DOM.btnFullscreen.textContent = "⛶ Fullscreen Camera";
    }
  }

  // --- OCR SCANNING WITH SMART SAFE-ZONE CROP ---
  async function performOcrOnCurrentView() {
    if (STATE.isOcrBusy) return;
    const v = DOM.videoFeed;
    if (!v.videoWidth) return;

    STATE.isOcrBusy = true;
    DOM.ocrBadge.textContent = "Cropping Zone...";

    // دیاریکردنی زۆنی تایتڵەکان بۆ خێرایی و نەمانی کێشەی دەموچاوی بێژەر
    let cropY = 0;
    let cropH = v.videoHeight;
    if (STATE.cropZone === "lower-third") {
      cropY = Math.floor(v.videoHeight * 0.60);
      cropH = Math.floor(v.videoHeight * 0.36);
    } else if (STATE.cropZone === "ticker") {
      cropY = Math.floor(v.videoHeight * 0.78);
      cropH = Math.floor(v.videoHeight * 0.18);
    }

    const offscreen = document.createElement("canvas");
    offscreen.width = v.videoWidth;
    offscreen.height = cropH;
    const ctx = offscreen.getContext("2d");

    ctx.filter = `contrast(${STATE.proFilters.contrast}%) brightness(${STATE.proFilters.brightness}%) ${STATE.proFilters.grayscale ? "grayscale(100%)" : ""}`;
    ctx.drawImage(v, 0, cropY, v.videoWidth, cropH, 0, 0, v.videoWidth, cropH);

    DOM.ocrBadge.textContent = `Scanning (${LANG_CONFIG[STATE.currentLang].ocrCode})...`;

    try {
      const res = await Tesseract.recognize(offscreen, LANG_CONFIG[STATE.currentLang].ocrCode);
      
      // بۆکسەکان بگێڕەوە بۆ شوێنی ئەسڵی لەسەر تەواوی شاشەکە
      const adjustedWords = (res.data?.words || []).map(w => ({
        ...w,
        bbox: {
          x0: w.bbox.x0,
          x1: w.bbox.x1,
          y0: w.bbox.y0 + cropY,
          y1: w.bbox.y1 + cropY
        }
      }));

      processOcrResult({ words: adjustedWords, text: res.data.text }, "stream");
      DOM.ocrBadge.textContent = "Scan Done";
    } catch (e) {
      console.error(e);
      DOM.ocrBadge.textContent = "OCR Error";
    } finally {
      STATE.isOcrBusy = false;
    }
  }

  function processOcrResult(ocrData, scanType) {
    const rawWords = ocrData?.words || [];
    DOM.ocrRawText.textContent = ocrData?.text?.trim() || "—";
    STATE.lastRecognizedWords = rawWords;
    evaluateWordsAndRender(rawWords, scanType);
  }

  function evaluateWordsAndRender(words, scanType) {
    let approved = 0;
    let unregistered = 0;
    const unregMap = new Map();

    const evaluated = words.map(w => {
      const norm = normalizeWord(w.text, STATE.currentLang);
      const isReg = isWordRegistered(w.text, STATE.currentLang);

      if (norm.length > 0) {
        if (isReg) {
          approved++;
        } else {
          unregistered++;
          unregMap.set(norm, w.text);
        }
      }

      return { raw: w.text, normalized: norm, registered: isReg, bbox: w.bbox };
    });

    DOM.countApproved.textContent = approved;
    DOM.countUnregistered.textContent = unregistered;

    // لێدانی بیپی ستۆدیۆ ئەگەر وشەی سوور هەبێت
    if (unregistered > 0) {
      StudioAudio.playAlert();
    }

    renderUnregisteredPills(unregMap);
    drawBoundingBoxes(evaluated);

    if (scanType) {
      saveAuditRecord({
        timestamp: new Date().toLocaleTimeString(),
        lang: STATE.currentLang,
        mode: scanType === "stream" ? (STATE.streamType === "camera" ? "Camera" : "Screen") : "Image",
        total: approved + unregistered,
        approved: approved,
        unregistered: unregistered,
        preview: words.map(w => w.text).join(" ").substring(0, 80) + "..."
      });
    }
  }

  function reevaluateAndRenderOverlay() {
    evaluateWordsAndRender(STATE.lastRecognizedWords, null);
  }

  function clearOverlayCanvas() {
    const ctx = DOM.overlayCanvas.getContext("2d");
    ctx.clearRect(0, 0, DOM.overlayCanvas.width, DOM.overlayCanvas.height);
  }

  function drawBoundingBoxes(evaluatedWords) {
    const ctx = DOM.overlayCanvas.getContext("2d");
    ctx.clearRect(0, 0, DOM.overlayCanvas.width, DOM.overlayCanvas.height);

    evaluatedWords.forEach(item => {
      if (!item.bbox || !item.normalized) return;
      const { x0, y0, x1, y1 } = item.bbox;
      const w = x1 - x0;
      const h = y1 - y0;

      if (!item.registered) {
        // وشەی نەناسراو: هێڵی سوور و تایتڵی ئاگادارکەرەوە
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 3;
        ctx.strokeRect(x0, y0, w, h);
        ctx.fillStyle = "rgba(239, 68, 68, 0.25)";
        ctx.fillRect(x0, y0, w, h);

        ctx.fillStyle = "#ef4444";
        ctx.font = "bold 13px system-ui";
        ctx.fillText("UNKNOWN", x0, Math.max(14, y0 - 4));
      }
    });
  }

  function renderUnregisteredPills(unregMap) {
    DOM.unregisteredPills.innerHTML = "";
    if (unregMap.size === 0) {
      DOM.unregisteredPills.innerHTML = '<p class="empty-state">All visible words are approved.</p>';
      return;
    }

    unregMap.forEach((rawText, norm) => {
      const pill = document.createElement("div");
      pill.className = "unregistered-pill";
      pill.innerHTML = `<span>${rawText}</span><button class="btn-quick-add" title="Approve">+</button>`;
      pill.querySelector(".btn-quick-add").addEventListener("click", () => {
        addWordToDictionary(norm, STATE.currentLang);
      });
      DOM.unregisteredPills.appendChild(pill);
    });
  }

  // --- MANUAL TEXT CHECKER ---
  function checkManualText() {
    const text = DOM.manualTextInput.value;
    if (!text.trim()) return;

    const tokens = text.split(/([\s\.,\/#!$%\^&\*;:{}=\-_`~()?"'«»‹›،؛؟\[\]]+)/u);
    const unregMap = new Map();

    const formatted = tokens.map(token => {
      const clean = normalizeWord(token, STATE.currentLang);
      if (!clean) return token;

      const registered = isWordRegistered(token, STATE.currentLang);
      if (registered) {
        return `<span class="word-highlight-clean">${token}</span>`;
      } else {
        unregMap.set(clean, token);
        return `<span class="word-highlight-red">${token}</span>`;
      }
    });

    DOM.textAnnotatedResult.innerHTML = formatted.join("");
    DOM.textUnregisteredPills.innerHTML = "";
    if (unregMap.size === 0) {
      DOM.textUnregisteredPills.innerHTML = '<p class="empty-state">All words approved!</p>';
    } else {
      unregMap.forEach((raw, clean) => {
        const pill = document.createElement("div");
        pill.className = "unregistered-pill";
        pill.innerHTML = `<span>${raw}</span><button class="btn-quick-add">+</button>`;
        pill.querySelector(".btn-quick-add").addEventListener("click", () => {
          addWordToDictionary(clean, STATE.currentLang);
          checkManualText();
        });
        DOM.textUnregisteredPills.appendChild(pill);
      });
    }
  }

  // --- DICTIONARY UI ---
  function refreshDictionaryUI() {
    const lang = STATE.currentLang;
    const core = (window.TV_MIDE_DICTIONARIES && window.TV_MIDE_DICTIONARIES[lang]) || [];
    const user = STATE.userDictionaries[lang] || [];
    DOM.dictTotalCount.textContent = (core.length + user.length).toLocaleString();

    const query = DOM.dictSearchInput.value.toLowerCase().trim();
    DOM.dictTableBody.innerHTML = "";

    const items = [
      ...user.map(w => ({ word: w, origin: "User Added" })),
      ...core.map(w => ({ word: w, origin: "Core File" }))
    ].filter(i => i.word.toLowerCase().includes(query));

    items.forEach(item => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td dir="auto"><strong>${item.word}</strong></td>
        <td><span class="chip ${item.origin === 'User Added' ? 'chip-green' : ''}">${item.origin}</span></td>
        <td>${item.origin === "User Added" ? `<button class="btn btn-danger-outline btn-sm btn-del" data-w="${item.word}">Delete</button>` : `<span style="color:var(--text-muted); font-size:0.75rem;">Core</span>`}</td>
      `;
      row.querySelector(".btn-del")?.addEventListener("click", () => removeUserWord(item.word, STATE.currentLang));
      DOM.dictTableBody.appendChild(row);
    });
  }

  // --- HISTORY AUDIT ---
  function getAuditHistory() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveAuditRecord(rec) {
    const h = getAuditHistory();
    h.unshift(rec);
    if (h.length > 50) h.pop();
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(h));
    renderHistoryTable();
  }

  function renderHistoryTable() {
    const h = getAuditHistory();
    DOM.historyTableBody.innerHTML = "";
    h.forEach(item => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${item.timestamp}</td>
        <td><strong>${LANG_CONFIG[item.lang]?.name || item.lang}</strong></td>
        <td>${item.mode}</td>
        <td>${item.total}</td>
        <td style="color:var(--success-green);">${item.approved}</td>
        <td style="color:var(--danger-red);">${item.unregistered}</td>
        <td dir="auto" style="font-size:0.78rem; color:var(--text-muted);">${item.preview}</td>
      `;
      DOM.historyTableBody.appendChild(row);
    });
  }

  // --- LISTENERS ---
  function setupEventListeners() {
    DOM.tabLinks.forEach(l => l.addEventListener("click", () => {
      DOM.tabLinks.forEach(x => x.classList.remove("active"));
      DOM.tabPanes.forEach(x => x.classList.remove("active"));
      l.classList.add("active");
      document.getElementById(l.dataset.tab).classList.add("active");
    }));

    DOM.globalLangSelect.addEventListener("change", (e) => applyActiveLanguage(e.target.value));
    DOM.btnStartCamera.addEventListener("click", startCameraStream);
    DOM.btnShareScreen.addEventListener("click", startScreenShareStream);
    DOM.btnStopStream.addEventListener("click", stopCurrentStream);
    DOM.btnScanFrame.addEventListener("click", performOcrOnCurrentView);
    DOM.btnFullscreen.addEventListener("click", toggleFullscreen);

    DOM.btnToggleAuto.addEventListener("click", () => {
      STATE.isAutoScanActive = !STATE.isAutoScanActive;
      if (STATE.isAutoScanActive) {
        DOM.btnToggleAuto.textContent = "Auto-Scan: ON";
        DOM.btnToggleAuto.classList.replace("btn-secondary", "btn-success");
        performOcrOnCurrentView();
        STATE.autoScanTimer = setInterval(performOcrOnCurrentView, parseInt(DOM.autoScanInterval.value) || 3500);
      } else {
        clearInterval(STATE.autoScanTimer);
        DOM.btnToggleAuto.textContent = "Auto-Scan: OFF";
        DOM.btnToggleAuto.classList.replace("btn-success", "btn-secondary");
      }
    });

    DOM.btnCheckText.addEventListener("click", checkManualText);
    DOM.btnClearText.addEventListener("click", () => {
      DOM.manualTextInput.value = "";
      DOM.textAnnotatedResult.innerHTML = "";
    });

    DOM.formAddWord.addEventListener("submit", () => {
      if (addWordToDictionary(DOM.inputNewWord.value, STATE.currentLang)) {
        DOM.inputNewWord.value = "";
      }
    });

    DOM.dictSearchInput.addEventListener("input", refreshDictionaryUI);
    DOM.btnResetUserWords.addEventListener("click", () => {
      if (confirm("Reset your added words?")) {
        STATE.userDictionaries[STATE.currentLang] = [];
        saveUserWordsToStorage();
        refreshDictionaryUI();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
