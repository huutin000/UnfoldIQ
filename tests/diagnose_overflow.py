import base64
import json
import os
import re
import socket
import struct
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

BASE_DIR = Path(r"D:\Project\UnfoldIQ")
EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
CDP_PORT = 9255
USER_DATA = BASE_DIR / "temp" / "edge_cdp_profile_diag"
REAL_PROJECT = "2026-09-12_210003_youtube-narration-01"

sys.path.insert(0, str(BASE_DIR))
sys.path.insert(0, str(BASE_DIR / "tests"))
from verify_phase15a_browser import MinimalCDPClient, ensure_server_running

server_proc = ensure_server_running()

edge_proc = subprocess.Popen([
    EDGE_PATH,
    f"--remote-debugging-port={CDP_PORT}",
    f"--user-data-dir={USER_DATA}",
    "--headless=new",
    "--disable-gpu",
    "--window-size=1920,1080",
    "about:blank"
])
time.sleep(2)
try:
    req = urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json", timeout=5)
    tabs = json.loads(req.read().decode())
    page_tab = next(t for t in tabs if t.get("type") == "page")
    client = MinimalCDPClient(page_tab["webSocketDebuggerUrl"])
    client.send_command("Page.enable")
    client.send_command("Runtime.enable")
    client.send_command("Network.enable")
    client.send_command("Network.setCacheDisabled", {"cacheDisabled": True})
    client.send_command("Page.navigate", {"url": "http://127.0.0.1:7860"})
    time.sleep(3)
    client.eval_js(f"window.loadPreviewAudio('{REAL_PROJECT}', 665, false);")
    time.sleep(2)
    client.eval_js("window.switchWorkspace('overview');")
    time.sleep(1)

    viewports = [320, 375, 390, 768, 1024, 1280, 1366, 1440, 1600, 1920]
    all_pass = True
    for vp_w in viewports:
        client.set_viewport(vp_w, 800)
        time.sleep(0.5)
        info = client.eval_js(f"""
        (() => {{
            const winW = {vp_w};
            const docEl = document.documentElement;
            const body = document.body;
            const scrollW = Math.max(docEl.scrollWidth, body.scrollWidth);
            const clientW = window.innerWidth;
            return {{
                winW: winW,
                scrollW: scrollW,
                clientW: clientW,
                overflow: scrollW > (clientW + 2)
            }};
        }})()
        """)
        status = "FAIL" if info['overflow'] else "PASS"
        if info['overflow']:
            all_pass = False
        print(f"  Viewport {vp_w:4d}px: scrollW={info['scrollW']}, innerW={info['clientW']} -> {status}")
    print(f"\nResult: {'ALL 10 VIEWPORTS PASS' if all_pass else 'SOME VIEWPORTS FAIL'}")

finally:
    edge_proc.kill()
    if server_proc:
        server_proc.kill()

