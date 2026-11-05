/**
 * RUDAW CG DESK - Main Application Logic
 * Multilingual Dictionary-Based OCR & Live Camera Word Recognition System
 */

document.addEventListener("DOMContentLoaded", () => {
    // Application State
    const state = {
        currentLanguage: "sorani",
        userWords: {}, // { sorani: [...], english: [...], etc. }
        history: [],
        cameraStream: null,
        ocrWorker: null,
        isScanning: false,
        lastOcrResult: null // Stores last OCR word boxes for instant reactive redraw
    };

    // DOM Elements
    const languageSelect = document.getElementById("language-select");
    const dictCountBadge = document.getElementById("dict-count-badge");
    const ocrStatusBadge = document.getElementById("ocr-status-badge");

    // Camera Elements
    const cameraVideo = document.getElementById("camera-video");
    const overlayCanvas = document.getElementById("overlay-canvas");
    const cameraPlaceholder = document.getElementById("camera-placeholder");
    const btnStartCamera = document.getElementById("btn-start-camera");
    const btnStopCamera = document.getElementById("btn-stop-camera");
    const btnScanNow = document.getElementById("btn-scan-now");
    const imageUploadInput = document.getElementById("image-upload-input");

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

    // OCR Tesseract Language Mapping
    const tesseractLangMap = {
        sorani: "ara", // Arabic script fallback for Sorani
        kurmanji: "eng", // Latin script fallback for Kurmanji
        arabic: "ara",
        english: "eng",
        turkish: "tur",
        persian: "fas"
    };

    // --- Initialization ---
    function init() {
        loadLocalStorage();
        updateDictionaryUI();
        setupEventListeners();
        initTesseractWorker();
    }

    // Load user added words & history from localStorage
    function loadLocalStorage() {
        try {
            const savedUserWords = localStorage.getItem("rudaw_user_words_v2");
            if (savedUserWords) {
                state.userWords = JSON.parse(savedUserWords);
            }
            const savedHistory = localStorage.getItem("rudaw_scan_history_v2");
            if (savedHistory) {
                state.history = JSON.parse(savedHistory);
                renderHistory();
            }
        } catch (e) {
            console.error("Error loading local storage:", e);
        }
    }

    function saveUserWords() {
        localStorage.setItem("rudaw_user_words_v2", JSON.stringify(state.userWords));
    }

    function saveHistory() {
        localStorage.setItem("rudaw_scan_history_v2", JSON.stringify(state.history));
    }

    // Get combined dictionary (Base JS + LocalStorage user additions) for a language
    function getActiveDictionary(lang = state.currentLanguage) {
        const baseDict = (window.RUDAW_DICTIONARIES && window.RUDAW_DICTIONARIES[lang]) || [];
        const userList = (state.userWords && state.userWords[lang]) || [];
        // Combine into a Set for O(1) membership check and remove duplicates
        return new Set([...baseDict, ...userList]);
    }

    // --- Dictionary Manager Functions ---
    function updateDictionaryUI() {
        const lang = state.currentLanguage;
        const dictSet = getActiveDictionary(lang);
        dictCountBadge.textContent = `Dictionary Words: ${dictSet.size}`;

        const searchTerm = (dictSearchInput.value || "").toLowerCase().trim();
        dictionaryWordList.innerHTML = "";

        const sortedWords = Array.from(dictSet).sort();
        let count = 0;

        sortedWords.forEach(word => {
            if (searchTerm && !word.toLowerCase().includes(searchTerm)) return;
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

        // Attach delete event listeners
        document.querySelectorAll(".btn-delete-word").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const wordToRemove = e.target.getAttribute("data-word");
                removeWordFromDictionary(wordToRemove);
            });
        });
    }

    function addWordToDictionary(word) {
        const cleanWord = word.trim();
        if (!cleanWord) return;

        const lang = state.currentLanguage;
        if (!state.userWords[lang]) {
            state.userWords[lang] = [];
        }

        // Check if already in base or user dictionary
        const dictSet = getActiveDictionary(lang);
        if (dictSet.has(cleanWord)) {
            alert(`"${cleanWord}" already exists in the ${lang} dictionary.`);
            return;
        }

        state.userWords[lang].push(cleanWord);
        saveUserWords();
        updateDictionaryUI();
        newWordInput.value = "";

        // REQUIREMENT 7: IMMEDIATE UPDATE AFTER ADDING A WORD
        // If there is an active OCR result displayed on the camera overlay, instantly redraw/re-evaluate!
        if (state.lastOcrResult) {
            drawOcrOverlay(state.lastOcrResult);
        }

        // Also re-run text checker if text is present
        if (textCheckerInput.value.trim()) {
            runTextCheck();
        }
    }

    function removeWordFromDictionary(word) {
        const lang = state.currentLanguage;
        const baseDict = (window.RUDAW_DICTIONARIES && window.RUDAW_DICTIONARIES[lang]) || [];

        // If it's in base dictionary, we cannot remove it from static files directly, but we can check if it's in user words
        if (baseDict.includes(word)) {
            alert("This word is part of the core base dictionary file and cannot be removed directly. You can only remove user-added custom words.");
            return;
        }

        if (state.userWords[lang]) {
            state.userWords[lang] = state.userWords[lang].filter(w => w !== word);
            saveUserWords();
            updateDictionaryUI();

            if (state.lastOcrResult) {
                drawOcrOverlay(state.lastOcrResult);
            }
        }
    }

    // --- Text Checker Mode ---
    function runTextCheck() {
        const text = textCheckerInput.value.trim();
        if (!text) {
            textCheckerResults.innerHTML = `<p class="placeholder-text">Please enter or paste text to check.</p>`;
            return;
        }

        const dictSet = getActiveDictionary(state.currentLanguage);
        // Normalize and split into words (preserving spaces/punctuation handling)
        const rawWords = text.split(/\s+/);
        
        let recognizedCount = 0;
        let unregisteredCount = 0;
        let htmlOutput = "";

        rawWords.forEach(token => {
            // Clean punctuation for dictionary lookup while keeping original token display
            const cleanToken = token.replace(/^[^\w\u0600-\u06FF]+|[^\w\u0600-\u06FF]+$/g, "");
            
            if (!cleanToken) {
                htmlOutput += `<span>${token} </span>`;
                return;
            }

            const isFound = dictSet.has(cleanToken);
            if (isFound) {
                recognizedCount++;
                htmlOutput += `<span class="word-pill registered" title="Registered in dictionary">${token}</span> `;
            } else {
                unregisteredCount++;
                htmlOutput += `<span class="word-pill unregistered" title="Not found in dictionary (Click to add)" style="cursor:pointer;" onclick="window.rudawAddWordPrompt('${cleanToken}')">${token}</span> `;
            }
        });

        textCheckerResults.innerHTML = htmlOutput;

        // Log history
        addHistoryRecord({
            type: "Text Check",
            language: state.currentLanguage,
            summary: `Total: ${rawWords.length}, Recognized: ${recognizedCount}, Unregistered: ${unregisteredCount}`,
            source: text
        });
    }

    // Global helper for clicking unregistered words in text checker
    window.rudawAddWordPrompt = function(word) {
        if (confirm(`Do you want to add "${word}" to the ${state.currentLanguage} dictionary?`)) {
            addWordToDictionary(word);
            runTextCheck();
        }
    };

    // --- OCR & Camera System ---
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
            cameraVideo.srcObject = state.cameraStream;
            cameraVideo.style.display = "block";
            cameraPlaceholder.style.display = "none";

            btnStartCamera.disabled = true;
            btnStopCamera.disabled = false;
            btnScanNow.disabled = false;

            // Start periodic scan loop
            state.isScanning = true;
            scanCameraLoop();
        } catch (err) {
            alert("Camera access denied or unavailable: " + err.message);
        }
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

        btnStartCamera.disabled = false;
        btnStopCamera.disabled = true;
        btnScanNow.disabled = true;
    }

    async function scanCameraLoop() {
        if (!state.isScanning) return;
        await performOcrOnVideoFrame();
        // Loop every 3 seconds for live scanning
        if (state.isScanning) {
            setTimeout(scanCameraLoop, 3000);
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
            state.lastOcrResult = result; // Save for instant updates
            drawOcrOverlay(result);
        } catch (err) {
            console.error("OCR Frame error:", err);
        }
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
            
            // Draw image on camera preview area or create preview
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

            const isFound = dictSet.has(cleanWord);
            if (isFound) recognizedCount++;
            else unregisteredCount++;

            const bbox = w.bbox;
            // Draw bounding box
            ctx.strokeStyle = isFound ? "rgba(34, 197, 94, 0.8)" : "rgba(239, 68, 68, 0.9)";
            ctx.lineWidth = 2;
            ctx.strokeRect(bbox.x0, bbox.y0, bbox.x1 - bbox.x0, bbox.y1 - bbox.y0);

            // Draw background pill for text readability
            ctx.fillStyle = isFound ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.3)";
            ctx.fillRect(bbox.x0, bbox.y0 - 18, bbox.x1 - bbox.x0, 18);

            // Draw word text
            ctx.fillStyle = "#ffffff";
            ctx.font = "12px sans-serif";
            ctx.fillText(wordText, bbox.x0 + 2, bbox.y0 - 5);
        });

        // Update history if live scan
        if (state.isScanning && ocrResult.data.words.length > 0) {
            // throttle history logging for live cam
        }
    }

    // --- History & Reporting ---
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
                    <span>Source: ${item.source ? item.source.substring(0, 30) : 'Live Camera'}</span>
                    <span>${item.timestamp}</span>
                </div>
            `;
            historyList.appendChild(div);
        });
    }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        // Language Change
        languageSelect.addEventListener("change", (e) => {
            state.currentLanguage = e.target.value;
            updateDictionaryUI();
            changeOcrLanguage(state.currentLanguage);
            state.lastOcrResult = null;
            const ctx = overlayCanvas.getContext("2d");
            ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        });

        // Add Word
        btnAddWord.addEventListener("click", () => {
            addWordToDictionary(newWordInput.value);
        });
        newWordInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") addWordToDictionary(newWordInput.value);
        });

        // Dictionary Search
        dictSearchInput.addEventListener("input", () => {
            updateDictionaryUI();
        });

        // Reset Dictionary
        btnResetDict.addEventListener("click", () => {
            if (confirm(`Reset all user-added words for ${state.currentLanguage}? Core base dictionary will remain intact.`)) {
                state.userWords[state.currentLanguage] = [];
                saveUserWords();
                updateDictionaryUI();
            }
        });

        // Export Dictionary JSON
        btnExportDict.addEventListener("click", () => {
            const dictSet = getActiveDictionary(state.currentLanguage);
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(Array.from(dictSet), null, 2));
            const downloadAnchor = document.createElement("a");
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", `rudaw_dict_${state.currentLanguage}.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
        });

        // Import Dictionary JSON
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
                        importedWords.forEach(w => currentSet.add(w));
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

        // Text Checker Buttons
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

        // Camera Buttons
        btnStartCamera.addEventListener("click", startCamera);
        btnStopCamera.addEventListener("click", stopCamera);
        btnScanNow.addEventListener("click", performOcrOnVideoFrame);

        imageUploadInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (file) processUploadedImage(file);
        });

        // Report Export
        btnExportReport.addEventListener("click", () => {
            const reportData = {
                app: "RUDAW CG DESK",
                timestamp: new Date().toISOString(),
                activeLanguage: state.currentLanguage,
                totalDictionaryWords: getActiveDictionary(state.currentLanguage).size,
                history: state.history
            };
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(reportData, null, 2));
            const downloadAnchor = document.createElement("a");
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", `rudaw_cg_report_${Date.now()}.json`);
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

    // Run initialization
    init();
});
