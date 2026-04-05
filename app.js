// DOM Elements
const fileInput = document.getElementById('file-input');
const uploadPrompt = document.getElementById('upload-prompt');
const previewContainer = document.getElementById('preview-container');
const imagePreview = document.getElementById('image-preview');
const resetBtn = document.getElementById('reset-btn');
const startOcrBtn = document.getElementById('start-ocr-btn');
const resultSection = document.getElementById('result-section');
const progressContainer = document.getElementById('progress-container');
const progressPercent = document.getElementById('progress-percent');
const progressBarFill = document.getElementById('progress-bar-fill');
const statusText = document.getElementById('status-text');
const resultText = document.getElementById('result-text');
const copyBtn = document.getElementById('copy-btn');
const downloadBtn = document.getElementById('download-btn');
const wordBtn = document.getElementById('word-btn');
const pdfBtn = document.getElementById('pdf-btn');
const scanLine = document.getElementById('scan-line');
const historyList = document.getElementById('history-list');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const emptyHistory = document.getElementById('empty-history');
const cameraBtn = document.getElementById('camera-btn');
const kvkkLink = document.getElementById('kvkk-link');
const kvkkModal = document.getElementById('kvkk-modal');
const closeKvkk = document.getElementById('close-kvkk');

// Constants
const HISTORY_KEY = 'mistechnology_ocr_history';
const MAX_HISTORY = 10;

// Use Tesseract from the global scope
let selectedFile = null;

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    // Check if libraries are loaded
    if (typeof Tesseract === 'undefined') {
        statusText.innerText = 'Hata: OCR Kütüphanesi yüklenemedi!';
    }

    // Load History
    renderHistory();

    // Drop zone click
    document.getElementById('drop-zone').addEventListener('click', (e) => {
        if(e.target.closest('.preview-actions') || e.target.closest('.upload-buttons')) return;
        fileInput.click();
    });

    fileInput.addEventListener('change', handleFileSelect);

    resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        resetUI();
    });

    startOcrBtn.addEventListener('click', performOCR);

    // Downloads
    copyBtn.addEventListener('click', copyToClipboard);
    downloadBtn.addEventListener('click', downloadAsTxt);
    wordBtn.addEventListener('click', downloadAsWord);
    pdfBtn.addEventListener('click', downloadAsPDF);
    
    // History
    clearHistoryBtn.addEventListener('click', clearAllHistory);

    // Camera & KVKK
    cameraBtn.addEventListener('click', () => fileInput.click());
    kvkkLink.addEventListener('click', (e) => {
        e.preventDefault();
        kvkkModal.classList.remove('hidden');
    });
    closeKvkk.addEventListener('click', () => kvkkModal.classList.add('hidden'));
    
    // Close modal on outside click
    window.addEventListener('click', (e) => {
        if (e.target === kvkkModal) kvkkModal.classList.add('hidden');
    });
});

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file || !file.type.startsWith('image/')) return;

    selectedFile = file;
    const reader = new FileReader();

    reader.onload = (event) => {
        imagePreview.src = event.target.result;
        uploadPrompt.classList.add('hidden');
        previewContainer.classList.remove('hidden');
        startOcrBtn.disabled = false;
        previewContainer.scrollIntoView({ behavior: 'smooth' });
    };

    reader.readAsDataURL(file);
}

function resetUI() {
    fileInput.value = '';
    selectedFile = null;
    imagePreview.src = '';
    uploadPrompt.classList.remove('hidden');
    previewContainer.classList.add('hidden');
    resultSection.classList.add('hidden');
    startOcrBtn.disabled = true;
    scanLine.style.display = 'none';
}

/**
 * GELİŞMİŞ GÖRÜNTÜ İYİLEŞTİRME (V3 - El Yazısı Uzmanı)
 * 2x Upscaling + Keskinleştirme Matrisi + Bradley Adaptif Eşikleme
 */
