"""Local static server with a secure Gemini bridge for Reviewed question checks."""
from __future__ import annotations

import json
import os
import re
import base64
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
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
SEARCH_DIAGNOSTICS = {}
SEARCH_TIMEOUT_SECONDS = 5
OPERATION_TIMEOUT_SECONDS = 20
MAX_DAILY_AI_REVIEWS = 20
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")
EDITABLE_REVIEW_FIELDS = {"explanation", "answer"}


def load_subject_manifest():
    try:
        manifest = json.loads((ROOT / "data" / "subjects.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise ValueError("Quiz subject manifest is unavailable.")
    subjects = {str(item.get("id")): item.get("file") for item in manifest.get("subjects", []) if isinstance(item, dict)}
    return {key: value for key, value in subjects.items() if key and isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]+\.json", value)}


def question_id(question):
    for key in ("id", "qid", "questionId", "_id", "questionID", "question_id"):
        if key in question and question[key] is not None:
            return str(question[key])
    return None


def find_question(data, chapter, stable_id, question_index):
    containers = []
    if chapter:
        for key in ("chapters", "TEST NUMBER"):
            groups = data.get(key) if isinstance(data, dict) else None
            if isinstance(groups, dict) and isinstance(groups.get(chapter), list):
                containers.append(groups[chapter])
    if not containers:
        def collect(value):
            if isinstance(value, dict):
                for child in value.values():
                    collect(child)
            elif isinstance(value, list) and all(isinstance(item, dict) for item in value):
                containers.append(value)
        collect(data)

    for questions in containers:
        if stable_id is not None:
            for question in questions:
                if question_id(question) == str(stable_id):
                    return question
        elif isinstance(question_index, int) and 0 <= question_index < len(questions):
            question = questions[question_index]
            if question_id(question) is None:
                return question
    raise ValueError("The original question could not be found.")


def locate_review_question(payload):
    subject_key = str(payload.get("sourceSubjectKey") or "")
    files = load_subject_manifest()
    file_name = files.get(subject_key)
    if not file_name:
        raise ValueError("The question source is not an approved quiz file.")
    file_path = (ROOT / "data" / file_name).resolve()
    if file_path.parent != (ROOT / "data").resolve() or not file_path.is_file():
        raise ValueError("The question source is invalid.")
    try:
        data = json.loads(file_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise ValueError("The question source is not valid JSON.")
    question = find_question(data, payload.get("chapter"), payload.get("questionId"), payload.get("questionIndex"))
    return file_path, data, question


def question_response(question):
    return {"question": question}


def save_review_question(payload):
    field = payload.get("field")
    if field not in EDITABLE_REVIEW_FIELDS:
        raise ValueError("Only explanation and answer can be edited.")
    question_id_value = payload.get("questionId")
    question_index = payload.get("questionIndex")
    if question_id_value is None and not isinstance(question_index, int):
        raise ValueError("A stable question ID or source question index is required.")
    file_path, data, question = locate_review_question(payload)
    if field == "explanation":
        if not isinstance(payload.get("value"), str):
            raise ValueError("Explanation must be text.")
        question[field] = payload["value"]
    else:
        value = payload.get("value")
        if not isinstance(value, int) or isinstance(value, bool) or value < 0 or value >= len(question.get("options", [])):
            raise ValueError("Correct answer must be a valid option index.")
        question[field] = value
    temporary_path = file_path.with_suffix(file_path.suffix + ".tmp")
    try:
        temporary_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary_path.replace(file_path)
    except OSError:
        try:
            temporary_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise ValueError("The quiz data could not be saved.")
    return question_response(question)




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


def clean_markup(value):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", unescape(value or ""))).strip()


def parse_duckduckgo_lite(raw):
    results = []
    pattern = re.compile(r"<a\b[^>]*class=[\"'][^\"']*result-link[^\"']*[\"'][^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>(.*?)(?:class=[\"'][^\"']*result-snippet[^\"']*[\"'][^>]*>(.*?)</td>|$)", re.I | re.S)
    for match in pattern.finditer(raw):
        title = clean_markup(match.group(2))
        snippet = clean_markup(match.group(4) or "")
        if title and (match.group(1) or snippet):
            results.append({"title": title, "url": unescape(match.group(1)), "snippet": snippet})
    return results


def parse_duckduckgo_html(raw):
    results = []
    links = re.findall(r"<a\b[^>]*class=[\"'][^\"']*result__a[^\"']*[\"'][^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", raw, re.I | re.S)
    snippets = re.findall(r"class=[\"'][^\"']*result__snippet[^\"']*[\"'][^>]*>(.*?)</", raw, re.I | re.S)
    for index, (url, title) in enumerate(links):
        results.append({"title": clean_markup(title), "url": unescape(url), "snippet": clean_markup(snippets[index]) if index < len(snippets) else ""})
    return [item for item in results if item["title"] or item["url"]]


def parse_wikipedia_results(raw):
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return [{"title": item.get("title", ""), "url": f"https://en.wikipedia.org/wiki/{urllib.parse.quote(item.get('title', '').replace(' ', '_'))}", "snippet": re.sub(r"<[^>]+>", "", unescape(item.get("snippet", "")))} for item in data.get("query", {}).get("search", []) if item.get("title")]


def parse_bing_results(raw):
    results = []
    blocks = re.findall(r"<li\b[^>]*class=[\"'][^\"']*\bb_algo\b[^\"']*[\"'][^>]*>(.*?)(?=<li\b[^>]*class=[\"'][^\"']*\bb_algo\b|</ol>)", raw, re.I | re.S)
    for block in blocks:
        title_match = re.search(r"<h2\b[^>]*>.*?<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", block, re.I | re.S)
        if not title_match:
            title_match = re.search(r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", block, re.I | re.S)
        snippet_match = re.search(r"<p\b[^>]*>(.*?)</p>", block, re.I | re.S)
        if title_match:
            results.append({"title": clean_markup(title_match.group(2)), "url": unescape(title_match.group(1)), "snippet": clean_markup(snippet_match.group(1) if snippet_match else "")})
    return results


def parse_bing_rss(raw):
    results = []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return results
    for item in root.findall(".//item"):
        title = (item.findtext("title") or "").strip()
        url = (item.findtext("link") or "").strip()
        snippet = (item.findtext("description") or "").strip()
        if title or url or snippet:
            results.append({"title": clean_markup(title), "url": url, "snippet": clean_markup(snippet)})
    return results


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
    global SEARCH_DIAGNOSTICS
    providers = [
        ("duckduckgo_lite", "https://lite.duckduckgo.com/lite/?", parse_duckduckgo_lite),
        ("bing_html", "https://www.bing.com/search?", parse_bing_results),
        ("duckduckgo_html", "https://html.duckduckgo.com/html/?", parse_duckduckgo_html),
        ("wikipedia_api", "https://en.wikipedia.org/w/api.php?", parse_wikipedia_results)
    ]
    last_error = None
    combined = []
    seen_urls = set()
    deadline = SEARCH_DIAGNOSTICS.get("deadline", time.monotonic() + OPERATION_TIMEOUT_SECONDS)
    query_terms = [term for term in re.sub(r"[^a-z0-9]+", " ", query.lower()).split() if len(term) >= 5 and term not in {"which", "where", "when", "following", "answer", "question", "india", "first", "discovery"}]
    for provider_name, base_url, parser_type in providers:
        SEARCH_DIAGNOSTICS["providers_attempted"] += 1
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        parameters = {"q": query}
        if provider_name == "wikipedia_api":
            parameters = {"action": "query", "list": "search", "srsearch": query, "format": "json", "utf8": "1", "srlimit": "10"}
        url = base_url + urllib.parse.urlencode(parameters)
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (QuizPortal local educational search)"})
        try:
            with urllib.request.urlopen(request, timeout=min(SEARCH_TIMEOUT_SECONDS, remaining)) as response:
                raw = response.read().decode("utf-8", errors="replace")
                results = parser_type(raw)
                SEARCH_DIAGNOSTICS["raw_results"] += len(results)
                print(f"provider={provider_name} http_status={response.status} parsed_results={len(results)}", flush=True)
                if provider_name == "bing_html" and results:
                    rss_url = "https://www.bing.com/search?" + urllib.parse.urlencode({"format": "rss", "q": query})
                    rss_request = urllib.request.Request(rss_url, headers={"User-Agent": "Mozilla/5.0 (QuizPortal local educational search)"})
                    try:
                        with urllib.request.urlopen(rss_request, timeout=min(SEARCH_TIMEOUT_SECONDS, max(0.1, deadline - time.monotonic()))) as rss_response:
                            rss_results = parse_bing_rss(rss_response.read().decode("utf-8", errors="replace"))
                            print(f"provider=bing_rss http_status={rss_response.status} parsed_results={len(rss_results)}", flush=True)
                            if rss_results:
                                results = rss_results
                    except (urllib.error.URLError, TimeoutError):
                        print("provider=bing_rss http_status=error parsed_results=0", flush=True)
                for item in results:
                    item["url"] = clean_result_url(item.get("url"))
                    if item["url"] and item["url"] not in seen_urls:
                        seen_urls.add(item["url"])
                        item["site"] = urllib.parse.urlparse(item["url"]).netloc.lower()
                        combined.append(item)
                meaningful = any(sum(term in f"{item.get('title', '')} {item.get('snippet', '')}".lower() for term in query_terms) >= 2 for item in results)
                if meaningful:
                    return combined[:10]
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            print(f"provider={provider_name} http_status=error parsed_results=0", flush=True)
            last_error = error
    if last_error:
        if not combined:
            raise last_error
    return combined[:10]


def fetch_source_page(url):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (QuizPortal local educational reader)"})
    remaining = SEARCH_DIAGNOSTICS.get("deadline", time.monotonic() + OPERATION_TIMEOUT_SECONDS) - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("source page fetch deadline exceeded")
    with urllib.request.urlopen(request, timeout=min(SEARCH_TIMEOUT_SECONDS, remaining)) as response:
        content_type = response.headers.get_content_type()
        if content_type not in {"text/html", "application/xhtml+xml"}:
            return ""
        return extract_readable_page(response.read(2_000_000))


def source_based_explanation(question, candidates):
    relevant_terms = [term.lower() for term in tokens_for_search(question) if len(term) >= 5]
    pages = []
    page_fetch_successes = 0
    snippet_fallbacks = 0
    for candidate in candidates[:3]:
        evidence = ""
        used_snippet_fallback = False
        try:
            page_text = fetch_source_page(candidate["url"])
        except (urllib.error.URLError, TimeoutError, UnicodeError, OSError) as error:
            page_text = ""
            if isinstance(error, TimeoutError):
                SEARCH_DIAGNOSTICS["page_timeout_count"] += 1
        if page_text:
            page_fetch_successes += 1
            evidence = page_text
        else:
            snippet_fallbacks += 1
            used_snippet_fallback = True
            evidence = " ".join(part for part in (candidate.get("title"), candidate.get("snippet")) if part).strip()
        if not evidence:
            continue
        sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", evidence) if len(part.strip()) >= 24]
        scored_sentences = []
        for sentence in sentences:
            lower = sentence.lower().replace("paleolithic", "palaeolithic")
            matches = sum(1 for term in relevant_terms if term in lower)
            if matches >= 2 or (matches >= 1 and any(anchor in lower for anchor in relevant_terms)):
                scored_sentences.append((matches, sentence))
        if not scored_sentences and not used_snippet_fallback:
            snippet_fallbacks += 1
            used_snippet_fallback = True
            evidence = " ".join(part for part in (candidate.get("title"), candidate.get("snippet")) if part).strip()
            sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", evidence) if len(part.strip()) >= 24]
            for sentence in sentences:
                lower = sentence.lower().replace("paleolithic", "palaeolithic")
                matches = sum(1 for term in relevant_terms if term in lower)
                if matches >= 1:
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
        return {"explanation": [], "sources": [], "page_fetch_successes": page_fetch_successes, "snippet_fallbacks": snippet_fallbacks}
    explanation_document = {
        "type": "document",
        "blocks": [
            {"type": "heading", "level": 3, "content": "Online explanation"},
            *[{"type": "paragraph", "content": sentence} for sentence in points[:8]]
        ]
    }
    return {
        "explanation": points[:8],
        "explanationDocument": explanation_document,
        "sources": [{"title": page["candidate"]["title"], "site": page["candidate"]["site"], "url": page["candidate"]["url"], "snippet": page["candidate"].get("snippet", "")} for page in pages],
        "page_fetch_successes": page_fetch_successes,
        "snippet_fallbacks": snippet_fallbacks
    }


def normalize_sentence(value):
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def online_explanation_search(payload):
    global SEARCH_DIAGNOSTICS
    started_at = time.monotonic()
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
    SEARCH_DIAGNOSTICS = {"queries_attempted": 0, "providers_attempted": 0, "raw_results": 0, "deadline": time.monotonic() + OPERATION_TIMEOUT_SECONDS, "provider_timeout_count": 0, "page_timeout_count": 0}
    results = []
    seen = set()
    for query in queries[:3]:
        SEARCH_DIAGNOSTICS["queries_attempted"] += 1
        try:
            found = online_search(query)
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            if isinstance(error, TimeoutError):
                SEARCH_DIAGNOSTICS["provider_timeout_count"] += 1
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
            if not entity and not matched_terms:
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
    evidence_context = " ".join([question, *options, official_answer]).strip()
    explanation = source_based_explanation(evidence_context, ranked)
    explanation["diagnostics"] = {
        **SEARCH_DIAGNOSTICS,
        "relevant_results": len(ranked),
        "page_fetch_successes": explanation.get("page_fetch_successes", 0),
        "snippet_fallbacks": explanation.get("snippet_fallbacks", 0),
        "explanation_points": len(explanation.get("explanation", [])),
        "final_explanation_count": len(explanation.get("explanation", [])),
        "final_source_count": len(explanation.get("sources", [])),
        "final_empty_reason": "no relevant evidence after provider, relevance, page, and snippet evaluation" if not explanation.get("explanation") else "",
        "elapsed_ms": round((time.monotonic() - started_at) * 1000)
    }
    return explanation


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
            if path == "/api/review-question":
                self.send_json(HTTPStatus.OK, save_review_question(payload))
                return
            if not isinstance(payload.get("question"), str) or not payload["question"].strip():
                raise ValueError("A question is required.")
            if not isinstance(payload.get("options", []), list):
                raise ValueError("Options must be an array.")
            allowed = {"question", "options", "officialAnswer"}
            payload = {key: payload.get(key) for key in allowed}
            if path == "/api/online-explanation":
                self.send_json(HTTPStatus.OK, online_explanation_search(payload))
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
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/health":
            self.send_json(HTTPStatus.OK, {"ok": True, "geminiConfigured": bool(os.environ.get("GEMINI_API_KEY", "").strip())})
            return
        if parsed.path == "/api/review-question":
            try:
                query = urllib.parse.parse_qs(parsed.query)
                payload = {
                    "sourceSubjectKey": query.get("sourceSubjectKey", [""])[0],
                    "chapter": query.get("chapter", [""])[0],
                    "questionId": query.get("questionId", [None])[0],
                    "questionIndex": int(query["questionIndex"][0]) if "questionIndex" in query else None
                }
                _, _, question = locate_review_question(payload)
                self.send_json(HTTPStatus.OK, question_response(question))
            except (TypeError, ValueError) as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
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
