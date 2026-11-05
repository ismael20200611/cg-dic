/**
 * TV MIDE CG DESK - Main Application Logic
 * Multilingual Dictionary-Based OCR & Live Camera/Screen Share Recognition System
 */

document.addEventListener("DOMContentLoaded", () => {
    // Application State
    const state = {
        currentLanguage: "sorani",
        userWords: {}, 
        history: [],
        cameraStream: null,
        ocrWorker: null,
        isScanning: false,
        lastOcrResult: null,
        currentRotation: 0,
        scanIntervalMs: 3000 // Configurable scan speed timer (default 3 seconds)
    };

    // DOM Elements
    const languageSelect = document.getElementById("language-select");
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
    const rangeIso = document.getElementById("range-iso");
    const isoVal = document.getElementById("iso-val");
    const rangeBrightness = document.getElementById("range-brightness");
    const expVal = document.getElementById("exp-val");
    const selectFocus = document.getElementById("select-focus");

    // Text Checker Elements
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
        sorani: "ara", 
        kurmanji: "eng", 
        arabic: "ara",
        english: "eng",
        turkish: "tur",
        persian: "fas"
    };

    let osdHideTimeout = null;

    function init() {
        loadLocalStorage();
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

    function getActiveDictionary(lang = state.currentLanguage) {
        const baseDict = (window.TVMIDE_DICTIONARIES && window.TVMIDE_DICTIONARIES[lang]) || [];
        const userList = (state.userWords && state.userWords[lang]) || [];
        const combined = [...baseDict, ...userList].map(w => w.trim().toLowerCase());
        return new Set(combined);
    }

    function updateDictionaryUI() {
        const lang = state.currentLanguage;
        const dictSet = getActiveDictionary(lang);
        dictCountBadge.textContent = `Dictionary Words: ${dictSet.size}`;

        const searchTerm = (dictSearchInput.value || "").toLowerCase().trim();
        dictionaryWordList.innerHTML = "";

        const sortedWords = Array.from(dictSet).sort();
        let count = 0;

        sortedWords.forEach(word => {
            if (searchTerm && !word.includes(searchTerm)) return;
            count++;

            const li = document.createElement("li");
            li.innerHTML = `
                <span>${word}</span>
                <button data-word="${word}" class="btn-delete-word" title="Remove word">✕</button>
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
        const cleanWord = word.trim().toLowerCase();
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

        if (textCheckerInput.value.trim()) {
            runTextCheck();
        }
    }

    function removeWordFromDictionary(word) {
        const lang = state.currentLanguage;
        const baseDict = ((window.TVMIDE_DICTIONARIES && window.TVMIDE_DICTIONARIES[lang]) || []).map(w => w.toLowerCase());

        if (baseDict.includes(word)) {
            alert("This word is part of the core base dictionary file and cannot be removed directly. You can only remove user-added custom words.");
            return;
        }

        if (state.userWords[lang]) {
            state.userWords[lang] = state.userWords[lang].filter(w => w.toLowerCase() !== word);
            saveUserWords();
            updateDictionaryUI();

            if (state.lastOcrResult) {
                drawOcrOverlay(state.lastOcrResult);
            }
        }
    }

    function runTextCheck() {
        const text = textCheckerInput.value.trim();
        if (!text) {
            textCheckerResults.innerHTML = `<p class="placeholder-text">Please enter or paste text to check.</p>`;
            return;
        }

        const dictSet = getActiveDictionary(state.currentLanguage);
        const rawWords = text.split(/\s+/);
        
        let recognizedCount = 0;
        let unregisteredCount = 0;
        let htmlOutput = "";

        rawWords.forEach(token => {
            const cleanToken = token.replace(/^[^\w\u0600-\u06FF]+|[^\w\u0600-\u06FF]+$/g, "");
            
            if (!cleanToken) {
                htmlOutput += `<span>${token} </span>`;
                return;
            }

            const isFound = dictSet.has(cleanToken.toLowerCase());
            if (isFound) {
                recognizedCount++;
                htmlOutput += `<span class="word-pill registered" title="Registered in dictionary">${token}</span> `;
            } else {
                unregisteredCount++;
                htmlOutput += `<span class="word-pill unregistered" title="Not found in dictionary (Click to add)" style="cursor:pointer;" onclick="window.tvmideAddWordPrompt('${cleanToken}')">${token}</span> `;
            }
        });

        textCheckerResults.innerHTML = htmlOutput;

        addHistoryRecord({
            type: "Text Check",
            language: state.currentLanguage,
            summary: `Total: ${rawWords.length}, Recognized: ${recognizedCount}, Unregistered: ${unregisteredCount}`,
            source: text
        });
    }

    window.tvmideAddWordPrompt = function(word) {
        if (confirm(`Do you want to add "${word}" to the ${state.currentLanguage} dictionary?`)) {
            addWordToDictionary(word);
            runTextCheck();
        }
    };

    async function initTesseractWorker() {
        try {
            ocrStatusBadge.textContent = "Loading OCR...";
            ocrStatusBadge.className = "badge processing";

            const langCode = tesseractLangMap[state.currentLanguage] || "eng";
            state.ocrWorker = await Tesseract.createWorker(langCode);

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
            } catch (e) { }
        }
        ocrStatusBadge.textContent = "Switching OCR...";
        ocrStatusBadge.className = "badge processing";
        
        try {
            const langCode = tesseractLangMap[lang] || "eng";
            state.ocrWorker = await Tesseract.createWorker(langCode);
            ocrStatusBadge.textContent = "OCR Ready";
            ocrStatusBadge.className = "badge ready";
        } catch (err) {
            ocrStatusBadge.textContent = "OCR Error";
            ocrStatusBadge.className = "badge danger";
        }
    }

    async function startCamera() {
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
        scanCameraLoop();
    }

    function stopCamera() {
        state.isScanning = false;
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

    async function scanCameraLoop() {
        if (!state.isScanning) return;
        await performOcrOnVideoFrame();
        if (state.isScanning) {
            setTimeout(scanCameraLoop, state.scanIntervalMs);
        }
    }

    async function performOcrOnVideoFrame() {
        if (!state.ocrWorker || cameraVideo.paused || cameraVideo.ended) return;
        
        try {
            const canvas = document.createElement("canvas");
            canvas.width = cameraVideo.videoWidth || 640;
            canvas.height = cameraVideo.videoHeight || 480;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);

            const result = await state.ocrWorker.recognize(canvas);
            state.lastOcrResult = result;
            drawOcrOverlay(result);
        } catch (err) {
            console.error("OCR Frame error:", err);
        }
    }

    // --- Fixed Cross-Platform Fullscreen (Including iOS Safari & iPhone Support) ---
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
                el.classList.toggle("css-fullscreen-fallback");
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
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
                if (capabilities[key] || key === 'exposureCompensation' || key === 'iso') {
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
        if (!state.cameraStream) return;
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

        ocrStatusBadge.textContent = "Processing Image...";
        ocrStatusBadge.className = "badge processing";

        try {
            const imageUrl = URL.createObjectURL(file);
            const img = new Image();
            img.src = imageUrl;
            img.onload = async () => {
                const ctx = overlayCanvas.getContext("2d");
                overlayCanvas.width = img.width;
                overlayCanvas.height = img.height;
                ctx.drawImage(img, 0, 0);

                const result = await state.ocrWorker.recognize(imageUrl);
                state.lastOcrResult = result;
                drawOcrOverlay(result);

                ocrStatusBadge.textContent = "OCR Ready";
                ocrStatusBadge.className = "badge ready";

                addHistoryRecord({
                    type: "Image Upload Scan",
                    language: state.currentLanguage,
                    summary: `Recognized ${result.data.words.length} words from uploaded image.`,
                    source: file.name
                });
            };
        } catch (err) {
            console.error("Image OCR error:", err);
            ocrStatusBadge.textContent = "OCR Error";
            ocrStatusBadge.className = "badge danger";
        }
    }

    function drawOcrOverlay(ocrResult) {
        if (!ocrResult || !ocrResult.data || !ocrResult.data.words) return;

        const ctx = overlayCanvas.getContext("2d");
        const videoWidth = cameraVideo.videoWidth || overlayCanvas.clientWidth || 640;
        const videoHeight = cameraVideo.videoHeight || overlayCanvas.clientHeight || 480;

        overlayCanvas.width = videoWidth;
        overlayCanvas.height = videoHeight;
        ctx.clearRect(0, 0, videoWidth, videoHeight);

        const dictSet = getActiveDictionary(state.currentLanguage);
        let recognizedCount = 0;
        let unregisteredCount = 0;

        ocrResult.data.words.forEach(w => {
            const wordText = w.text.trim();
            const cleanWord = wordText.replace(/^[^\w\u0600-\u06FF]+|[^\w\u0600-\u06FF]+$/g, "");
            if (!cleanWord) return;

            const isFound = dictSet.has(cleanWord.toLowerCase());
            if (isFound) recognizedCount++;
            else unregisteredCount++;

            const bbox = w.bbox;
            ctx.strokeStyle = isFound ? "rgba(34, 197, 94, 0.8)" : "rgba(239, 68, 68, 0.9)";
            ctx.lineWidth = 2;
            ctx.strokeRect(bbox.x0, bbox.y0, bbox.x1 - bbox.x0, bbox.y1 - bbox.y0);

            ctx.fillStyle = isFound ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.3)";
            ctx.fillRect(bbox.x0, bbox.y0 - 18, bbox.x1 - bbox.x0, 18);

            ctx.fillStyle = "#ffffff";
            ctx.font = "12px sans-serif";
            ctx.fillText(wordText, bbox.x0 + 2, bbox.y0 - 5);
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
                <strong>[${item.type}] - Lang: ${item.language.toUpperCase()}</strong>
                <span>${item.summary}</span>
                <div class="history-meta">
                    <span>Source: ${item.source ? item.source.substring(0, 30) : 'Live Stream'}</span>
                    <span>${item.timestamp}</span>
                </div>
            `;
            historyList.appendChild(div);
        });
    }

    function setupEventListeners() {
        languageSelect.addEventListener("change", (e) => {
            state.currentLanguage = e.target.value;
            updateDictionaryUI();
            changeOcrLanguage(state.currentLanguage);
            state.lastOcrResult = null;
            const ctx = overlayCanvas.getContext("2d");
            ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        });

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
                        importedWords.forEach(w => currentSet.add(w.toLowerCase()));
                        state.userWords[state.currentLanguage] = Array.from(currentSet);
                        saveUserWords();
                        updateDictionaryUI();
                        alert(`Successfully imported ${importedWords.length} words into ${state.currentLanguage} dictionary.`);
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
            textCheckerInput.value = "";
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

        // OSD menu button bindings
        btnOsdScan.addEventListener("click", performOcrOnVideoFrame);
        btnOsdStop.addEventListener("click", stopCamera);
        btnRotateScreen.addEventListener("click", rotateCameraView);
        btnToggleFullscreen.addEventListener("click", toggleFullscreen);

        // Scan Speed Timer Slider
        rangeScanSpeed.addEventListener("input", (e) => {
            const seconds = e.target.value;
            state.scanIntervalMs = seconds * 1000;
            scanIntervalVal.textContent = seconds + "s";
        });

        // Hardware Controls Sliders
        rangeIso.addEventListener("input", (e) => {
            const val = e.target.value;
            isoVal.textContent = val;
            applyCameraConstraints({ iso: parseInt(val) });
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

        // Touch/Click viewport to trigger auto-hiding OSD menu
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
