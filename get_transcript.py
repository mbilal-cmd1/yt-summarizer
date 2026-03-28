import sys
import warnings
warnings.filterwarnings("ignore")
from youtube_transcript_api import YouTubeTranscriptApi

video_id = sys.argv[1]
try:
    api = YouTubeTranscriptApi()
    t = api.fetch(video_id)
    text = " ".join(s.text for s in t.snippets)
    print(text[:8000])
except Exception as e:
    print("", end="")