async function preprocessImage(imageSrc) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // 1. ADIM: 2x BÜYÜTME (Hassas kenar tespiti için)
            const SCALE = 2;
            canvas.width = img.width * SCALE;
            canvas.height = img.height * SCALE;
            ctx.imageSmoothingEnabled = true; // Büyütürken yumuşat
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            let data = imageData.data;
            const w = canvas.width;
            const h = canvas.height;

            // 2. ADIM: GRİ TONLAMA (Luminance)
            for (let i = 0; i < data.length; i += 4) {
                const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
                data[i] = data[i+1] = data[i+2] = gray;
            }

            // 3. ADIM: KESKİNLEŞTİRME (Sharpen Convolution)
            const sharpenedData = new Uint8ClampedArray(data.length);
            for (let y = 1; y < h - 1; y++) {
                for (let x = 1; x < w - 1; x++) {
                    for (let c = 0; c < 3; c++) {
                        const idx = (y * w + x) * 4 + c;
                        const val = 5 * data[idx] 
                                    - data[((y-1) * w + x) * 4 + c] 
                                    - data[((y+1) * w + x) * 4 + c] 
                                    - data[(y * w + (x-1)) * 4 + c] 
                                    - data[(y * w + (x+1)) * 4 + c];
                        sharpenedData[idx] = Math.min(255, Math.max(0, val));
                    }
                    sharpenedData[(y * w + x) * 4 + 3] = 255;
                }
            }
            data.set(sharpenedData);

            // 4. ADIM: BRADLEY ADAPTİF EŞİKLEME (Gölge Temizleme)
            const S = Math.floor(w / 8); 
            const T = 0.15; 
            
            const integralImage = new Float32Array(w * h);
            for (let y = 0; y < h; y++) {
                let sum = 0;
                for (let x = 0; x < w; x++) {
                    sum += data[(y * w + x) * 4];
                    if (y === 0) integralImage[y * w + x] = sum;
                    else integralImage[y * w + x] = integralImage[(y-1) * w + x] + sum;
                }
            }

            const s2 = Math.floor(S / 2);
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const x1 = Math.max(x - s2, 0);
                    const x2 = Math.min(x + s2, w - 1);
                    const y1 = Math.max(y - s2, 0);
                    const y2 = Math.min(y + s2, h - 1);
                    const count = (x2 - x1) * (y2 - y1);
                    const sum = integralImage[y2 * w + x2] - integralImage[(y1-1) * w + x2] - integralImage[y2 * w + (x1-1)] + integralImage[(y1-1) * w + (x1-1)];
                    
                    const idx = (y * w + x) * 4;
                    if (data[idx] * count < sum * (1.0 - T)) {
                        data[idx] = data[idx+1] = data[idx+2] = 0;
                    } else {
                        data[idx] = data[idx+1] = data[idx+2] = 255;
                    }
                }
            }
            
            ctx.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL('image/png', 1.0));
        };
        img.src = imageSrc;
    });
}

async function performOCR() {
    if (!selectedFile) return;
    if (typeof Tesseract === 'undefined') {
        alert('Kütüphane hatası!');
        return;
    }

    const lang = document.querySelector('input[name="lang"]:checked').value;
    
    // UI state
    startOcrBtn.disabled = true;
    resultSection.classList.remove('hidden');
    progressContainer.classList.remove('hidden');
    scanLine.style.display = 'block';
    resultText.value = '';
    resultSection.scrollIntoView({ behavior: 'smooth' });

    try {
        statusText.innerText = 'El yazısı optimize ediliyor...';
        const enhancedImage = await preprocessImage(imagePreview.src);
        
        statusText.innerText = 'Bölgesel tarama başlatıldı...';
        
        const worker = await Tesseract.createWorker(lang, 1, {
            workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
            corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd.wasm.js',
            logger: m => {
                if (m.status === 'recognizing text') {
                    const progress = Math.round(m.progress * 100);
                    progressPercent.innerText = `${progress}%`;
                    progressBarFill.style.width = `${progress}%`;
                    statusText.innerText = 'El yazısı detayları analiz ediliyor...';
                }
            }
        });

        await worker.setParameters({
            tessedit_pageseg_mode: '3',
            preserve_interword_spaces: '1',
            tessedit_ocr_engine_mode: '1'
        });

        const { data: { text } } = await worker.recognize(enhancedImage);
        
        const finalResult = text.trim() || 'Üzgünüz, metin algılanamadı.';
        resultText.value = finalResult;
        statusText.innerText = 'El Yazısı Taraması Başarılı!';
        progressBarFill.style.width = '100%';
        progressPercent.innerText = '100%';
        
        // Save to History
        if (finalResult && finalResult.length > 5) {
            saveToHistory(finalResult);
        }

        await worker.terminate();
    } catch (error) {
        console.error(error);
        statusText.innerText = 'Hata!';
        alert('Hata: ' + error.message);
    } finally {
        scanLine.style.display = 'none';
        startOcrBtn.disabled = false;
        lucide.createIcons();
    }
}

