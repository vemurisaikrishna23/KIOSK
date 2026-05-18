import re
from django.conf import settings

def generate_webrtc_url(stream_path: str) -> str:
    """
    Generate WebRTC playback URL dynamically using MEDIAMTX_SERVER host.
    If host is an IP, append port 8889.
    If host is a domain/subdomain, omit the port.
    """
    server = getattr(settings, "MEDIAMTX_SERVER", {})
    subdomain = server.get("subdomain", "localhost")

    port = 8889  # MediaMTX WebRTC default

    # Detect IP vs subdomain
    if re.match(r"^\d{1,3}(\.\d{1,3}){3}$", subdomain):
        # Example: 72.60.221.158 → https://72.60.221.158:8889/cam1/whep
        return f"https://{subdomain}:{port}/{stream_path}"
    else:
        # Example: stream.myaccessio.com → https://stream.myaccessio.com/cam1/whep
        return f"https://{subdomain}/{stream_path}"
