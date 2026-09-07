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

PORT = 8080

SUPABASE_URL = "https://agsodpzkytdgicpmphxz.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnc29kcHpreXRkZ2ljcG1waHh6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODcxODI3MywiZXhwIjoyMTA0Mjk0MjczfQ.nXVSigEdTUqxVcIOAic59j47lUNn_qI61NQRxs3Deho"

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
