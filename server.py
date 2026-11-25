import http.server
import socketserver
import os
import sys
import json
import base64
import time
import random
import urllib.request
import ssl
import hmac
import hashlib
import base64
from datetime import datetime, timezone

PORT = 8080

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://agsodpzkytdgicpmphxz.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnc29kcHpreXRkZ2ljcG1waHh6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODcxODI3MywiZXhwIjoyMTA0Mjk0MjczfQ.nXVSigEdTUqxVcIOAic59j47lUNn_qI61NQRxs3Deho")
PASS_HMAC_SECRET = hashlib.sha256(("poilepiwko-pass-v1:" + os.environ.get("PASS_TOKEN_SECRET", SUPABASE_KEY)).encode("utf-8")).digest()
LOCAL_PASS_STATE = {}

def _b64u_encode(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode("ascii").rstrip("=")

def _b64u_decode(s: str) -> bytes:
    pad = "=" * ((4 - len(s) % 4) % 4)
    return base64.urlsafe_b64decode(s + pad)

def _sign_pass_token(payload_str: str):
    b64_payload = _b64u_encode(payload_str.encode("utf-8"))
    sig_buf = hmac.new(PASS_HMAC_SECRET, b64_payload.encode("ascii"), hashlib.sha256).digest()[:12]
    b64_sig = _b64u_encode(sig_buf)
    code = hashlib.sha256(b64_sig.encode("ascii")).hexdigest()[:4].upper()
    return f"{b64_payload}.{b64_sig}", code

def _verify_pass_token(token_str: str):
    parts = str(token_str or "").strip().split(".")
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return {"valid": False, "reason": "INVALID", "message": "Nieprawidłowy format kodu weryfikacyjnego."}
    b64_payload, b64_sig = parts
    try:
        sig_buf = _b64u_decode(b64_sig)
    except Exception:
        return {"valid": False, "reason": "INVALID", "message": "Uszkodzony podpis kodu QR."}
    expected = hmac.new(PASS_HMAC_SECRET, b64_payload.encode("ascii"), hashlib.sha256).digest()[:12]
    if not hmac.compare_digest(sig_buf, expected):
        return {"valid": False, "reason": "INVALID", "message": "Nieprawidłowy podpis kryptograficzny — podejrzenie fałszywego kodu."}
    try:
        raw = _b64u_decode(b64_payload).decode("utf-8")
    except Exception:
        return {"valid": False, "reason": "INVALID", "message": "Błąd dekodowania danych karty."}
    fields = raw.split("|")
    if len(fields) < 5:
        return {"valid": False, "reason": "INVALID", "message": "Niekompletne dane tokenu karty."}
    num_digits, exp_str, redeem_flag, dev_short, *name_rest = fields
    exp_sec = int(exp_str) if exp_str.isdigit() else 0
    now_sec = int(time.time())
    code = hashlib.sha256(b64_sig.encode("ascii")).hexdigest()[:4].upper()
    user_number = f"#{num_digits}"
    member_name = "|".join(name_rest) or "PIWOSZ"
    if now_sec > exp_sec:
        ago = now_sec - exp_sec
        return {
            "valid": False,
            "reason": "EXPIRED",
            "userNumber": user_number,
            "memberName": member_name,
            "expiredSecondsAgo": ago,
            "securityCode": code,
            "message": f"Kod QR wygasł {ago} s temu (ważność max 90 s). To zrzut ekranu lub nieaktualny kod!"
        }
    return {
        "valid": True,
        "userNumber": user_number,
        "memberName": member_name,
        "isRedeemActive": redeem_flag == "1",
        "deviceTag": dev_short,
        "secondsLeft": exp_sec - now_sec,
        "securityCode": code
    }

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        if self.path == "/api/auth":
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body.decode('utf-8'))
                action = data.get("action")
                payload = data.get("payload") or {}

                def send_json(code, obj):
                    self.send_response(code)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(obj).encode('utf-8'))

                if action == "verify-pass-token":
                    res = _verify_pass_token(payload.get("token", ""))
                    res["verifiedAt"] = int(time.time() * 1000)
                    send_json(200, res)
                    return

                if action == "issue-pass-token":
                    access_token = payload.get("accessToken", "")
                    if not access_token:
                        send_json(401, {"error": "UNAUTHORIZED", "message": "Brak aktywnej sesji logowania."})
                        return
                    ctx = ssl._create_unverified_context()
                    req = urllib.request.Request(
                        f"{SUPABASE_URL}/auth/v1/user",
                        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {access_token}"},
                        method="GET"
                    )
                    try:
                        with urllib.request.urlopen(req, context=ctx) as resp:
                            authed_user = json.loads(resp.read().decode("utf-8"))
                    except Exception:
                        send_json(401, {"error": "UNAUTHORIZED", "message": "Sesja wygasła. Zaloguj się ponownie."})
                        return

                    uid = authed_user.get("id")
                    meta = dict(authed_user.get("user_metadata") or {})
                    st = LOCAL_PASS_STATE.setdefault(uid, {})
                    now_ms = int(time.time() * 1000)
                    now_month = datetime.now(timezone.utc).strftime("%Y-%m")
                    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                    clean_dev = "".join(c for c in str(payload.get("deviceId") or "") if c.isalnum() or c in "-_")[:48]
                    prev_dev = st.get("pass_device_id") or meta.get("pass_device_id") or ""
                    switches = int(st.get("pass_device_switches", meta.get("pass_device_switches", 0)) or 0) if (st.get("pass_device_month") or meta.get("pass_device_month")) == now_month else 0

                    if clean_dev:
                        if not prev_dev:
                            st["pass_device_id"] = clean_dev
                            st["pass_device_month"] = now_month
                            st["pass_device_switches"] = switches
                        elif prev_dev != clean_dev:
                            if switches >= 2:
                                send_json(403, {"error": "DEVICE_LIMIT", "message": "Ta Karta Pass jest powiązana z innym telefonem (limit 2 zmian urządzenia w miesiącu został wyczerpany)."})
                                return
                            switches += 1
                            st["pass_device_id"] = clean_dev
                            st["pass_device_month"] = now_month
                            st["pass_device_switches"] = switches

                    redeem_exp = int(st.get("pass_redeem_expires_at", meta.get("pass_redeem_expires_at", 0)) or 0)
                    last_red = int(st.get("pass_last_redeemed_at", meta.get("pass_last_redeemed_at", 0)) or 0)
                    red_today = int(st.get("pass_redeem_count_today", meta.get("pass_redeem_count_today", 0)) or 0) if (st.get("pass_redeem_day") or meta.get("pass_redeem_day")) == today_str else 0

                    if payload.get("redeem") is True:
                        if redeem_exp > now_ms:
                            pass
                        elif last_red and (now_ms - last_red) < 20 * 60 * 1000:
                            rem_min = max(1, (20 * 60 * 1000 - (now_ms - last_red) + 59999) // 60000)
                            send_json(429, {"error": "COOLDOWN", "remainingMinutes": rem_min, "message": f"Ochrona przed dzieleniem rabatu: ponowna aktywacja przy barze możliwa za {rem_min} min."})
                            return
                        else:
                            redeem_exp = now_ms + 120 * 1000
                            st["pass_redeem_expires_at"] = redeem_exp
                            st["pass_last_redeemed_at"] = now_ms
                            st["pass_redeem_day"] = today_str
                            red_today += 1
                            st["pass_redeem_count_today"] = red_today

                    raw_name = str(meta.get("display_name") or meta.get("username") or "PIWOSZ").replace("|", " ").strip().upper()[:14] or "PIWOSZ"
                    u_num = str(meta.get("user_number") or "#000001")
                    num_digits = "".join(c for c in u_num.lstrip("#") if c.isalnum())[:10] or "000001"
                    exp_sec = int(time.time()) + 90
                    is_active = redeem_exp > now_ms
                    dev_short = ("".join(c for c in clean_dev if c.isalnum()) or "web")[:6]
                    tok, code = _sign_pass_token(f"{num_digits}|{exp_sec}|{'1' if is_active else '0'}|{dev_short}|{raw_name}")
                    send_json(200, {
                        "success": True,
                        "token": tok,
                        "expiresAt": exp_sec * 1000,
                        "redeemExpiresAt": redeem_exp if is_active else 0,
                        "isRedeemActive": is_active,
                        "redeemedToday": red_today,
                        "securityCode": code,
                        "switchesRemaining": max(0, 2 - switches)
                    })
                    return

                send_json(400, {"error": f"Lokalny serwer nie obsługuje akcji: {action}"})
                return
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
                return

        if self.path == "/api/upload":
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body.decode('utf-8'))
                img_b64 = data.get("imageBase64", "")
                content_type = data.get("contentType", "image/jpeg")
                file_name = data.get("fileName", "proof")

                if not img_b64:
                    self.send_response(400)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "Missing imageBase64"}).encode('utf-8'))
                    return

                if "," in img_b64:
                    img_b64 = img_b64.split(",", 1)[1]

                img_bytes = base64.b64decode(img_b64)
                ext = "png" if "png" in content_type else "webp" if "webp" in content_type else "jpg"
                clean_name = "".join(c for c in file_name if c.isalnum() or c in "-_")[:25] or "proof"
                unique_name = f"{clean_name}-{int(time.time())}-{random.randint(1000, 9999)}.{ext}"

                # Upload to Supabase Storage
                upload_url = f"{SUPABASE_URL}/storage/v1/object/proofs/{unique_name}"
                req = urllib.request.Request(
                    upload_url,
                    data=img_bytes,
                    headers={
                        "apikey": SUPABASE_KEY,
                        "Authorization": f"Bearer {SUPABASE_KEY}",
                        "Content-Type": content_type,
                        "x-upsert": "true"
                    },
                    method="POST"
                )
                ctx = ssl._create_unverified_context()
                with urllib.request.urlopen(req, context=ctx) as resp:
                    public_url = f"{SUPABASE_URL}/storage/v1/object/public/proofs/{unique_name}"
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "success": True,
                        "url": public_url,
                        "fileName": unique_name
                    }).encode('utf-8'))
                    return
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
                return

        return super().do_POST()

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"🍺 Ile Kosztuje Piwo server running at http://localhost:{PORT}")
        sys.stdout.flush()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")
