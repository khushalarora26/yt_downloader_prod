// ============ Home page ============

const form = document.getElementById("urlForm");
const videoURL = document.getElementById("videoURL");
const downloadBtn = document.getElementById("downloadBtn");
const pasteBtn = document.getElementById("pasteBtn");
const errorEl = document.getElementById("error");

function showError(message) {
    errorEl.textContent = message;
    form.classList.remove("shake");
    void form.offsetWidth;            
    form.classList.add("shake");
}

function clearError() {
    errorEl.textContent = "";
}

function setLoading(isLoading) {
    downloadBtn.disabled = isLoading;
    downloadBtn.classList.toggle("loading", isLoading);
    videoURL.readOnly = isLoading;
}

async function getInfo(cleanUrl) {
    const res = await fetch(`${API_URL}/info?url=${encodeURIComponent(cleanUrl)}`);

    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }

    if (!res.ok || !data || data.error) {
        throw new Error((data && data.error) || "Couldn't fetch this video. Please check the link.");
        // return {"error":true, "message": "Couldn't fetch this video. Please check the link."}
    }
    return data;
}


form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();

    const result = validateYouTubeUrl(videoURL.value);
    if (!result.valid) {
        showError(result.error);
        return;
    }

    setLoading(true);
    try {
        const data = await getInfo(result.url);          
        
        const formats = filterFormats(data.formats);

        if (!formats.video.length && !formats.audio.length) {
            throw new Error("No downloadable formats were found for this video.");
        }

        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
            id: data.id,
            url: result.url,
            title: data.title,
            uploader: data.uploader || data.channel || "",
            duration: data.duration,
            thumbnail: data.thumbnail,
            video: formats.video,
            audio: formats.audio,
        }));
        window.location.href = "formats.html";
    } catch (err) {
        showError(friendlyError(err));
        setLoading(false);
    }
});


pasteBtn.addEventListener("click", async () => {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            videoURL.value = text.trim();
            clearError();
        }
    } catch {
        videoURL.focus();
    }
    videoURL.focus();
});

videoURL.addEventListener("input", clearError);


window.addEventListener("pageshow", () => setLoading(false));
