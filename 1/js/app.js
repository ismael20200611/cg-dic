/**
 * TV MIDE CG DESK - Main Application Logic
 * Multilingual Dictionary-Based OCR & Live Camera/Screen Share Recognition System
 */

document.addEventListener("DOMContentLoaded", () => {
    const RTL_LANGUAGES = new Set(["sorani", "arabic", "persian"]);

    // Application State
    const state = {
        currentLanguage: "sorani",
        scanZone: "lower-third", // "full" | "lower-third" | "center"
        minConfidence: 65,      // Filters out low-confidence OCR noise
        userWords: {},
        history: [],
        cameraStream: null,
        ocrWorker: null,
        isScanning: false,
        scanLoopTimer: null,
        lastOcrResult: null,
        lastSourceType: "video", // "video" | "image"
        lastUploadedImage: null,
        currentRotation: 0,
        scanIntervalMs: 3000
    };

    // DOM Elements
    const languageSelect = document.getElementById("language-select");
    const scanZoneSelect = document.getElementById("scan-zone-select");
    const dictCountBadge = document.getElementById("dict-count-badge");
    const ocrStatusBadge = document.getElementById("ocr-status-badge");

    // Capture & Fullscreen / OSD Elements
    const cameraViewportContainer = document.getElementById("camera-viewport-container");
    const cameraVideo = document.getElementById("camera-video");
    const overlayCanvas = document.getElementById("overlay-canvas");
    const cameraPlaceholder = document.getElementById("camera-placeholder");
    const cameraOsdMenu = document.getElementById("camera-osd-menu");

    const btnStartCamera = document.getElementById("btn-start-camera");
    const btnStartScreenShare = document.getElementById("btn-start-screen-share");
    const btnStopCamera = document.getElementById("btn-stop-camera");
    const btnScanNow = document.getElementById("btn-scan-now");
    const btnFullscreenMain = document.getElementById("btn-fullscreen-main");
    const btnRotateMain = document.getElementById("btn-rotate-main");
    const imageUploadInput = document.getElementById("image-upload-input");

    // OSD Menu Buttons & Hardware Controls
    const btnOsdScan = document.getElementById("btn-osd-scan");
    const btnOsdStop = document.getElementById("btn-osd-stop");
    const btnRotateScreen = document.getElementById("btn-rotate-screen");
    const btnToggleFullscreen = document.getElementById("btn-toggle-fullscreen");

    const rangeScanSpeed = document.getElementById("range-scan-speed");
    const scanIntervalVal = document.getElementById("scan-interval-val");
    const rangeConfidence = document.getElementById("range-confidence");
    const confVal = document.getElementById("conf-val");
    const rangeIso = document.getElementById("range-iso");
    const isoVal = document.getElementById("iso-val");
    const rangeBrightness = document.getElementById("range-brightness");
    const expVal = document.getElementById("exp-val");
    const selectFocus = document.getElementById("select-focus");

    // Rich Text Formatting & Checker Elements
    const fontFamilySelect = document.getElementById("font-family-select");
    const textColorPicker = document.getElementById("text-color-picker");
    const btnClearFormat = document.getElementById("btn-clear-format");
    const textCheckerInput = document.getElementById("text-checker-input");
    const btnCheckText = document.getElementById("btn-check-text");
    const btnClearText = document.getElementById("btn-clear-text");
    const btnCopyText = document.getElementById("btn-copy-text");
    const textCheckerResults = document.getElementById("text-checker-results");

    // Dictionary Manager Elements
    const newWordInput = document.getElementById("new-word-input");
    const btnAddWord = document.getElementById("btn-add-word");
    const dictSearchInput = document.getElementById("dict-search-input");
    const btnExportDict = document.getElementById("btn-export-dict");
    const importDictInput = document.getElementById("import-dict-input");
    const btnResetDict = document.getElementById("btn-reset-dict");
    const dictionaryWordList = document.getElementById("dictionary-word-list");

    // History & Export Elements
    const historyList = document.getElementById("history-list");
    const btnExportReport = document.getElementById("btn-export-report");
    const btnClearHistory = document.getElementById("btn-clear-history");

    const tesseractLangMap = {
        sorani: "ara+fas",
        kurmanji: "tur+eng",
        arabic: "ara",
        english: "eng",
        turkish: "tur",
        persian: "fas"
    };

    let osdHideTimeout = null;

    function init() {
        loadLocalStorage();
        applyTextDirection();
        setupFormattingToolbar();
        updateDictionaryUI();
        setupEventListeners();
        initTesseractWorker();
    }

    function loadLocalStorage() {
        try {
            const savedUserWords = localStorage.getItem("tvmide_user_words_v2");
            if (savedUserWords) {
                state.userWords = JSON.parse(savedUserWords);
            }
            const savedHistory = localStorage.getItem("tvmide_scan_history_v2");
            if (savedHistory) {
                state.history = JSON.parse(savedHistory);
                renderHistory();
            }
        } catch (e) {
            console.error("Error loading local storage:", e);
        }
    }

    function saveUserWords() {
        localStorage.setItem("tvmide_user_words_v2", JSON.stringify(state.userWords));
    }

    function saveHistory() {
        localStorage.setItem("tvmide_scan_history_v2", JSON.stringify(state.history));
    }

    function applyTextDirection() {
        const isRtl = RTL_LANGUAGES.has(state.currentLanguage);
        const dir = isRtl ? "rtl" : "ltr";
        document.documentElement.dir = dir;
        document.documentElement.lang = state.currentLanguage;
        if (textCheckerInput) textCheckerInput.dir = dir;
        if (textCheckerResults) textCheckerResults.dir = dir;
    }

    // --- Font Family, Bold, Italic, Underline & Text Color ---
    function setupFormattingToolbar() {
        if (fontFamilySelect) {
            fontFamilySelect.addEventListener("change", () => {
                const selectedFont = fontFamilySelect.value;
                document.documentElement.style.setProperty("--active-font", selectedFont);
                if (textCheckerInput) textCheckerInput.style.fontFamily = selectedFont;
                if (textCheckerResults) textCheckerResults.style.fontFamily = selectedFont;

                const sel = window.getSelection();
                if (sel && !sel.isCollapsed && textCheckerInput && textCheckerInput.contains(sel.anchorNode)) {
                    document.execCommand("fontName", false, selectedFont);
                }
                if (textCheckerInput) textCheckerInput.focus();
            });
        }

        document.querySelectorAll(".fmt-btn[data-cmd]").forEach(btn => {
            btn.addEventListener("mousedown", (e) => {
                e.preventDefault();
                const cmd = btn.getAttribute("data-cmd");
                document.execCommand(cmd, false, null);
                updateFormattingButtonStates();
            });
        });

        if (textColorPicker) {
            textColorPicker.addEventListener("input", () => {
                document.execCommand("styleWithCSS", false, true);
                document.execCommand("foreColor", false, textColorPicker.value);
                if (textCheckerInput) textCheckerInput.focus();
            });
        }

        if (btnClearFormat) {
            btnClearFormat.addEventListener("click", () => {
                document.execCommand("removeFormat", false, null);
                if (textCheckerInput) {
                    textCheckerInput.style.fontFamily = fontFamilySelect ? fontFamilySelect.value : "";
                    textCheckerInput.focus();
                }
                updateFormattingButtonStates();
            });
        }

        if (textCheckerInput) {
            textCheckerInput.addEventListener("keyup", updateFormattingButtonStates);
            textCheckerInput.addEventListener("mouseup", updateFormattingButtonStates);
        }
    }

    function updateFormattingButtonStates() {
        document.querySelectorAll(".fmt-btn[data-cmd]").forEach(btn => {
            const cmd = btn.getAttribute("data-cmd");
            try {
                btn.classList.toggle("active", document.queryCommandState(cmd));
            } catch (_) {
                // Ignore unsupported command query
            }
        });
    }

    function normalizeToken(word) {
        if (!word) return "";
        return word
            .trim()
            .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
            .replace(/[\u064B-\u065F\u0670]/g, "")
            .replace(/ي/g, "ی")
            .replace(/ك/g, "ک")
            .toLowerCase();
    }

    // Filters out background noise, stray symbols, and low-confidence OCR garbage
    function isNoiseOrUnwantedToken(rawText, confidence = 100) {
        if (typeof confidence === "number" && confidence < state.minConfidence) {
            return true;
        }
        const cleaned = normalizeToken(rawText);
        if (!cleaned || cleaned.length < 2) return true;
        const letters = cleaned.match(/\p{L}/gu) || [];
        if (letters.length < 2) return true;
        if (/[^\p{L}\p{N}\u200c\-']/u.test(cleaned)) return true;
        return false;
    }

    function getActiveDictionary(lang = state.currentLanguage) {
        const baseDict = (window.TVMIDE_DICTIONARIES && window.TVMIDE_DICTIONARIES[lang]) || [];
        const userList = (state.userWords && state.userWords[lang]) || [];
        const combined = [...baseDict, ...userList].map(w => normalizeToken(w)).filter(Boolean);
        return new Set(combined);
    }

    function updateDictionaryUI() {
        const lang = state.currentLanguage;
        const dictSet = getActiveDictionary(lang);
        dictCountBadge.textContent = `Dictionary Words: ${dictSet.size}`;

        const searchTerm = normalizeToken(dictSearchInput.value || "");
        dictionaryWordList.innerHTML = "";

        const sortedWords = Array.from(dictSet).sort();
        let count = 0;

        sortedWords.forEach(word => {
            if (searchTerm && !word.includes(searchTerm)) return;
            count++;

            const li = document.createElement("li");
            li.innerHTML = `
                <span>${escapeHtml(word)}</span>
                <button data-word="${escapeHtml(word)}" class="btn-delete-word" title="Remove word">✕</button>
            `;
            dictionaryWordList.appendChild(li);
        });

        if (count === 0) {
            dictionaryWordList.innerHTML = `<li style="justify-content: center; color: var(--text-muted);">No words found.</li>`;
        }

        document.querySelectorAll(".btn-delete-word").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const wordToRemove = e.target.getAttribute("data-word");
                removeWordFromDictionary(wordToRemove);
            });
        });
    }

    function addWordToDictionary(word) {
        const cleanWord = normalizeToken(word);
        if (!cleanWord) return;

        const lang = state.currentLanguage;
        if (!state.userWords[lang]) {
            state.userWords[lang] = [];
        }

        const dictSet = getActiveDictionary(lang);
        if (dictSet.has(cleanWord)) {
            alert(`"${cleanWord}" already exists in the ${lang} dictionary.`);
            return;
        }

        state.userWords[lang].push(cleanWord);
        saveUserWords();
        updateDictionaryUI();
        newWordInput.value = "";

        if (state.lastOcrResult) {
            drawOcrOverlay(state.lastOcrResult);
        }

        if (textCheckerInput && textCheckerInput.innerText.trim()) {
            runTextCheck();
        }
    }

    function removeWordFromDictionary(word) {
        const lang = state.currentLanguage;
        const baseDict = ((window.TVMIDE_DICTIONARIES && window.TVMIDE_DICTIONARIES[lang]) || [])
            .map(w => normalizeToken(w));

        if (baseDict.includes(word)) {
            alert("This word is part of the core base dictionary file and cannot be removed directly. You can only remove user-added custom words.");
            return;
        }

        if (state.userWords[lang]) {
            state.userWords[lang] = state.userWords[lang].filter(w => normalizeToken(w) !== word);
            saveUserWords();
            updateDictionaryUI();

            if (state.lastOcrResult) {
                drawOcrOverlay(state.lastOcrResult);
            }
        }
    }

    function runTextCheck() {
        const text = (textCheckerInput ? textCheckerInput.innerText : "").trim();
        if (!text) {
            textCheckerResults.innerHTML = `<p class="placeholder-text">Please enter or paste text to check.</p>`;
            return;
        }

        const dictSet = getActiveDictionary(state.currentLanguage);
        const tokens = text.split(/(\s+)/);

        let recognizedCount = 0;
        let unregisteredCount = 0;
        let htmlOutput = "";

        tokens.forEach(token => {
            if (/^\s+$/.test(token)) {
                htmlOutput += token.replace(/\n/g, "<br>");
                return;
            }

            const cleanToken = normalizeToken(token);
            if (!cleanToken) {
                htmlOutput += `<span>${escapeHtml(token)}</span>`;
                return;
            }

            const isFound = dictSet.has(cleanToken);
            if (isFound) {
                recognizedCount++;
                htmlOutput += `<span class="word-pill registered" title="Registered in dictionary">${escapeHtml(token)}</span>`;
            } else {
                unregisteredCount++;
                htmlOutput += `<span class="word-pill unregistered" title="Not found in dictionary (Click to add)" data-add-word="${escapeHtml(cleanToken)}">${escapeHtml(token)}</span>`;
            }
        });

        textCheckerResults.innerHTML = htmlOutput;
        textCheckerResults.querySelectorAll(".word-pill.unregistered").forEach(pill => {
            pill.addEventListener("click", () => {
                const targetWord = pill.getAttribute("data-add-word");
                if (targetWord && confirm(`Add "${targetWord}" to the ${state.currentLanguage} dictionary?`)) {
                    addWordToDictionary(targetWord);
                }
            });
        });

        addHistoryRecord({
            type: "Text Check",
            language: state.currentLanguage,
            summary: `Recognized: ${recognizedCount}, Unregistered: ${unregisteredCount}`,
            source: text
        });
    }

    async function initTesseractWorker() {
        try {
            ocrStatusBadge.textContent = "Loading OCR...";
            ocrStatusBadge.className = "badge processing";

            const langCode = tesseractLangMap[state.currentLanguage] || "eng";
            state.ocrWorker = await Tesseract.createWorker(langCode);
            await state.ocrWorker.setParameters({
                tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
                preserve_interword_spaces: "1"
            });

            ocrStatusBadge.textContent = "OCR Ready";
            ocrStatusBadge.className = "badge ready";
        } catch (err) {
            console.error("Failed to initialize Tesseract worker:", err);
            ocrStatusBadge.textContent = "OCR Error";
            ocrStatusBadge.className = "badge danger";
        }
    }

    async function changeOcrLanguage(lang) {
        if (state.ocrWorker) {
            try {
                await state.ocrWorker.terminate();
            } catch (_) {}
        }
        ocrStatusBadge.textContent = "Switching OCR...";
        ocrStatusBadge.className = "badge processing";

        try {
            const langCode = tesseractLangMap[lang] || "eng";
            state.ocrWorker = await Tesseract.createWorker(langCode);
            await state.ocrWorker.setParameters({
                tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
                preserve_interword_spaces: "1"
            });
            ocrStatusBadge.textContent = "OCR Ready";
            ocrStatusBadge.className = "badge ready";
        } catch (err) {
            console.error("Error switching OCR language:", err);
            ocrStatusBadge.textContent = "OCR Error";
            ocrStatusBadge.className = "badge danger";
        }
    }

    function getScanCropRect(width, height) {
        if (state.scanZone === "lower-third") {
            return { x: 0, y: Math.floor(height * 0.65), w: width, h: Math.floor(height * 0.35) };
        }
        if (state.scanZone === "center") {
            return { x: Math.floor(width * 0.1), y: Math.floor(height * 0.35), w: Math.floor(width * 0.8), h: Math.floor(height * 0.3) };
        }
        return { x: 0, y: 0, w: width, h: height };
    }

    async function startCamera() {
        stopCamera();
        try {
            const constraints = {
                video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
            };
            state.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
            setupActiveStream();
        } catch (err) {
            alert("Camera access denied or unavailable: " + err.message);
        }
    }

    async function startScreenShare() {
        stopCamera();
        try {
            const constraints = {
                video: { cursor: "always" },
                audio: false
            };
            state.cameraStream = await navigator.mediaDevices.getDisplayMedia(constraints);

            state.cameraStream.getVideoTracks()[0].onended = () => {
                stopCamera();
            };

            setupActiveStream();
            addHistoryRecord({
                type: "Screen Share",
                language: state.currentLanguage,
                summary: "Live screen/window share capture active.",
                source: "DisplayMedia API"
            });
        } catch (err) {
            console.error("Screen share permission denied or cancelled:", err);
        }
    }

    function setupActiveStream() {
        state.lastSourceType = "video";
        cameraVideo.srcObject = state.cameraStream;
        cameraVideo.style.display = "block";
        cameraPlaceholder.style.display = "none";

        btnStartCamera.disabled = true;
        btnStartScreenShare.disabled = true;
        btnStopCamera.disabled = false;
        btnScanNow.disabled = false;
        btnFullscreenMain.disabled = false;
        btnRotateMain.disabled = false;

        state.isScanning = true;
        scheduleNextScan();
    }

    function scheduleNextScan() {
        if (state.scanLoopTimer) clearTimeout(state.scanLoopTimer);
        if (!state.isScanning) return;
        state.scanLoopTimer = setTimeout(async () => {
            await performOcrOnVideoFrame();
            scheduleNextScan();
        }, state.scanIntervalMs);
    }

    function stopCamera() {
        state.isScanning = false;
        if (state.scanLoopTimer) {
            clearTimeout(state.scanLoopTimer);
            state.scanLoopTimer = null;
        }
        if (state.cameraStream) {
            state.cameraStream.getTracks().forEach(track => track.stop());
            state.cameraStream = null;
        }
        cameraVideo.style.display = "none";
        cameraPlaceholder.style.display = "block";
        const ctx = overlayCanvas.getContext("2d");
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        cameraOsdMenu.classList.remove("visible");

        btnStartCamera.disabled = false;
        btnStartScreenShare.disabled = false;
        btnStopCamera.disabled = true;
        btnScanNow.disabled = true;
        btnFullscreenMain.disabled = true;
        btnRotateMain.disabled = true;
    }

    async function performOcrOnVideoFrame() {
        if (!state.ocrWorker || cameraVideo.paused || cameraVideo.ended) return;
        const vw = cameraVideo.videoWidth;
        const vh = cameraVideo.videoHeight;
        if (!vw || !vh) return;

        try {
            const crop = getScanCropRect(vw, vh);
            const cropCanvas = document.createElement("canvas");
            cropCanvas.width = crop.w;
            cropCanvas.height = crop.h;
            const cctx = cropCanvas.getContext("2d");
            cctx.filter = "grayscale(100%) contrast(145%)";
            cctx.drawImage(cameraVideo, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);

            const result = await state.ocrWorker.recognize(cropCanvas);
            state.lastSourceType = "video";
            state.lastOcrResult = {
                width: vw,
                height: vh,
                crop,
                words: (result.data && result.data.words) || []
            };
            drawOcrOverlay(state.lastOcrResult);
        } catch (err) {
            console.error("OCR Frame error:", err);
        }
    }

    function toggleFullscreen() {
        const el = cameraViewportContainer;
        const isInFullscreen = document.fullscreenElement || document.webkitFullscreenElement;

        if (!isInFullscreen) {
            if (el.requestFullscreen) {
                el.requestFullscreen().catch(err => console.log(err));
            } else if (el.webkitRequestFullscreen) {
                el.webkitRequestFullscreen();
            } else if (cameraVideo.webkitEnterFullscreen) {
                cameraVideo.webkitEnterFullscreen();
            } else {
                el.classList.toggle("iphone-fullscreen");
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else {
                el.classList.remove("iphone-fullscreen");
            }
        }
    }

    function rotateCameraView() {
        state.currentRotation = (state.currentRotation + 90) % 360;
        cameraVideo.style.transform = `rotate(${state.currentRotation}deg)`;
        overlayCanvas.style.transform = `rotate(${state.currentRotation}deg)`;
    }

    async function applyCameraConstraints(constraintSettings) {
        if (!state.cameraStream) return;
        const track = state.cameraStream.getVideoTracks()[0];
        if (!track) return;
        try {
            const capabilities = track.getCapabilities ? track.getCapabilities() : {};
            const supportedConstraints = {};
            for (const key in constraintSettings) {
                if (capabilities[key] || key === "exposureCompensation" || key === "iso") {
                    supportedConstraints[key] = constraintSettings[key];
                }
            }
            if (Object.keys(supportedConstraints).length > 0) {
                await track.applyConstraints({ advanced: [supportedConstraints] });
            }
        } catch (err) {
            console.warn("Hardware parameter adjustment restricted by OS/browser environment.", err);
        }
    }

    function triggerOsdMenu() {
        if (!state.cameraStream && state.lastSourceType !== "image") return;
        cameraOsdMenu.classList.add("visible");

        if (osdHideTimeout) clearTimeout(osdHideTimeout);
        osdHideTimeout = setTimeout(() => {
            cameraOsdMenu.classList.remove("visible");
        }, 5000);
    }

    async function processUploadedImage(file) {
        if (!state.ocrWorker) {
            alert("OCR engine is still initializing. Please wait.");
            return;
        }

        stopCamera();
        ocrStatusBadge.textContent = "Processing Image...";
        ocrStatusBadge.className = "badge processing";

        try {
            const imageUrl = URL.createObjectURL(file);
            const img = new Image();
            img.onload = async () => {
                const iw = img.naturalWidth || img.width;
                const ih = img.naturalHeight || img.height;
                state.lastSourceType = "image";
                state.lastUploadedImage = img;
                cameraPlaceholder.style.display = "none";

                const crop = getScanCropRect(iw, ih);
                const cropCanvas = document.createElement("canvas");
                cropCanvas.width = crop.w;
                cropCanvas.height = crop.h;
                const cctx = cropCanvas.getContext("2d");
                cctx.filter = "grayscale(100%) contrast(145%)";
                cctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);

                const result = await state.ocrWorker.recognize(cropCanvas);
                const validWords = ((result.data && result.data.words) || []).filter(
                    w => !isNoiseOrUnwantedToken(w.text, w.confidence)
                );

                state.lastOcrResult = {
                    width: iw,
                    height: ih,
                    crop,
                    words: validWords
                };
                drawOcrOverlay(state.lastOcrResult);

                ocrStatusBadge.textContent = "OCR Ready";
                ocrStatusBadge.className = "badge ready";

                addHistoryRecord({
                    type: "Image Upload Scan",
                    language: state.currentLanguage,
                    summary: `Found ${validWords.length} valid words in active zone.`,
                    source: file.name
                });
                URL.revokeObjectURL(imageUrl);
            };
            img.src = imageUrl;
        } catch (err) {
            console.error("Image OCR error:", err);
            ocrStatusBadge.textContent = "OCR Error";
            ocrStatusBadge.className = "badge danger";
        }
    }

    function drawOcrOverlay(ocrData) {
        if (!ocrData || !Array.isArray(ocrData.words)) return;

        const ctx = overlayCanvas.getContext("2d");
        const frameW = ocrData.width || cameraVideo.videoWidth || overlayCanvas.clientWidth || 640;
        const frameH = ocrData.height || cameraVideo.videoHeight || overlayCanvas.clientHeight || 480;

        overlayCanvas.width = frameW;
        overlayCanvas.height = frameH;
        ctx.clearRect(0, 0, frameW, frameH);

        if (state.lastSourceType === "image" && state.lastUploadedImage) {
            ctx.drawImage(state.lastUploadedImage, 0, 0, frameW, frameH);
        }

        const crop = ocrData.crop || { x: 0, y: 0 };
        if (state.scanZone !== "full") {
            ctx.save();
            ctx.strokeStyle = "#00d4ff";
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 6]);
            ctx.strokeRect(crop.x, crop.y, ocrData.crop.w, ocrData.crop.h);
            ctx.restore();
        }

        const dictSet = getActiveDictionary(state.currentLanguage);
        const filteredWords = ocrData.words.filter(w => !isNoiseOrUnwantedToken(w.text, w.confidence));

        filteredWords.forEach(w => {
            const wordText = w.text.trim();
            const cleanWord = normalizeToken(wordText);
            const isFound = dictSet.has(cleanWord);

            const bbox = w.bbox;
            const bx = crop.x + bbox.x0;
            const by = crop.y + bbox.y0;
            const bw = bbox.x1 - bbox.x0;
            const bh = bbox.y1 - bbox.y0;

            ctx.strokeStyle = isFound ? "rgba(34, 197, 94, 0.9)" : "rgba(239, 68, 68, 0.95)";
            ctx.lineWidth = 2;
            ctx.strokeRect(bx, by, bw, bh);

            ctx.fillStyle = isFound ? "rgba(34, 197, 94, 0.25)" : "rgba(239, 68, 68, 0.35)";
            ctx.fillRect(bx, Math.max(0, by - 18), bw, 18);

            ctx.fillStyle = "#ffffff";
            ctx.font = "12px sans-serif";
            ctx.fillText(wordText, bx + 2, Math.max(12, by - 5));
        });
    }

    function addHistoryRecord(record) {
        const fullRecord = {
            timestamp: new Date().toLocaleString(),
            ...record
        };
        state.history.unshift(fullRecord);
        if (state.history.length > 50) state.history.pop();
        saveHistory();
        renderHistory();
    }

    function renderHistory() {
        if (state.history.length === 0) {
            historyList.innerHTML = `<p class="placeholder-text">No scan history yet.</p>`;
            return;
        }

        historyList.innerHTML = "";
        state.history.forEach(item => {
            const div = document.createElement("div");
            div.className = "history-item";
            div.innerHTML = `
                <strong>[${escapeHtml(item.type)}] - Lang: ${escapeHtml(item.language.toUpperCase())}</strong>
                <span>${escapeHtml(item.summary)}</span>
                <div class="history-meta">
                    <span>Source: ${escapeHtml((item.source || "Live Stream").substring(0, 30))}</span>
                    <span>${escapeHtml(item.timestamp)}</span>
                </div>
            `;
            historyList.appendChild(div);
        });
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, m => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[m]));
    }

    function setupEventListeners() {
        languageSelect.addEventListener("change", (e) => {
            state.currentLanguage = e.target.value;
            applyTextDirection();
            updateDictionaryUI();
            changeOcrLanguage(state.currentLanguage);
            state.lastOcrResult = null;
            const ctx = overlayCanvas.getContext("2d");
            ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        });

        if (scanZoneSelect) {
            scanZoneSelect.addEventListener("change", (e) => {
                state.scanZone = e.target.value;
                if (state.lastSourceType === "video" && state.cameraStream) {
                    performOcrOnVideoFrame();
                } else if (state.lastSourceType === "image" && state.lastUploadedImage) {
                    const img = state.lastUploadedImage;
                    const iw = img.naturalWidth || img.width;
                    const ih = img.naturalHeight || img.height;
                    const crop = getScanCropRect(iw, ih);
                    const cropCanvas = document.createElement("canvas");
                    cropCanvas.width = crop.w;
                    cropCanvas.height = crop.h;
                    const cctx = cropCanvas.getContext("2d");
                    cctx.filter = "grayscale(100%) contrast(145%)";
                    cctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
                    state.ocrWorker.recognize(cropCanvas).then(res => {
                        state.lastOcrResult = {
                            width: iw,
                            height: ih,
                            crop,
                            words: ((res.data && res.data.words) || []).filter(w => !isNoiseOrUnwantedToken(w.text, w.confidence))
                        };
                        drawOcrOverlay(state.lastOcrResult);
                    });
                }
            });
        }

        if (rangeConfidence) {
            rangeConfidence.addEventListener("input", (e) => {
                state.minConfidence = Number(e.target.value);
                if (confVal) confVal.textContent = `${state.minConfidence}%`;
                if (state.lastOcrResult) drawOcrOverlay(state.lastOcrResult);
            });
        }

        btnAddWord.addEventListener("click", () => {
            addWordToDictionary(newWordInput.value);
        });
        newWordInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") addWordToDictionary(newWordInput.value);
        });

        dictSearchInput.addEventListener("input", () => {
            updateDictionaryUI();
        });

        btnResetDict.addEventListener("click", () => {
            if (confirm(`Reset all user-added words for ${state.currentLanguage}? Core base dictionary will remain intact.`)) {
                state.userWords[state.currentLanguage] = [];
                saveUserWords();
                updateDictionaryUI();
            }
        });

        btnExportDict.addEventListener("click", () => {
            const dictSet = getActiveDictionary(state.currentLanguage);
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(Array.from(dictSet), null, 2));
            const downloadAnchor = document.createElement("a");
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", `tvmide_dict_${state.currentLanguage}.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
        });

        importDictInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const importedWords = JSON.parse(event.target.result);
                    if (Array.isArray(importedWords)) {
                        if (!state.userWords[state.currentLanguage]) state.userWords[state.currentLanguage] = [];
                        const currentSet = new Set(state.userWords[state.currentLanguage]);
                        importedWords.forEach(w => {
                            const norm = normalizeToken(w);
                            if (norm) currentSet.add(norm);
                        });
                        state.userWords[state.currentLanguage] = Array.from(currentSet);
                        saveUserWords();
                        updateDictionaryUI();
                        alert(`Successfully imported words into ${state.currentLanguage} dictionary.`);
                    } else {
                        alert("Invalid dictionary JSON format. Expected an array of words.");
                    }
                } catch (err) {
                    alert("Error parsing JSON file: " + err.message);
                }
            };
            reader.readAsText(file);
        });

        btnCheckText.addEventListener("click", runTextCheck);
        btnClearText.addEventListener("click", () => {
            if (textCheckerInput) textCheckerInput.innerHTML = "";
            textCheckerResults.innerHTML = `<p class="placeholder-text">Checked words will appear here with membership status...</p>`;
        });
        btnCopyText.addEventListener("click", () => {
            const textToCopy = textCheckerResults.innerText;
            navigator.clipboard.writeText(textToCopy);
            alert("Results copied to clipboard.");
        });

        // Camera, Screen Share & OSD Events
        btnStartCamera.addEventListener("click", startCamera);
        btnStartScreenShare.addEventListener("click", startScreenShare);
        btnStopCamera.addEventListener("click", stopCamera);
        btnScanNow.addEventListener("click", performOcrOnVideoFrame);
        btnFullscreenMain.addEventListener("click", toggleFullscreen);
        btnRotateMain.addEventListener("click", rotateCameraView);

        btnOsdScan.addEventListener("click", performOcrOnVideoFrame);
        btnOsdStop.addEventListener("click", stopCamera);
        btnRotateScreen.addEventListener("click", rotateCameraView);
        btnToggleFullscreen.addEventListener("click", toggleFullscreen);

        rangeScanSpeed.addEventListener("input", (e) => {
            const seconds = Number(e.target.value);
            state.scanIntervalMs = seconds * 1000;
            scanIntervalVal.textContent = seconds + "s";
            if (state.isScanning) scheduleNextScan();
        });

        rangeIso.addEventListener("input", (e) => {
            const val = e.target.value;
            isoVal.textContent = val;
            applyCameraConstraints({ iso: parseInt(val, 10) });
        });

        rangeBrightness.addEventListener("input", (e) => {
            const val = e.target.value;
            expVal.textContent = val;
            applyCameraConstraints({ exposureCompensation: parseFloat(val) });
        });

        selectFocus.addEventListener("change", (e) => {
            const val = e.target.value;
            applyCameraConstraints({ focusMode: val });
        });

        cameraViewportContainer.addEventListener("click", triggerOsdMenu);
        cameraViewportContainer.addEventListener("touchstart", triggerOsdMenu, { passive: true });

        imageUploadInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (file) processUploadedImage(file);
        });

        btnExportReport.addEventListener("click", () => {
            const reportData = {
                app: "TV MIDE CG DESK",
                timestamp: new Date().toISOString(),
                activeLanguage: state.currentLanguage,
                totalDictionaryWords: getActiveDictionary(state.currentLanguage).size,
                history: state.history
            };
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(reportData, null, 2));
            const downloadAnchor = document.createElement("a");
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", `tvmide_cg_report_${Date.now()}.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
        });

        btnClearHistory.addEventListener("click", () => {
            if (confirm("Clear all scan history?")) {
                state.history = [];
                saveHistory();
                renderHistory();
            }
        });
    }

    init();
});
