#!/usr/bin/env python3
"""Nova age-provider — the service behind AGE_PROVIDER_URL.

Contract (see ../lib/age-assurance.js):
  POST /verify   Authorization: Bearer <AGE_PROVIDER_SECRET>
                 {"ref": str, "ts": unix-seconds, "minAge": 18, "image": "<base64 JPEG>"}
  ->  200        {"ref": same, "ts": now, "result": "adult"|"minor"|"uncertain", "signature": hex}
                 signature = HMAC-SHA256(AGE_PROVIDER_SECRET, f"{ref}.{result}.{ts}")

Privacy: the image lives only in memory for the duration of the request. It is never written to disk or logged.
Only (ref prefix, estimated age, face count, verdict) are logged.
"""
import base64
import binascii
import hashlib
import hmac
import json
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import estimator as est

MAX_BODY = 1_300_000
MAX_IMAGE_B64 = 900_000
TS_SKEW = 300            # request timestamp must be within +/- 5 min
CACHE_TTL = 600          # same ref within 10 min -> same verdict (makes client retries safe, nothing is re-processed)
RATE_PER_MIN = 30


def load_env_file(path):
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip("'\""))


load_env_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

SECRET = os.environ.get("AGE_PROVIDER_SECRET", "")
ADULT_AT = float(os.environ.get("ADULT_AT", "25"))
MINOR_BELOW = float(os.environ.get("MINOR_BELOW", "18"))


def decide(ages, min_age=18):
    """Pure decision rule on estimated ages. Several people in the picture is never accepted."""
    if len(ages) != 1:
        return "uncertain"
    a = ages[0]
    adult_at = max(ADULT_AT, min_age)
    if a >= adult_at:
        return "adult"
    if a < min(MINOR_BELOW, min_age):
        return "minor"
    return "uncertain"


def sign(secret, ref, result, ts):
    return hmac.new(secret.encode(), f"{ref}.{result}.{ts}".encode(), hashlib.sha256).hexdigest()


class State:
    est = None
    ready = False
    lock = threading.Lock()                 # one inference at a time (TensorFlow is not happy with parallel calls)
    cache = {}                              # ref -> (expires, result)
    hits = []                               # request times for the rate limiter
    cl = threading.Lock()


def rate_ok():
    now = time.time()
    with State.cl:
        State.hits = [t for t in State.hits if now - t < 60]
        if len(State.hits) >= RATE_PER_MIN:
            return False
        State.hits.append(now)
        return True


def cached(ref):
    with State.cl:
        for k in [k for k, v in State.cache.items() if v[0] < time.time()]:
            del State.cache[k]
        v = State.cache.get(ref)
        return v[1] if v else None


class H(BaseHTTPRequestHandler):
    server_version = "NovaAge/1"
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):               # no default access log (it would include nothing sensitive, but keep it quiet)
        pass

    def _send(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?")[0] == "/health":
            return self._send(200, {"ok": True, "estimator": State.est.name if State.est else None, "ready": State.ready})
        self._send(404, {"error": "not_found"})

    def do_POST(self):
        if self.path.split("?")[0] not in ("/verify", "/"):
            return self._send(404, {"error": "not_found"})
        # 0. always consume the request body first, so an early error can never leave bytes on a keep-alive connection
        try:
            n = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            n = 0
        if n <= 0 or n > MAX_BODY:
            self.close_connection = True
            return self._send(413, {"error": "bad_size"})
        raw_body = self.rfile.read(n)
        # 1. shared-secret auth (the ngrok URL is public, so this is what keeps strangers out)
        got = self.headers.get("Authorization", "")
        want = "Bearer " + SECRET
        if not SECRET or not hmac.compare_digest(got.encode(), want.encode()):
            return self._send(401, {"error": "unauthorized"})
        if not rate_ok():
            return self._send(429, {"error": "rate_limited"})
        if not State.ready:
            return self._send(503, {"error": "warming_up"})
        # 2. validate body
        try:
            body = json.loads(raw_body)
            ref, ts, min_age, b64 = body["ref"], int(body["ts"]), int(body.get("minAge", 18)), body["image"]
            assert isinstance(ref, str) and re.fullmatch(r"[\w\-]{8,128}", ref)
            assert isinstance(b64, str) and 100 < len(b64) <= MAX_IMAGE_B64
            assert 13 <= min_age <= 25
        except Exception:
            return self._send(400, {"error": "bad_request"})
        if abs(time.time() - ts) > TS_SKEW:
            return self._send(400, {"error": "stale_timestamp"})
        # 3. verdict (cached per ref so a retried request never re-processes the face)
        result = cached(ref)
        if result is None:
            try:
                raw = base64.b64decode(b64, validate=True)
                assert raw[:2] == b"\xff\xd8"          # JPEG magic
            except (binascii.Error, AssertionError, ValueError):
                return self._send(400, {"error": "bad_image"})
            ages = None
            try:
                with State.lock:
                    ages = State.est.estimate(raw)
                result = decide(ages, min_age)
            except est.NoFace:
                result = "uncertain"
            except Exception as e:                       # model crashed: say so, never guess "adult"
                print(f"[age-provider] estimator error: {type(e).__name__}: {e}", file=sys.stderr)
                return self._send(500, {"error": "estimator_failed"})
            raw = None
            with State.cl:
                State.cache[ref] = (time.time() + CACHE_TTL, result)
            shown = "n/a" if ages is None else ",".join(f"{a:.0f}" for a in ages)
            print(f"[age-provider] ref={ref[:8]}… est_age={shown} -> {result}")
        out_ts = int(time.time())
        self._send(200, {"ref": ref, "ts": out_ts, "result": result, "signature": sign(SECRET, ref, result, out_ts)})


def main():
    if len(SECRET) < 24:
        raise SystemExit("AGE_PROVIDER_SECRET is missing or too short (use 24+ random characters). Copy .env.example to .env first.")
    State.est = est.make()
    host, port = os.environ.get("HOST", "127.0.0.1"), int(os.environ.get("PORT", "8080"))
    srv = ThreadingHTTPServer((host, port), H)
    print(f"[age-provider] estimator={State.est.name}  listening on http://{host}:{port}  (loading model, please wait…)")

    def warm():
        try:
            State.est.warmup()
            State.ready = True
            print("[age-provider] READY — model loaded. Now start ngrok:  ngrok http %d" % port)
        except Exception as e:
            print(f"[age-provider] model failed to load: {type(e).__name__}: {e}", file=sys.stderr)
            os._exit(1)
    threading.Thread(target=warm, daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
