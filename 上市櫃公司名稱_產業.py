#!/usr/bin/env python3
"""
Seed stock_symbols from official exchanges using Python:
- TWSE (listed): https://openapi.twse.com.tw/v1/opendata/t187ap03_L
- TPEx (otc):    https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_R

Env vars for DB connection (same as index.js defaults):
DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
"""
import os
import sys
import time
import json
from typing import List, Dict
from pathlib import Path

import requests
import psycopg2
from psycopg2.extras import execute_values

TWSE_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap03_L"
TPEX_URL = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_R"
TWSE_ISIN_URL = "https://isin.twse.com.tw/isin/C_public.jsp?strMode=2"
TPEX_ISIN_URL = "https://isin.twse.com.tw/isin/C_public.jsp?strMode=4"

HEADERS = {
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "User-Agent": "Mozilla/5.0 (compatible; QuantGemsSeeder/1.0)"
}

def derive_short_name(full_name: str) -> str:
    if not full_name:
        return full_name
    s = full_name
    # Remove common company suffixes
    for term in [
        '股份有限公司', '有限公司', '股份有公司', '有限股份公司',
        '股份有限', '公司', '(股)公司', '(股)有限公司'
    ]:
        s = s.replace(term, '')
    s = s.strip(' 、，()（）')
    # If still long, trim to 6 chars as a display alias
    if len(s) > 8:
        s = s[:8]
    return s or full_name


def fetch_json(url: str, retries: int = 1, timeout: int = 15, headers: Dict = None):
    last_err = None
    for attempt in range(retries + 1):
        try:
            h = dict(HEADERS)
            if headers:
                h.update(headers)
            resp = requests.get(url, headers=h, timeout=timeout)
            resp.raise_for_status()
            # 部分端點可能返回 text/csv 或錯誤頁面，先嘗試 json
            return resp.json()
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(0.8)
            else:
                raise last_err


def normalize_twse(rows: List[Dict]) -> List[Dict]:
    out = []
    for r in rows or []:
        code = str(r.get('公司代號', '')).strip()
        name = str(r.get('公司名稱', '')).strip()
        industry = str(r.get('產業別', '') or '').strip() or None
        if len(code) == 4 and code.isdigit() and name:
            out.append({
                'symbol': f"{code}.TW",
                'name': name,
                'short_name': derive_short_name(name),
                'market': 'listed',
                'industry': industry,
            })
    return out

def build_tpex_items_from_isin() -> List[Dict]:
    """Construct TPEx (OTC) items purely from ISIN page (no JSON)."""
    mapping = fetch_isin_otc_map()
    items: List[Dict] = []
    for code, meta in mapping.items():
        short = meta.get('short_name') or ''
        industry_text = meta.get('industry_text') or None
        if len(code) == 4 and code.isdigit() and short:
            items.append({
                'symbol': f"{code}.TWO",
                'name': short,           # ISIN 第一欄的名稱
                'short_name': short,     # 簡稱同名稱
                'market': 'otc',
                'industry': industry_text,
            })
    return items

def pick(d: Dict, keys: List[str]) -> str:
    for k in keys:
        if k in d and d[k] is not None and str(d[k]).strip() != '':
            return str(d[k]).strip()
    return ''

def fallback_fetch_otc_from_isin() -> List[Dict]:
    try:
        resp = requests.get(TWSE_ISIN_URL, headers={
            **HEADERS,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': 'https://isin.twse.com.tw/isin/class_i.jsp?kind=2',
        }, timeout=30)
        # TWSE ISIN often uses Big5 encoding
        resp.encoding = resp.apparent_encoding or 'big5-hkscs'
        html = resp.text
        import re
        # Match table rows whose content includes 市場別為「上櫃」，第一個欄位合併代碼與名稱，如: 8086 宏捷科
        pattern = re.compile(r"<tr[^>]*>.*?<td[^>]*>\s*(\d{4})\s*([^<]+?)\s*</td>.*?上櫃.*?</tr>", re.S)
        items = []
        for m in pattern.finditer(html):
            code = m.group(1).strip()
            name = m.group(2).strip()
            # 清理名稱中的特殊符號與空白
            name = name.replace('\u3000', ' ').strip()
            if len(code) == 4 and code.isdigit() and name:
                items.append({
                    'symbol': f"{code}.TWO",
                    'name': name,
                    'short_name': derive_short_name(name),
                    'market': 'otc',
                    'industry': None,
                })
        return items
    except Exception as e:
        print(f"Warning: ISIN fallback failed: {e}")
        return []


