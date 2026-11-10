from flask import Flask
from flask import request
from flask import Response
from flask import jsonify
from flask_cors import CORS
import json
import yt_dlp
import re
import os
import shutil
import time
import uuid
import threading
from urllib.parse import urlparse, parse_qs



TEMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "temp")

COOKIES_SRC = "/etc/secrets/cookies.txt"   
COOKIES_PATH = "/tmp/cookies.txt"          

if os.path.exists(COOKIES_SRC):
    shutil.copy(COOKIES_SRC, COOKIES_PATH)

def cookie_opts():
    return {'cookiefile': COOKIES_PATH} if os.path.exists(COOKIES_PATH) else {}

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


FFMPEG_PATH = os.path.join(BASE_DIR, "ffmpeg", "ffmpeg.exe")

os.makedirs(TEMP_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


MAX_CONCURRENT_DOWNLOADS = 2
DOWNLOAD_SLOTS = threading.BoundedSemaphore(MAX_CONCURRENT_DOWNLOADS)

JOB_MAX_AGE_SECONDS = 60 * 60              

YT_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}
VIDEO_ID_REGEX = re.compile(r"^[A-Za-z0-9_-]{11}$")      
FORMAT_ID_REGEX = re.compile(r"^[\w.-]{1,32}$")          
ANSI_REGEX = re.compile(r"\x1b\[[0-9;]*m")

# ---------------------------------------------------------------------------
# URL validation (backend copy of the frontend validator, for double security)
# ---------------------------------------------------------------------------

def clean_youtube_url(raw):
    
    try:
        parsed = urlparse((raw or "").strip())
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None

    host = (parsed.hostname or "").lower()
    video_id = None

    if host == "youtu.be":
        video_id = parsed.path.lstrip("/").split("/")[0]
    elif host in YT_HOSTS:
        if parsed.path == "/watch":
            video_id = parse_qs(parsed.query).get("v", [""])[0]
        elif re.match(r"^/(shorts|live)/", parsed.path):
            video_id = parsed.path.split("/")[2]
    else:
        return None

    if not video_id or not VIDEO_ID_REGEX.match(video_id):
        return None
    return f"https://www.youtube.com/watch?v={video_id}"

# ---------------------------------------------------------------------------
# Format helpers (same rules as the frontend filter)
# ---------------------------------------------------------------------------

def is_video_format(f):
    """video-only, https, mp4"""
    return (f.get('protocol') == 'https' and f.get('ext') == 'mp4'
            and f.get('vcodec') not in (None, 'none') and f.get('acodec') == 'none')

def is_audio_format(f):
    """audio-only, https, m4a"""
    return (f.get('protocol') == 'https' and f.get('ext') == 'm4a'
            and f.get('acodec') not in (None, 'none') and f.get('vcodec') == 'none')

def isDrc(f):
    return 'drc' in f['format_id'].lower() or 'drc' in (f.get('format_note') or '').lower()

def getAudioFormat(data):
    
    candidates = [f for f in data if is_audio_format(f) and not isDrc(f)]
    original = [f for f in candidates if 'original' in (f.get('format_note') or '').lower()]
    pool = original or candidates
    return max(pool, key=lambda f: f.get('abr') or f.get('tbr') or 0, default=None)

class BadFormat(Exception):
    """The format_id sent by the client isn't a valid video/audio format of this video."""

def build_selector(format_id, kind):
    
    def selector(ctx):
        formats = ctx.get('formats') or []

        if kind == 'video':
            video = next((f for f in formats if f['format_id'] == format_id and is_video_format(f)), None)
            audio = getAudioFormat(formats)
            if video is None or audio is None:
                raise BadFormat("That video format isn't available. Please go back and pick another one.")
            yield {
                'format_id': f'{video["format_id"]}+{audio["format_id"]}',
                'ext': 'mp4',
                'requested_formats': [video, audio],
                # Must be + separated list of protocols
                'protocol': f'{video["protocol"]}+{audio["protocol"]}',
            }
        else:
            audio = next((f for f in formats if f['format_id'] == format_id and is_audio_format(f)), None)
            if audio is None:
                raise BadFormat("That audio format isn't available. Please go back and pick another one.")
            yield audio
    return selector

# ---------------------------------------------------------------------------
# Misc helpers
# ---------------------------------------------------------------------------

def base_opts():
    """Options used for every yt-dlp call. noplaylist stops song 'queues' / playlists
    from being downloaded even if a list= parameter slips through."""
    return {
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'no_color': True,
        **cookie_opts(),
    }

def error(message, status):
    return jsonify(error=message), status

