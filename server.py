"""Local static server with a secure Gemini bridge for Reviewed question checks."""
from __future__ import annotations

import json
import os
import re
import base64
import urllib.error
import urllib.parse
import urllib.request
from html import unescape
from html.parser import HTMLParser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env", override=False)
HOST = "127.0.0.1"
PORT = 8000
MAX_DAILY_AI_REVIEWS = 20
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")


def review_prompt(payload):
    question = str(payload.get("question") or "")
    options = payload.get("options") or []
    official_answer = str(payload.get("officialAnswer") or "")
    option_lines = "\n".join(f"{chr(65 + index)}. {str(option)}" for index, option in enumerate(options)) or "Not provided"
    return f"""Review only this multiple-choice question.

Determine whether the existing official answer appears correct. Do not change it. Return only a concise review with:
1. A first line that says either \"Official answer appears correct\" or \"Official answer may be questionable\".
2. A short explanation of 2-4 sentences.
If the question or answer is ambiguous, say so clearly rather than inventing certainty.

Question:
{question}

Options:
{option_lines}

Existing official answer:
{official_answer or 'Not provided'}"""


def call_gemini(payload):
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured on the local backend.")
    model = os.environ.get("GEMINI_MODEL", GEMINI_MODEL)
    query = urllib.parse.urlencode({"key": api_key})
    url = f"https://generativelanguage.googleapis.com/v1/models/{urllib.parse.quote(model, safe='')}:generateContent?{query}"
    request_body = {
        "contents": [{"parts": [{"text": review_prompt(payload)}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 300}
    }
    request = urllib.request.Request(url, data=json.dumps(request_body).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code == 400:
            print("Gemini API error: HTTP 400 - invalid request or model", flush=True)
        elif error.code == 401 or error.code == 403:
            print(f"Gemini API error: HTTP {error.code} - authentication failed or access denied", flush=True)
        elif error.code == 429:
            print("Gemini API error: HTTP 429 - quota/rate limit", flush=True)
        else:
            print(f"Gemini API error: HTTP {error.code} - upstream request failed", flush=True)
        if error.code == 429:
            raise RuntimeError("Gemini quota or rate limit reached. Please try again later.") from error
        if error.code == 400:
            raise RuntimeError("Gemini API rejected the request or model. Please check the configured model.") from error
        if error.code == 401 or error.code == 403:
            raise RuntimeError("Gemini authentication failed. Please check the API key permissions.") from error
        raise RuntimeError("Gemini review is temporarily unavailable.") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise RuntimeError("Gemini review could not connect. Please try again later.") from error
    parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    text = " ".join(str(part.get("text") or "") for part in parts).strip()
    if not text:
        raise RuntimeError("Gemini returned no review.")
    return text


class DuckDuckGoResultParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.results = []
        self.current = None
        self.capture = None
        self.capture_tag = None

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        classes = set((attributes.get("class") or "").split())
        if tag == "a" and ("result__a" in classes or "result-link" in classes):
            self.current = {"title": "", "url": attributes.get("href") or "", "snippet": ""}
            self.capture = "title"
        elif self.current and ("result__snippet" in classes or "result-snippet" in classes):
            self.capture = "snippet"
            self.capture_tag = tag

    def handle_data(self, data):
        if self.current and self.capture:
            self.current[self.capture] += data

    def handle_endtag(self, tag):
        if self.current and tag == "a" and self.capture == "title":
            self.capture = None
        elif self.current and self.capture == "snippet" and tag == self.capture_tag:
            self.current["title"] = " ".join(self.current["title"].split())
            self.current["snippet"] = " ".join(self.current["snippet"].split())
            if self.current["title"] and self.current["url"]:
                self.results.append(self.current)
            self.current = None
            self.capture = None
            self.capture_tag = None


class BingResultParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.results = []
        self.current = None
        self.capture = None

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        classes = set((attributes.get("class") or "").split())
        if tag == "li" and "b_algo" in classes:
            self.current = {"title": "", "url": "", "snippet": ""}
        elif self.current and tag == "a" and not self.current["url"] and self.capture is None:
            self.current["url"] = attributes.get("href") or ""
            self.capture = "title"
        elif self.current and tag in {"p", "div"} and self.capture is None:
            self.capture = "snippet"

    def handle_data(self, data):
        if self.current and self.capture:
            self.current[self.capture] += data

    def handle_endtag(self, tag):
        if not self.current:
            return
        if tag == "a" and self.capture == "title":
            self.capture = None
        elif tag == "p" and self.capture == "snippet":
            self.current["title"] = " ".join(self.current["title"].split())
            self.current["snippet"] = " ".join(self.current["snippet"].split())
            if self.current["title"] and self.current["url"]:
                self.results.append(self.current)
            self.current = None
            self.capture = None


class ReadablePageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip_depth = 0
        self.skip_tags = {"script", "style", "noscript", "nav", "footer", "header", "aside", "form"}
        self.block_tags = {"p", "li", "article", "section", "h1", "h2", "h3", "h4", "blockquote"}

    def handle_starttag(self, tag, attrs):
        if tag in self.skip_tags:
            self.skip_depth += 1

    def handle_endtag(self, tag):
        if tag in self.skip_tags and self.skip_depth:
            self.skip_depth -= 1

    def handle_data(self, data):
        if not self.skip_depth:
            text = re.sub(r"\s+", " ", data).strip()
            if text:
                self.parts.append(text)


def extract_readable_page(raw):
    parser = ReadablePageParser()
    parser.feed(raw.decode("utf-8", errors="replace"))
    text = " ".join(parser.parts)
    return re.sub(r"\s+", " ", text).strip()


def parse_bing_results(raw):
    results = []
    for block in re.findall(r"<li\b[^>]*class=[\"'][^\"']*\bb_algo\b[^\"']*[\"'][^>]*>(.*?)</li>", raw, re.I | re.S):
        title_match = re.search(r"<h2\b[^>]*>\s*<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", block, re.I | re.S)
        snippet_match = re.search(r"<p\b[^>]*>(.*?)</p>", block, re.I | re.S)
        if not title_match:
            continue
        clean = lambda value: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", unescape(value))).strip()
        results.append({"title": clean(title_match.group(2)), "url": unescape(title_match.group(1)), "snippet": clean(snippet_match.group(1)) if snippet_match else ""})
    return results


def clean_result_url(value):
    link = unescape(value or "")
    parsed = urllib.parse.urlparse(link)
    if parsed.path in {"/ck/a", "/l/"}:
        params = urllib.parse.parse_qs(parsed.query)
        encoded = params.get("u", params.get("uddg", [""]))[0]
        if encoded:
            if encoded.startswith("a1"):
                try:
                    encoded = base64.urlsafe_b64decode(encoded[2:] + "===").decode("utf-8", errors="ignore")
                except (ValueError, UnicodeError):
                    pass
            link = urllib.parse.unquote(encoded)
    return link


def online_search(query):
    providers = [
        ("https://lite.duckduckgo.com/lite/?", DuckDuckGoResultParser),
        ("https://www.bing.com/search?", None)
    ]
    last_error = None
    for base_url, parser_type in providers:
        url = base_url + urllib.parse.urlencode({"q": query})
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (QuizPortal local educational search)"})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                raw = response.read().decode("utf-8", errors="replace")
                if parser_type is None:
                    results = parse_bing_results(raw)
                else:
                    parser = parser_type()
                    parser.feed(raw)
                    results = parser.results
                if results:
                    for item in results:
                        item["url"] = clean_result_url(item.get("url"))
                    return results
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
    if last_error:
        raise last_error
    return []


def fetch_source_page(url):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (QuizPortal local educational reader)"})
    with urllib.request.urlopen(request, timeout=20) as response:
        content_type = response.headers.get_content_type()
        if content_type not in {"text/html", "application/xhtml+xml"}:
            return ""
        return extract_readable_page(response.read(2_000_000))


def source_based_explanation(question, candidates):
    relevant_terms = [term.lower() for term in tokens_for_search(question) if len(term) >= 5]
    pages = []
    for candidate in candidates[:3]:
        evidence = ""
        try:
            page_text = fetch_source_page(candidate["url"])
        except (urllib.error.URLError, TimeoutError, UnicodeError):
            page_text = ""
        evidence = page_text or " ".join(part for part in (candidate.get("title"), candidate.get("snippet")) if part).strip()
        if not evidence:
            continue
        sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", evidence) if len(part.strip()) >= 24]
        scored_sentences = []
        for sentence in sentences:
            lower = sentence.lower().replace("paleolithic", "palaeolithic")
            matches = sum(1 for term in relevant_terms if term in lower)
            if matches >= 2 or (matches >= 1 and any(anchor in lower for anchor in relevant_terms)):
                scored_sentences.append((matches, sentence))
        if scored_sentences:
            scored_sentences.sort(key=lambda item: item[0], reverse=True)
            pages.append({"candidate": candidate, "sentences": [sentence for _, sentence in scored_sentences[:5]], "evidence": evidence})
    points = []
    seen = set()
    for page in pages:
        for sentence in page["sentences"]:
            key = normalize_sentence(sentence)
            if key not in seen:
                seen.add(key)
                points.append(sentence)
            if len(points) >= 8:
                break
        if len(points) >= 8:
            break
    if not points:
        return {"explanation": [], "sources": []}
    return {
        "explanation": points[:8],
        "sources": [{"title": page["candidate"]["title"], "site": page["candidate"]["site"], "url": page["candidate"]["url"], "snippet": page["candidate"].get("snippet", "")} for page in pages]
    }


def normalize_sentence(value):
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def online_explanation_search(payload):
    question = str(payload.get("question") or "").strip()
    options = [str(option) for option in payload.get("options") or []]
    if not question:
        raise ValueError("A question is required.")
    generic = {"what", "which", "where", "when", "who", "following", "answer", "question", "india", "first", "was", "were", "is", "are", "the", "this", "that", "tool", "period", "age", "discovered", "discovery"}
    option_text = " ".join(options)
    official_answer = str(payload.get("officialAnswer") or "")
    words = re.findall(r"[A-Za-z][A-Za-z'-]+", question)
    proper_phrases = re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b", question)
    entity = max(proper_phrases, key=len, default="")
    entity_words = {word.lower() for word in entity.split()}
    additional_words = re.findall(r"[A-Za-z][A-Za-z'-]+", f"{option_text} {official_answer}")
    distinctive_words = list(dict.fromkeys(word for word in words + additional_words if len(word) >= 5 and word.lower() not in generic and word.lower() not in entity_words))
    topic_phrase = distinctive_words[0] if distinctive_words else ""
    country = "india" if re.search(r"\bindia\b", question, re.I) else ""
    entity_query = f'"{entity}"' if entity else ""
    entity_anchor = max(entity_words, key=len, default="")
    queries = [
        " ".join(part for part in (entity_query, f'"{topic_phrase}"' if topic_phrase else "", country) if part),
        " ".join(part for part in (entity_query, '"first Palaeolithic tool"' if "palaeolithic" in question.lower() or "paleolithic" in question.lower() else f'"{topic_phrase}"', country) if part),
        " ".join(part for part in (entity_query, topic_phrase, "discovery", country) if part)
    ]
    queries = [query for query in queries if query]
    results = []
    seen = set()
    for query in queries[:3]:
        try:
            found = online_search(query)
        except (urllib.error.URLError, TimeoutError) as error:
            if not results:
                raise RuntimeError("Online search is temporarily unavailable.") from error
            continue
        for item in found:
            link = clean_result_url(item["url"])
            if link in seen:
                continue
            seen.add(link)
            host = urllib.parse.urlparse(link).netloc.lower()
            searchable = f"{item['title']} {item['snippet']} {host}".lower().replace("paleolithic", "palaeolithic")
            entity_match = bool(entity and " ".join(entity.lower().split()) in " ".join(searchable.split()))
            matched_terms = [term for term in distinctive_words if term.lower() in searchable]
            topic_match = "palaeolithic" in searchable if "palaeolithic" in question.lower() or "paleolithic" in question.lower() else False
            if entity and not entity_match and not (entity_anchor and entity_anchor in searchable and topic_match):
                continue
            if not entity and len(matched_terms) < 2 and not any(len(term) >= 8 for term in matched_terms):
                continue
            authority = 0
            if host.endswith(".gov") or ".gov." in host:
                authority = 30
            elif host.endswith(".edu") or ".ac." in host:
                authority = 25
            elif any(domain in host for domain in ("britannica.com", "wikipedia.org", "ncert.nic.in")):
                authority = 20
            item["score"] = authority + (70 if entity_match else 0) + (35 if topic_match else 0) + len(matched_terms) * 12
            if entity_match and " ".join(entity.lower().split()) in " ".join(item["title"].lower().split()):
                item["score"] += 30
            if any(term in searchable for term in ("discovered", "discovery", "archaeolog")):
                item["score"] += 8
            item["site"] = host
            item["url"] = link
            results.append(item)
    ranked = sorted(results, key=lambda item: item["score"], reverse=True)[:3]
    return source_based_explanation(question, ranked)


def tokens_for_search(value):
    return [token for token in re.sub(r"[^a-z0-9]+", " ", value.lower()).split() if len(token) > 3 and token not in {"what", "which", "where", "when", "following", "answer", "question", "india"}]


class Handler(BaseHTTPRequestHandler):
    server_version = "QuizPortalReviewServer/1.0"

    def send_json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        if urllib.parse.urlparse(self.path).path not in {"/api/review-question", "/api/online-explanation"}:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        print(f"Source request received: {self.command} {path}", flush=True)
        if path not in {"/api/review-question", "/api/online-explanation"}:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 100_000:
                raise ValueError("Review request is too large.")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload.get("question"), str) or not payload["question"].strip():
                raise ValueError("A question is required.")
            if not isinstance(payload.get("options", []), list):
                raise ValueError("Options must be an array.")
            allowed = {"question", "options", "officialAnswer"}
            payload = {key: payload.get(key) for key in allowed}
            if path == "/api/online-explanation":
                self.send_json(HTTPStatus.OK, {"results": online_explanation_search(payload)})
            else:
                self.send_json(HTTPStatus.OK, {"review": call_gemini(payload)})
        except json.JSONDecodeError:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid review request."})
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except RuntimeError as error:
            message = str(error)
            status = HTTPStatus.TOO_MANY_REQUESTS if "quota" in message.lower() or "rate limit" in message.lower() else HTTPStatus.SERVICE_UNAVAILABLE
            self.send_json(status, {"error": message})
        except Exception:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "The local Gemini bridge could not process this request."})

    def do_GET(self):
        if urllib.parse.urlparse(self.path).path == "/api/health":
            self.send_json(HTTPStatus.OK, {"ok": True, "geminiConfigured": bool(os.environ.get("GEMINI_API_KEY", "").strip())})
            return
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path.lstrip("/"))
        if not path:
            path = "index.html"
        file_path = (ROOT / path).resolve()
        if not str(file_path).startswith(str(ROOT)) or not file_path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        data = file_path.read_bytes()
        content_type = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8"}.get(file_path.suffix.lower(), "application/octet-stream")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format_string, *args):
        print(f"[{self.log_date_time_string}] {format_string % args}")


if __name__ == "__main__":
    if not os.environ.get("GEMINI_API_KEY"):
        print("Warning: Gemini configuration is not detected; review requests will return a helpful error.")
    else:
        print("Gemini configuration detected.")
    print(f"Quiz Portal running at http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
