from flask import Flask
from flask import request
from flask import send_file  # CHANGED: needed for send_file
from flask_cors import CORS
import json
import yt_dlp
import re
import os  # CHANGED: for building paths

title = "video"
path = ""  # CHANGED: will hold the downloaded file's location

# CHANGED: backend/temp folder, created if it doesn't exist
TEMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "temp")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# CHANGED: absolute path built from this file's location
FFMPEG_PATH = os.path.join(BASE_DIR, "ffmpeg", "ffmpeg.exe")

os.makedirs(TEMP_DIR, exist_ok=True)

def getVideoFormat(data):
    formats = data[::-1]
    for format in formats:
        if format['vcodec'] != 'none' and format['acodec'] == 'none':
            if(format["protocol"] == "https" and format["ext"] == "mp4"):
                return format
            
def getAudioFormat(data):
    formats = data[::-1]
    for format in formats:
        if format['vcodec'] == 'none' and format['acodec'] != 'none':
            if(format["protocol"] == "https" and format["ext"] == "m4a"):
                return format



def getFormats(url):
    global title, path  # CHANGED: so the assignments below update the top-level variables
    with yt_dlp.YoutubeDL({}) as ydl:
        info = ydl.extract_info(url, download=False)


        data = ydl.sanitize_info(info)

        title = data.get("title", "video")
        safe_title = re.sub(r'[\\/:*?"<>|]+', "", title)
        title = safe_title.strip().replace(" ", "_") + ".mp4"

        # CHANGED: the file will be saved as backend/temp/<video id>.mp4
        path = os.path.join(TEMP_DIR, data["id"] + ".mp4")

        best_video = getVideoFormat(data["formats"])
        best_audio = getAudioFormat(data["formats"])

        # data = ydl.sanitize_info(info)
        # {
        #     'format_id': f'{best_video["format_id"]}+{best_audio["format_id"]}',
        #     'ext': best_video['ext'],
        #     'requested_formats': [best_video, best_audio],
        #     # Must be + separated list of protocols
        #     'protocol': f'{best_video["protocol"]}+{best_audio["protocol"]}',
        #     "ffmpeg_location": r"C:\Users\HP\Documents\Python Projects\ffmpeg\ffmpeg.exe",
        # }

        format_selector = f'{best_video["format_id"]}+{best_audio["format_id"]}'

        opts = {
            'format': format_selector,
            'merge_output_format': 'mp4',
            'outtmpl': os.path.join(TEMP_DIR, data["id"] + ".%(ext)s"),
        }
        if os.path.exists(FFMPEG_PATH):          # only true on your Windows machine
            opts['ffmpeg_location'] = FFMPEG_PATH
        return opts



app = Flask(__name__)
CORS(app, origins=os.environ.get("ALLOWED_ORIGIN", "*"))

@app.route("/info")
def get_video_info():
    url = request.args.get('url', '')
    with yt_dlp.YoutubeDL({}) as ydl:
        print('url : ' + url)
        info = ydl.extract_info(url, download=False)
        data = ydl.sanitize_info(info)
        return data
        # return {'name': url}

@app.route("/download")
def download_video():
    url = request.args.get('url', '')
    with yt_dlp.YoutubeDL(getFormats(url)) as ydl:
        ydl.download(url)
        return send_file(path, as_attachment=True, download_name=title)  # CHANGED: filename -> title

@app.route("/health")
def health():
    return {"status": "ok"}