def fetch_isin_listed_map() -> Dict[str, Dict[str, str]]:
    """
    Scrape TWSE ISIN listed page (strMode=2) and build a map:
    code -> { short_name: '台積電', industry_text: '半導體業' }
    Only rows where 市場別 contains '上市' are included.
    """
    try:
        resp = requests.get(
            TWSE_ISIN_URL,
            headers={
                **HEADERS,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Referer': 'https://isin.twse.com.tw/isin/class_i.jsp?kind=2',
            },
            timeout=30,
        )
        # ISIN often uses Big5-related encodings
        resp.encoding = resp.apparent_encoding or 'big5-hkscs'
        html = resp.text
        import re, html as htmllib
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, flags=re.S|re.I)
        result: Dict[str, Dict[str, str]] = {}
        for row in rows:
            # split tds
            cols = re.findall(r"<td[^>]*>(.*?)</td>", row, flags=re.S|re.I)
            if len(cols) < 6:
                continue
            # clean text
            def clean(x: str) -> str:
                x = re.sub(r"<[^>]+>", " ", x)
                x = htmllib.unescape(x)
                x = x.replace('\u3000', ' ').replace('\xa0', ' ')
                return ' '.join(x.split()).strip()

            cols = [clean(c) for c in cols]
            first, _, _, market_text, industry_text, *_ = cols + [None] * 10
            if not market_text or '上市' not in market_text:
                continue
            m = re.match(r"^(\d{4})\s+(.+)$", first)
            if not m:
                continue
            code = m.group(1)
            short_name = m.group(2)
            if not code or not short_name:
                continue
            result[code] = {
                'short_name': short_name,
                'industry_text': industry_text or '',
            }
        return result
    except Exception as e:
        print(f"Warning: ISIN listed scrape failed: {e}")
        return {}


def enrich_twse_with_isin(twse_items: List[Dict]) -> List[Dict]:
    """Use ISIN listed map to fill short_name and industry (text)."""
    mapping = fetch_isin_listed_map()
    if not mapping:
        return twse_items
    for it in twse_items:
        # only listed symbols
        if not it.get('symbol', '').endswith('.TW'):
            continue
        code = it['symbol'][:4]
        if code in mapping:
            m = mapping[code]
            if m.get('short_name'):
                it['short_name'] = m['short_name']
            if m.get('industry_text'):
                it['industry'] = m['industry_text']
    return twse_items

def fetch_isin_otc_map() -> Dict[str, Dict[str, str]]:
    """
    Scrape ISIN page for OTC (strMode=4) and build code -> { short_name, industry_text }
    Only rows where 市場別 contains '上櫃' are included.
    """
    try:
        resp = requests.get(
            TPEX_ISIN_URL,
            headers={
                **HEADERS,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Referer': 'https://isin.twse.com.tw/isin/class_i.jsp?kind=4',
            },
            timeout=30,
        )
        resp.encoding = resp.apparent_encoding or 'big5-hkscs'
        html = resp.text
        import re, html as htmllib
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, flags=re.S|re.I)
        result: Dict[str, Dict[str, str]] = {}
        for row in rows:
            cols = re.findall(r"<td[^>]*>(.*?)</td>", row, flags=re.S|re.I)
            if len(cols) < 6:
                continue
            def clean(x: str) -> str:
                x = re.sub(r"<[^>]+>", " ", x)
                x = htmllib.unescape(x)
                x = x.replace('\u3000', ' ').replace('\xa0', ' ')
                return ' '.join(x.split()).strip()
            cols = [clean(c) for c in cols]
            first, _, _, market_text, industry_text, *_ = cols + [None] * 10
            if not market_text or '上櫃' not in market_text:
                continue
            m = re.match(r"^(\d{4})\s+(.+)$", first)
            if not m:
                continue
            code = m.group(1)
            short_name = m.group(2)
            if not code or not short_name:
                continue
            result[code] = {
                'short_name': short_name,
                'industry_text': industry_text or '',
            }
        return result
    except Exception as e:
        print(f"Warning: ISIN OTC scrape failed: {e}")
        return {}

def enrich_tpex_with_isin(tpex_items: List[Dict]) -> List[Dict]:
    mapping = fetch_isin_otc_map()
    if not mapping:
        return tpex_items
    for it in tpex_items:
        if not it.get('symbol', '').endswith('.TWO'):
            continue
        code = it['symbol'][:4]
        if code in mapping:
            m = mapping[code]
            if m.get('short_name'):
                it['short_name'] = m['short_name']
            if m.get('industry_text'):
                it['industry'] = m['industry_text']
    return tpex_items

