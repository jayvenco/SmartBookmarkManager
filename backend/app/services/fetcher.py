"""Fetch page metadata (title, description, image, favicon) with SSRF protection.

Connections are pinned to an address that was checked to be public, so a DNS answer
cannot change between the check and the connect. Private ranges can be allowed for a
homelab with SBM_FETCH_ALLOW_PRIVATE=1.
"""

import http.client
import ipaddress
import os
import re
import socket
import ssl
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

MAX_BYTES = 512 * 1024
TIMEOUT = 8
MAX_REDIRECTS = 4
USER_AGENT = "Mozilla/5.0 (compatible; SmartBookmarkManager/0.2; +self-hosted)"


class FetchError(Exception):
    pass


def _allow_private() -> bool:
    return os.environ.get("SBM_FETCH_ALLOW_PRIVATE") == "1"


def is_public_ip(value: str) -> bool:
    ip = ipaddress.ip_address(value.split("%")[0])
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global


def resolve_checked(host: str, port: int) -> tuple:
    """Resolve `host` and return a socket address that is allowed to be contacted."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise FetchError("host_not_found") from e
    for _family, _type, _proto, _canon, sockaddr in infos:
        if not _allow_private() and not is_public_ip(sockaddr[0]):
            raise FetchError("blocked_address")
    if not infos:
        raise FetchError("host_not_found")
    return infos[0][4]


class _PinnedHTTP(http.client.HTTPConnection):
    def connect(self):
        addr = resolve_checked(self.host, self.port)
        self.sock = socket.create_connection(addr[:2], self.timeout)


class _PinnedHTTPS(http.client.HTTPSConnection):
    def connect(self):
        addr = resolve_checked(self.host, self.port)
        sock = socket.create_connection(addr[:2], self.timeout)
        self.sock = ssl.create_default_context().wrap_socket(sock, server_hostname=self.host)


class _Meta(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = ""
        self._in_title = False
        self.meta: dict[str, str] = {}
        self.icons: list[tuple[str, str]] = []
        self.done = False

    def handle_starttag(self, tag, attrs):
        a = {k: (v or "") for k, v in attrs}
        if tag == "title" and not self.title:
            self._in_title = True
        elif tag == "meta":
            key = (a.get("property") or a.get("name") or "").lower()
            if key and a.get("content") and key not in self.meta:
                self.meta[key] = a["content"].strip()
        elif tag == "link" and a.get("href"):
            rel = a.get("rel", "").lower()
            if "icon" in rel:
                self.icons.append((rel, a["href"]))

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag == "head":
            self.done = True

    def handle_data(self, data):
        if self._in_title:
            self.title += data


class _Text(HTMLParser):
    """Visible text of a page (scripts, styles and similar are skipped)."""

    SKIP = {"script", "style", "noscript", "svg", "template", "head", "nav", "footer", "form", "iframe"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0
        self._len = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if self._skip or self._len > 60000:
            return
        text = " ".join(data.split())
        if text:
            self.parts.append(text)
            self._len += len(text)


def parse_text(html: str, limit: int = 20000) -> str:
    p = _Text()
    try:
        p.feed(html)
    except Exception:
        pass
    return " ".join(p.parts)[:limit]


def _read_page(url: str) -> tuple[str, str]:
    """Returns (html, final_url). Follows redirects, re-checking every hop."""
    for _ in range(MAX_REDIRECTS + 1):
        u = urlparse(url)
        if u.scheme not in ("http", "https") or not u.hostname:
            raise FetchError("unsupported_url")
        cls = _PinnedHTTPS if u.scheme == "https" else _PinnedHTTP
        conn = cls(u.hostname, u.port or (443 if u.scheme == "https" else 80), timeout=TIMEOUT)
        try:
            path = (u.path or "/") + (f"?{u.query}" if u.query else "")
            conn.request("GET", path, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en,nl;q=0.8"})
            resp = conn.getresponse()
            if resp.status in (301, 302, 303, 307, 308) and resp.getheader("Location"):
                url = urljoin(url, resp.getheader("Location"))
                continue
            if resp.status >= 400:
                raise FetchError(f"http_{resp.status}")
            ctype = resp.getheader("Content-Type", "")
            if "html" not in ctype.lower():
                raise FetchError("not_html")
            raw = resp.read(MAX_BYTES)
            match = re.search(r"charset=([\w-]+)", ctype, re.I) or re.search(rb"<meta[^>]+charset=[\"']?([\w-]+)", raw[:4096], re.I)
            charset = match.group(1) if match and isinstance(match.group(1), str) else (match.group(1).decode("ascii", "ignore") if match else "utf-8")
            try:
                return raw.decode(charset, errors="replace"), url
            except LookupError:
                return raw.decode("utf-8", errors="replace"), url
        except (OSError, http.client.HTTPException) as e:
            raise FetchError("unreachable") from e
        finally:
            conn.close()
    raise FetchError("too_many_redirects")


def _http_url(base: str, value: str) -> str:
    absolute = urljoin(base, value.strip())
    return absolute if urlparse(absolute).scheme in ("http", "https") and len(absolute) <= 4000 else ""


def parse_meta(html: str, base_url: str) -> dict:
    p = _Meta()
    try:
        p.feed(html)
    except Exception:  # malformed markup: use what we have
        pass
    m = p.meta
    title = m.get("og:title") or m.get("twitter:title") or " ".join(p.title.split())
    desc = m.get("og:description") or m.get("description") or m.get("twitter:description") or ""
    image = _http_url(base_url, m.get("og:image") or m.get("twitter:image") or "") if (m.get("og:image") or m.get("twitter:image")) else ""
    favicon = ""
    for rel, href in sorted(p.icons, key=lambda t: "apple" in t[0]):
        favicon = _http_url(base_url, href)
        if favicon:
            break
    if not favicon:
        u = urlparse(base_url)
        favicon = f"{u.scheme}://{u.netloc}/favicon.ico"
    return {"title": title[:300], "description": " ".join(desc.split())[:1000], "image": image, "favicon": favicon}


def fetch_meta(url: str) -> dict:
    """Never raises: returns {"ok": True, ...} or {"ok": False, "error": code}."""
    try:
        html, final = _read_page(url.strip())
        return {"ok": True, "url": final, **parse_meta(html, final)}
    except FetchError as e:
        return {"ok": False, "error": str(e)}


def fetch_page(url: str) -> dict:
    """Like fetch_meta, plus the visible page text (for AI tagging). Never raises."""
    try:
        html, final = _read_page(url.strip())
        return {"ok": True, "url": final, **parse_meta(html, final), "text": parse_text(html)}
    except FetchError as e:
        return {"ok": False, "error": str(e), "text": ""}
