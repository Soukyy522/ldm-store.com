from pathlib import Path
from bs4 import BeautifulSoup
import re, sys

ROOT=Path(__file__).resolve().parents[1]
DEVELOPER={
    "developer-license.html",
    "developer-license-v2.html",
    "developer-incident-support.html",
}
PATTERNS={
    "vendor/backend": re.compile(r"\b(Supabase|Edge Function|SQL(?:-\d+)?|RPC|RLS|IndexedDB|Service Worker|localStorage|schema cache|pg_cron|pg_net|service[_-]?role|JWT|webhook|backend|frontend)\b",re.I),
    "raw-dev-stage": re.compile(r"\b(Tahap\s+\d+[A-Z-]*|fallback|runtime|compatibility|client_transaction_id|Retry requested|REVOKED|Developer Center)\b",re.I),
    "raw-meta-copy": re.compile(r"\b(customer|developer|internal|production|stateless|RAM|hard refresh|troubleshooting)\b",re.I),
}
hits=[]
for path in sorted(ROOT.glob("*.html")):
    if path.name in DEVELOPER:
        continue
    soup=BeautifulSoup(path.read_text(encoding="utf-8",errors="ignore"),"html.parser")
    for tag in soup(["script","style","noscript"]):
        tag.decompose()
    values=list(soup.stripped_strings)
    for tag in soup.find_all(True):
        for attr in ("title","placeholder","aria-label"):
            value=tag.get(attr)
            if value:
                values.append(value)
    for value in values:
        for category,pattern in PATTERNS.items():
            if pattern.search(value):
                hits.append((path.name,category,value))
                break

if hits:
    print("CUSTOMER COPY AUDIT: GAGAL")
    for file,category,value in hits:
        print(f"[{category}] {file}: {value}")
    sys.exit(1)

print("CUSTOMER COPY AUDIT: LULUS")
print("Tidak ditemukan istilah implementasi/meta yang dilarang pada visible customer HTML.")
