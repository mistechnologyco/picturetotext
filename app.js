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
const MAX_HISTORY = 12;
let selectedFile = null;

// Global Error Handling (For Mobile Debug)
window.onerror = function(msg, url, lineNo) {
    if (statusText) {
        statusText.innerText = `Hata: ${msg} [L:${lineNo}]`;
        statusText.style.color = "#ff4d4d";
    }
    return false;
};

// INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
    // Check HTTPS on Mobile
    if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
        const warning = document.createElement('div');
        warning.className = 'glass';
        warning.style.padding = '10px';
        warning.style.color = '#fff';
        warning.style.background = 'rgba(255,0,0,0.5)';
        warning.style.margin = '10px 0';
        warning.innerText = '⚠️ Dikkat: Mobil cihazlarda kameranın çalışması için HTTPS (Güvenli Bağlantı) gereklidir.';
        document.querySelector('header').appendChild(warning);
    }

    renderHistory();

    // Setup Event Listeners
    document.getElementById('drop-zone').addEventListener('click', (e) => {
        if (e.target.closest('.preview-actions') || e.target.closest('.upload-buttons')) return;
        fileInput.click();
    });

    fileInput.addEventListener('change', handleFileSelect);

    cameraBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.setAttribute('capture', 'environment');
        fileInput.click();
    });

    resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        resetUI();
    });

    startOcrBtn.addEventListener('click', performOCR);

    copyBtn.addEventListener('click', copyToClipboard);
    downloadBtn.addEventListener('click', downloadAsTxt);
    wordBtn.addEventListener('click', downloadAsWord);
    pdfBtn.addEventListener('click', downloadAsPDF);
    clearHistoryBtn.addEventListener('click', clearAllHistory);

    kvkkLink.addEventListener('click', (e) => {
        e.preventDefault();
        kvkkModal.classList.remove('hidden');
    });

    closeKvkk.addEventListener('click', () => kvkkModal.classList.add('hidden'));

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
    fileInput.removeAttribute('capture');
    selectedFile = null;
    imagePreview.src = '';
    statusText.innerText = 'Hazırlanıyor...';
    statusText.style.color = 'var(--text-secondary)';
    uploadPrompt.classList.remove('hidden');
    previewContainer.classList.add('hidden');
    resultSection.classList.add('hidden');
    startOcrBtn.disabled = true;
    scanLine.style.display = 'none';
}

async function preprocessImage(imageSrc) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const SCALE = img.width < 1200 ? 2 : 1;
            canvas.width = img.width * SCALE;
            canvas.height = img.height * SCALE;
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            let data = imageData.data;
            const w = canvas.width;
            const h = canvas.height;

            for (let i = 0; i < data.length; i += 4) {
                const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                data[i] = data[i+1] = data[i+2] = gray;
            }

            const S = Math.floor(w / 8);
            const T = 0.15;
            const integralImage = new Float32Array(w * h);
            for (let y = 0; y < h; y++) {
                let sum = 0;
                for (let x = 0; x < w; x++) {
                    sum += data[(y * w + x) * 4];
                    if (y === 0) integralImage[y * w + x] = sum;
                    else integralImage[y * w + x] = integralImage[(y - 1) * w + x] + sum;
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
                    const sum = (integralImage[y2 * w + x2] - (y1 > 0 ? integralImage[(y1-1) * w + x2] : 0) - (x1 > 0 ? integralImage[y2 * w + (x1-1)] : 0) + (x1 > 0 && y1 > 0 ? integralImage[(y1 - 1) * w + (x1 - 1)] : 0));

                    const idx = (y * w + x) * 4;
                    data[idx] = data[idx+1] = data[idx+2] = (data[idx] * count < sum * (1.0 - T)) ? 0 : 255;
                }
            }
            ctx.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL('image/png', 0.9));
        };
        img.src = imageSrc;
    });
}

