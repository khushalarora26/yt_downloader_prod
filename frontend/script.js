const API_URL = "https://yt-downloader-prod.onrender.com";
let downloadBtn = document.getElementById('downloadBtn');
let videoURL = document.getElementById('videoURL');
let heading = document.getElementById('heading')
let thumbnail = document.createElement('img');
thumbnail.id = 'thumbnail'
let res=  {}


async function getInfo(videoUrl) {
  res = await fetch(`${API_URL}/info?url=${encodeURIComponent(videoUrl)}`);
  console.log(res);

  console.log(res.body);
  console.log('Data : ');
  const data = await res.json();
  console.log(data);
  thumbnail.src = data.thumbnail;
  heading.replaceWith(thumbnail)
//TODO :    document.getElementById('heading') popultate data.thumbnail
}

function download(videoUrl) {
    window.location.href = `${API_URL}/download?url=${encodeURIComponent(videoUrl)}`;
}

downloadBtn.addEventListener('click', ()=>{
    if(!videoURL.value){
        alert("URL can't be empty!!!")
    }
    else{
        // getInfo(videoURL.value)
        download(videoURL.value)
    }
})