def friendly_error(e):
    msg = ANSI_REGEX.sub("", str(e))
    msg = re.sub(r"^ERROR:\s*", "", msg.strip())
    if "Sign in to confirm" in msg:
        return "YouTube is blocking the server right now. Please try again later."
    return (msg.splitlines() or ["Something went wrong."])[0][:300]

def make_filename(title, ext):
    """'My Video: Part 1?' -> 'My_Video_Part_1.mp4'"""
    safe_title = re.sub(r'[\\/:*?"<>|]+', "", title or "video")
    safe_title = re.sub(r"\s+", "_", safe_title.strip())
    return (safe_title or "video")[:120] + "." + ext

def cleanup_old_jobs():
    """Deletes temp folders left behind by crashed/aborted requests."""
    now = time.time()
    for name in os.listdir(TEMP_DIR):
        folder = os.path.join(TEMP_DIR, name)
        try:
            if os.path.isdir(folder) and now - os.path.getmtime(folder) > JOB_MAX_AGE_SECONDS:
                shutil.rmtree(folder, ignore_errors=True)
        except OSError:
            pass

# ---------------------------------------------------------------------------
# App + routes
# ---------------------------------------------------------------------------

app = Flask(__name__)
CORS(app, origins=os.environ.get("ALLOWED_ORIGIN", "*"))

@app.route("/info")
def get_video_info():
    url = clean_youtube_url(request.args.get('url', ''))
    if not url:
        return error("Please enter a valid YouTube video link.", 400)

    try:
        with yt_dlp.YoutubeDL(base_opts()) as ydl:
            print('url : ' + url)
            info = ydl.extract_info(url, download=False)
            data = ydl.sanitize_info(info)
    except Exception as e:
        print(e)
        return error(friendly_error(e), 502)

    
    formats = [{
        'format_id': f.get('format_id'),
        'format_note': f.get('format_note'),
        'ext': f.get('ext'),
        'protocol': f.get('protocol'),
        'width': f.get('width'),
        'height': f.get('height'),
        'fps': f.get('fps'),
        'vcodec': f.get('vcodec'),
        'acodec': f.get('acodec'),
        'abr': f.get('abr'),
        'tbr': f.get('tbr'),
        'filesize': f.get('filesize'),
        'filesize_approx': f.get('filesize_approx'),
    } for f in data.get('formats', []) if is_video_format(f) or is_audio_format(f)]

    return jsonify(
        id=data.get('id'),
        title=data.get('title'),
        uploader=data.get('uploader') or data.get('channel'),
        duration=data.get('duration'),
        thumbnail=data.get('thumbnail'),
        formats=formats,
    )

@app.route("/download")
def download_video():
    url = clean_youtube_url(request.args.get('url', ''))
    format_id = request.args.get('format_id', '')
    kind = request.args.get('type', '')          

    if not url:
        return error("Please enter a valid YouTube video link.", 400)
    if kind not in ("video", "audio") or not FORMAT_ID_REGEX.match(format_id):
        return error("Invalid format selected.", 400)
    if not DOWNLOAD_SLOTS.acquire(blocking=False):
        return error("The server is busy with other downloads. Please try again in a minute.", 429)

    cleanup_old_jobs()
    
    job_dir = os.path.join(TEMP_DIR, uuid.uuid4().hex)
    os.makedirs(job_dir)

    opts = {
        **base_opts(),
        'format': build_selector(format_id, kind),
        'merge_output_format': 'mp4',
        'outtmpl': os.path.join(job_dir, '%(id)s.%(ext)s'),
    }
    if os.path.exists(FFMPEG_PATH):          
        opts['ffmpeg_location'] = FFMPEG_PATH

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            downloads = info.get('requested_downloads') or []
            path = downloads[0]['filepath'] if downloads else ydl.prepare_filename(info)
        if not os.path.exists(path):
            raise FileNotFoundError("The downloaded file could not be found.")
    except BadFormat as e:
        shutil.rmtree(job_dir, ignore_errors=True)
        return error(str(e), 400)
    except Exception as e:
        print(e)
        shutil.rmtree(job_dir, ignore_errors=True)
        return error(friendly_error(e), 502)
    finally:
        DOWNLOAD_SLOTS.release()             

    ext = os.path.splitext(path)[1].lstrip(".") or ("m4a" if kind == "audio" else "mp4")

    def stream_file():
        try:
            with open(path, 'rb') as f:
                while chunk := f.read(1024 * 1024):
                    yield chunk
        finally:
            shutil.rmtree(job_dir, ignore_errors=True)

    response = Response(
        stream_file(),
        mimetype="audio/mp4" if kind == "audio" else "video/mp4",
        headers={'Content-Length': str(os.path.getsize(path))},   
    )
    response.headers.set('Content-Disposition', 'attachment', filename=make_filename(info.get('title'), ext))
    return response

@app.route("/health")
def health():
    return {"status": "ok"}
