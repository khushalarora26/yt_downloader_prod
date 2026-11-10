const API_URL = "https://yt-downloader-prod.onrender.com";

// For local testing
// const API_URL = "http://127.0.0.1:5000";


const STORAGE_KEY = "ytdl_video";



const YT_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"];
const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;   

function fail(error) {
    return { valid: false, url: null, error };
}

function validateYouTubeUrl(input) {
    let raw = (input || "").trim();
    if (!raw) return fail("URL can't be empty.");


    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;

    let u;
    try {
        u = new URL(raw);
    } catch {
        return fail("This is not a valid URL.");
    }

    const host = u.hostname.toLowerCase();
    let id = null;

    if (host === "youtu.be") {
        
        id = u.pathname.slice(1).split("/")[0];
    } else if (YT_HOSTS.includes(host)) {
        const path = u.pathname;

        if (path === "/watch") {
            id = u.searchParams.get("v");
            if (!id && u.searchParams.has("list")) {
                return fail("Playlist links aren't supported. Paste a single video link.");
            }
        } else if (/^\/(shorts|live)\//.test(path)) {
            id = path.split("/")[2];
        } else if (path === "/playlist") {
            return fail("Playlist links aren't supported. Paste a single video link.");
        } else if (/^\/(@|channel\/|c\/|user\/)/.test(path)) {
            return fail("Channel links aren't supported. Paste a single video link.");
        } else {
            return fail("This doesn't look like a YouTube video link.");
        }
    } else {
        return fail("Only YouTube links are supported.");
    }

    if (!id || !VIDEO_ID_REGEX.test(id)) {
        return fail("Could not find a valid video ID in this link.");
    }

    return { valid: true, url: `https://www.youtube.com/watch?v=${id}`, error: null };
}



function pickFields(f) {
    return {
        format_id: f.format_id,
        format_note: f.format_note,
        ext: f.ext,
        width: f.width,
        height: f.height,
        fps: f.fps,
        vcodec: f.vcodec,
        acodec: f.acodec,
        abr: f.abr,
        tbr: f.tbr,
        filesize: f.filesize,
        filesize_approx: f.filesize_approx,
    };
}

function keepOriginalAudio(audio) {
    const noDrc = audio.filter(f => !/drc/i.test(f.format_id) && !/drc/i.test(f.format_note || ""));
    const pool = noDrc.length ? noDrc : audio;
    const original = pool.filter(f => /original/i.test(f.format_note || ""));
    return original.length ? original : pool;
}

function filterFormats(formats) {
    const all = Array.isArray(formats) ? formats : [];

    const video = all
        .filter(f => f.protocol === "https" && f.ext === "mp4" && f.vcodec && f.vcodec !== "none" && f.acodec === "none")
        .map(pickFields)
        .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0));

    const audio = keepOriginalAudio(
        all.filter(f => f.protocol === "https" && f.ext === "m4a" && f.acodec && f.acodec !== "none" && f.vcodec === "none")
    )
    .map(pickFields)
    .sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));

    return { video, audio };
}



function formatSize(f) {
    const bytes = f.filesize || f.filesize_approx;
    if (!bytes) return "Size n/a";
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    return `${f.filesize ? "" : "~"}${Number(mb).toLocaleString()} MB`;
}

function formatDuration(sec) {
    if (!sec) return "";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = String(Math.floor(sec % 60)).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}


function safeFileName(title) {
    const cleaned = (title || "video").replace(/[\\/:*?"<>|]+/g, "").trim().replace(/\s+/g, "_");
    return (cleaned || "video").slice(0, 120);
}

function friendlyError(err) {
    
    if (err instanceof TypeError) return "Couldn't reach the server. Please try again in a moment.";
    return err.message || "Something went wrong.";
}

function toast(message, type = "info") {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
        el.classList.remove("show");
        setTimeout(() => el.remove(), 300);
    }, 4000);
}
