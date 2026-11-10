// ============ Formats page ============ 

const thumbEl = document.getElementById("thumbnail");
const titleEl = document.getElementById("title");
const metaEl = document.getElementById("meta");
const listEl = document.getElementById("formats");
const noteEl = document.getElementById("note");
const overlay = document.getElementById("overlay");
const overlayText = document.getElementById("overlayText");
const modeButtons = document.querySelectorAll(".mode");


let videoData = null;
let currentMode = "video";
let isDownloading = false;

function loadVideo() {
    try {
        return JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    } catch {
        return null;
    }
}

// ---------- Rendering ----------

function codecLabel(codec = "") {
    if (codec.startsWith("avc1")) return "H.264";
    if (codec.startsWith("av01")) return "AV1";
    if (codec.startsWith("vp09") || codec.startsWith("vp9")) return "VP9";
    if (codec.startsWith("mp4a")) return "AAC";
    if (codec.startsWith("opus")) return "Opus";
    return codec.split(".")[0];
}

function makeTag(text) {
    const t = document.createElement("em");
    t.textContent = text;
    return t;
}

function buildRow(f, type) {
    const row = document.createElement("div");
    row.className = "row";

    const main = document.createElement("div");
    main.className = "row-main";

    const res = document.createElement("span");
    res.className = "res";
    const tags = document.createElement("span");
    tags.className = "tags";

    if (type === "video") {
        
        const p = f.width && f.height ? Math.min(f.width, f.height) : f.height;
        res.textContent = p ? `${p}p` : "Video";
        if (f.fps > 30) tags.appendChild(makeTag(`${Math.round(f.fps)} fps`));
        tags.appendChild(makeTag(codecLabel(f.vcodec)));
        tags.appendChild(makeTag("MP4"));
    } else {
        const kbps = f.abr || f.tbr;
        res.textContent = kbps ? `${Math.round(kbps)} kbps` : "Audio";
        tags.appendChild(makeTag(codecLabel(f.acodec)));
        tags.appendChild(makeTag("M4A"));
    }
    main.append(res, tags);

    const size = document.createElement("span");
    size.className = "size";
    size.textContent = formatSize(f);

    const btn = document.createElement("button");
    btn.className = "dl-btn";
    btn.type = "button";
    btn.textContent = "Download";
    btn.addEventListener("click", () => startDownload(f, type));

    row.append(main, size, btn);
    return row;
}

function renderList() {
    const items = videoData[currentMode];
    listEl.replaceChildren();
    listEl.scrollTop = 0;

    if (!items.length) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = currentMode === "video"
            ? "No video formats available for this video."
            : "No audio formats available for this video.";
        listEl.appendChild(empty);
    } else {
        items.forEach(f => listEl.appendChild(buildRow(f, currentMode)));
    }

    noteEl.textContent = currentMode === "video"
        ? "Sizes are for the video stream only. The best audio is merged in, so the final file is slightly larger."
        : "";
}

function setMode(mode) {
    currentMode = mode;
    modeButtons.forEach(b => {
        const active = b.dataset.mode === mode;
        b.classList.toggle("active", active);
        b.setAttribute("aria-selected", active);
    });
    renderList();
}

// ---------- Downloading ----------

function showOverlay(text) {
    overlayText.textContent = text;
    overlay.classList.remove("hidden");
}

function hideOverlay() {
    overlay.classList.add("hidden");
}

async function startDownload(format, type) {
    if (isDownloading) return;
    isDownloading = true;
    showOverlay("Preparing your download…");

    const params = new URLSearchParams({
        url: videoData.url,
        format_id: format.format_id,
        type,                                   
    });
    const fileName = safeFileName(videoData.title) + (type === "audio" ? ".m4a" : ".mp4");

    try {
        const res = await fetch(`${API_URL}/download?${params}`);

        if (!res.ok) {
            let msg = "Download failed. Please try again.";
            try { msg = (await res.json()).error || msg; } catch {  }
            throw new Error(msg);
        }

        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);

        toast("Download started", "success");
    } catch (err) {
        toast(friendlyError(err), "error");
    } finally {
        hideOverlay();
        isDownloading = false;
    }
}

// ---------- Init ----------

function init() {
    videoData = loadVideo();
    if (!videoData) {                           
        window.location.replace("index.html");
        return;
    }

    document.title = `${videoData.title} · yt downloader`;
    titleEl.textContent = videoData.title || "Untitled video";
    metaEl.textContent = [videoData.uploader, formatDuration(videoData.duration)].filter(Boolean).join("  •  ");

    thumbEl.src = videoData.thumbnail || `https://i.ytimg.com/vi/${videoData.id}/hqdefault.jpg`;
    thumbEl.onerror = () => {                   
        thumbEl.onerror = null;
        thumbEl.src = `https://i.ytimg.com/vi/${videoData.id}/hqdefault.jpg`;
    };

    document.getElementById("countVideo").textContent = `${videoData.video.length} formats`;
    document.getElementById("countAudio").textContent = `${videoData.audio.length} formats`;

    modeButtons.forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));

    
    setMode(videoData.video.length || !videoData.audio.length ? "video" : "audio");
}

init();