// History Functions
function saveToHistory(text) {
    let history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    const newItem = {
        id: Date.now(),
        date: new Date().toLocaleString('tr-TR'),
        text: text,
        excerpt: text.substring(0, 50) + '...'
    };
    
    // Add to beginning
    history.unshift(newItem);
    
    // Limit history
    if (history.length > MAX_HISTORY) {
        history = history.slice(0, MAX_HISTORY);
    }
    
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    renderHistory();
}

function renderHistory() {
    let history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    
    if (history.length === 0) {
        emptyHistory.classList.remove('hidden');
        historyList.innerHTML = '';
        return;
    }
    
    emptyHistory.classList.add('hidden');
    historyList.innerHTML = '';
    
    history.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item glass';
        div.innerHTML = `
            <div class="history-info" onclick="loadFromHistory(${item.id})">
                <span class="history-date">${item.date}</span>
                <span class="history-excerpt">${item.excerpt}</span>
            </div>
            <div class="history-actions">
                <button class="btn-icon btn-sm" onclick="deleteHistoryItem(${item.id})" title="Sil">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        `;
        historyList.appendChild(div);
    });
    
    lucide.createIcons();
}

window.loadFromHistory = function(id) {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    const item = history.find(i => i.id === id);
    if (item) {
        resultText.value = item.text;
        resultSection.classList.remove('hidden');
        resultSection.scrollIntoView({ behavior: 'smooth' });
    }
}

window.deleteHistoryItem = function(id) {
    let history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    history = history.filter(i => i.id !== id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    renderHistory();
}

function clearAllHistory() {
    if (confirm('Tüm geçmişi silmek istediğinize emin misiniz?')) {
        localStorage.removeItem(HISTORY_KEY);
        renderHistory();
    }
}

// Download Functions
function copyToClipboard() {
    resultText.select();
    navigator.clipboard.writeText(resultText.value);
    const originalIcon = copyBtn.innerHTML;
    copyBtn.innerHTML = '<i data-lucide="check" style="color: var(--primary)"></i>';
    lucide.createIcons();
    setTimeout(() => {
        copyBtn.innerHTML = originalIcon;
        lucide.createIcons();
    }, 2000);
}

function downloadAsTxt() {
    const blob = new Blob([resultText.value], { type: 'text/plain' });
    triggerDownload(blob, 'VisionText_Output.txt');
}

function downloadAsWord() {
    if (!resultText.value) return;
    const content = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head><meta charset='utf-8'></head>
        <body style="font-family: Arial, sans-serif; white-space: pre-wrap;">
            ${resultText.value.replace(/\n/g, '<br>')}
        </body>
        </html>
    `;
    const blob = new Blob([content], { type: 'application/msword' });
    triggerDownload(blob, 'VisionText_Output.doc');
}

function downloadAsPDF() {
    if (!resultText.value) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const splitText = doc.splitTextToSize(resultText.value, 180);
    doc.text(splitText, 15, 20);
    doc.save('VisionText_Output.pdf');
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
function copyToClipboard() {
    resultText.select();
    navigator.clipboard.writeText(resultText.value);
    const originalIcon = copyBtn.innerHTML;
    copyBtn.innerHTML = '<i data-lucide="check" style="color: var(--primary)"></i>';
    lucide.createIcons();
    setTimeout(() => {
        copyBtn.innerHTML = originalIcon;
        lucide.createIcons();
    }, 2000);
}

function downloadAsTxt() {
    const blob = new Blob([resultText.value], { type: 'text/plain' });
    triggerDownload(blob, 'VisionText_Output.txt');
}

function downloadAsWord() {
    if (!resultText.value) return;
    // Word (.doc) için HTML şablonu
    const content = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head><meta charset='utf-8'></head>
        <body style="font-family: Arial, sans-serif; white-space: pre-wrap;">
            ${resultText.value.replace(/\n/g, '<br>')}
        </body>
        </html>
    `;
    const blob = new Blob([content], { type: 'application/msword' });
    triggerDownload(blob, 'VisionText_Output.doc');
}

function downloadAsPDF() {
    if (!resultText.value) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    // Basit bir metin yerleşimi (Sayfa sınırlarını kontrol ederek)
    const splitText = doc.splitTextToSize(resultText.value, 180);
    doc.text(splitText, 15, 20);
    doc.save('VisionText_Output.pdf');
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