def normalize_tpex(rows: List[Dict]) -> List[Dict]:
    out = []
    for r in rows or []:
        # Support both Chinese and English key variants from TPEx
        code = pick(r, ['公司代號', 'CompanyCode', 'SecuritiesCompanyCode'])
        name = pick(r, ['公司名稱', 'CompanyName'])
        abbr = pick(r, ['CompanyAbbreviation', '公司簡稱'])
        industry = pick(r, ['產業別', 'IndustryCategory', 'SecuritiesIndustryCode']) or None
        if len(code) == 4 and code.isdigit() and name:
            out.append({
                'symbol': f"{code}.TWO",
                'name': name,
                'short_name': abbr or derive_short_name(name),
                'market': 'otc',
                'industry': industry,
            })
    return out


def upsert_symbols(conn, items: List[Dict]):
    if not items:
        return 0
    # Detect existing columns to build a compatible UPSERT
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'stock_symbols'
            """
        )
        cols = {row[0] for row in cur.fetchall()}

    base_cols = ['symbol', 'name']
    if 'market' in cols:
        base_cols.append('market')
    if 'industry' in cols:
        base_cols.append('industry')
    if 'short_name' in cols:
        base_cols.append('short_name')

    insert_cols_sql = ", ".join(base_cols)
    placeholders = ", ".join(["%s"] * len(base_cols))

    conflict_set = ["name = EXCLUDED.name"]
    if 'market' in base_cols:
        conflict_set.append('market = EXCLUDED.market')
    if 'industry' in base_cols:
        conflict_set.append('industry = EXCLUDED.industry')
    if 'short_name' in base_cols:
        conflict_set.append('short_name = EXCLUDED.short_name')
    conflict_sql = ", ".join(conflict_set)

    sql = (
        f"INSERT INTO stock_symbols({insert_cols_sql}) "
        f"VALUES %s "
        f"ON CONFLICT (symbol) DO UPDATE SET {conflict_sql}"
    )

    def row_values(it: Dict):
        vals = [it.get('symbol'), it.get('name')]
        if 'market' in base_cols:
            vals.append(it.get('market'))
        if 'industry' in base_cols:
            vals.append(it.get('industry'))
        if 'short_name' in base_cols:
            vals.append(it.get('short_name'))
        return tuple(vals)

    values = [row_values(it) for it in items]
    with conn.cursor() as cur:
        execute_values(cur, sql, values)
    conn.commit()
    return len(items)


def main():
    db_cfg = {
        'host': os.getenv('DB_HOST', 'localhost'),
        'port': int(os.getenv('DB_PORT', '5432')),
        'user': os.getenv('DB_USER', 'postgres'),
        'password': os.getenv('DB_PASSWORD', 's8304021'),
        'dbname': os.getenv('DB_NAME', 'postgres'),
    }

    print('Connecting to DB...')
    conn = psycopg2.connect(**db_cfg)

    try:
        # Ensure table exists with required columns
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS stock_symbols (
                  symbol VARCHAR(20) PRIMARY KEY,
                  name VARCHAR(100) NOT NULL,
                  short_name VARCHAR(100),
                  market VARCHAR(16),
                  industry VARCHAR(64)
                );
                """
            )
            # add missing columns if table pre-existed without them
            cur.execute("ALTER TABLE stock_symbols ADD COLUMN IF NOT EXISTS short_name VARCHAR(100);")
            cur.execute("ALTER TABLE stock_symbols ADD COLUMN IF NOT EXISTS market VARCHAR(16);")
            cur.execute("ALTER TABLE stock_symbols ADD COLUMN IF NOT EXISTS industry VARCHAR(64);")
        conn.commit()

        print('Fetching TWSE list...')
        twse_raw = fetch_json(TWSE_URL, retries=1)
        twse = normalize_twse(twse_raw if isinstance(twse_raw, list) else [])
        # Enrich TWSE with ISIN-based short_name and industry text
        twse = enrich_twse_with_isin(twse)
        print(f'TWSE normalized: {len(twse)} items')

        print('Fetching TPEx list from ISIN...')
        tpex = build_tpex_items_from_isin()
        print(f'TPEx normalized: {len(tpex)} items')

        all_items = twse + tpex
        print(f'Upserting {len(all_items)} items into stock_symbols...')
        n = upsert_symbols(conn, all_items)
        print('Done upserting. Total:', n)

        # Samples
        print('Sample records:', all_items[:5])
    finally:
        conn.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('seed_from_exchanges (python) failed:', e)
        sys.exit(1)