async function performOCR() {
    if (!selectedFile) return;
    const lang = 'tur+eng';

    startOcrBtn.disabled = true;
    resultSection.classList.remove('hidden');
    progressContainer.classList.remove('hidden');
    scanLine.style.display = 'block';
    resultText.value = '';

    try {
        statusText.innerText = 'Akıllı Filtre Uygulanıyor...';
        statusText.style.color = "var(--primary)";
        const enhancedImage = await preprocessImage(imagePreview.src);

        statusText.innerText = 'Motor Başlatılıyor...';
        const worker = await Tesseract.createWorker(lang, 1, {
            logger: m => {
                if (m.status === 'recognizing text') {
                    const progress = Math.round(m.progress * 100);
                    progressPercent.innerText = `${progress}%`;
                    progressBarFill.style.width = `${progress}%`;
                    statusText.innerText = 'Analiz Sürüyor...';
                }
            }
        });

        await worker.setParameters({
            tessedit_pageseg_mode: '3',
            preserve_interword_spaces: '1',
            tessedit_ocr_engine_mode: '1'
        });

        const { data: { text } } = await worker.recognize(enhancedImage);
        const finalResult = text.trim() || 'Hata: Metin bulunamadı.';
        resultText.value = finalResult;
        statusText.innerText = 'Başarıyla Tamamlandı!';

        if (finalResult.length > 3) saveToHistory(finalResult);
        await worker.terminate();
    } catch (error) {
        statusText.innerText = 'Hata Oluştu!';
        statusText.style.color = "#ff4d4d";
        console.error(error);
    } finally {
        scanLine.style.display = 'none';
        startOcrBtn.disabled = false;
        lucide.createIcons();
    }
}

function saveToHistory(text) {
    let history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    const newItem = {
        id: Date.now(),
        date: new Date().toLocaleDateString('tr-TR'),
        time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        text: text,
        length: text.length,
        excerpt: text.substring(0, 80) + '...'
    };
    history.unshift(newItem);
    if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
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
        div.className = 'history-card';
        div.innerHTML = `
            <div class="h-card-body" onclick="loadFromHistory(${item.id})">
                <div class="h-card-header">
                    <span class="h-card-tag"><i data-lucide="calendar"></i> ${item.date}</span>
                    <span class="h-card-time">${item.time}</span>
                </div>
                <p class="h-card-text">${item.excerpt}</p>
                <div class="h-card-footer">
                    <span class="h-card-meta">${item.length} karakter</span>
                    <i data-lucide="arrow-right" class="h-card-icon"></i>
                </div>
            </div>
            <button class="h-card-delete" onclick="deleteHistoryItem(event, ${item.id})">
                <i data-lucide="x"></i>
            </button>
        `;
        historyList.appendChild(div);
    });
    lucide.createIcons();
}

window.loadFromHistory = function (id) {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    const item = history.find(i => i.id === id);
    if (item) {
        resultText.value = item.text;
        resultSection.classList.remove('hidden');
        resultSection.scrollIntoView({ behavior: 'smooth' });
    }
}

window.deleteHistoryItem = function (event, id) {
    event.stopPropagation();
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

function copyToClipboard() {
    resultText.select();
    navigator.clipboard.writeText(resultText.value);
    const originalIcon = copyBtn.innerHTML;
    copyBtn.innerHTML = '<i data-lucide="check"></i>';
    lucide.createIcons();
    setTimeout(() => { copyBtn.innerHTML = originalIcon; lucide.createIcons(); }, 2000);
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function downloadAsTxt() { triggerDownload(new Blob([resultText.value], { type: 'text/plain' }), 'Sonuc.txt'); }

function downloadAsWord() {
    if (!resultText.value) return;
    const content = `<html><body>${resultText.value.replace(/\n/g, '<br>')}</body></html>`;
    triggerDownload(new Blob([content], { type: 'application/msword' }), 'Sonuc.doc');
}

function downloadAsPDF() {
    if (!resultText.value || !window.jspdf) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const splitText = doc.splitTextToSize(resultText.value, 180);
    doc.text(splitText, 15, 20);
    doc.save('Sonuc.pdf');
}
