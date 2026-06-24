#!/usr/bin/env python3
"""
Build a Colorado-cropped SNODAS snapshot for the Colorado Snow app.

SNODAS (NOHRSC National Snow Analysis, NSIDC G02158) is a 1 km gridded daily
snow analysis covering the contiguous US. The full grid is too large to ship to
a browser, and NSIDC sends no CORS headers, so this script (run daily by a GitHub
Action) downloads the latest tarball, extracts snow depth + snow-water-equivalent,
crops to Colorado, and writes small files the static app can fetch same-origin:

    data/snodas-co.json          metadata + georeferencing for the crop
    data/snodas-co-depth.bin.gz  gzipped Int16 little-endian, snow depth (mm)
    data/snodas-co-swe.bin.gz    gzipped Int16 little-endian, snow water equiv (mm)

No third-party dependencies — standard library only.

Usage:
    python3 build_snodas.py                 # fetch latest available day
    python3 build_snodas.py --tar local.tar # build from an already-downloaded tar
    python3 build_snodas.py --date 20260501 # fetch a specific day
"""
import argparse, datetime as dt, gzip, io, json, os, re, sys, tarfile, urllib.request
from array import array

# Colorado bounding box, padded slightly to include border terrain.
CO_W, CO_E = -109.15, -101.90
CO_S, CO_N = 36.80, 41.10

NSIDC = "https://noaadata.apps.nsidc.org/NOAA/G02158/masked"
# product codes inside the SNODAS member filenames
PRODUCTS = {"depth": "11036", "swe": "11034"}
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data")


def fetch_tar(date_str):
    """Download SNODAS_YYYYMMDD.tar bytes for a given day (YYYYMMDD)."""
    d = dt.datetime.strptime(date_str, "%Y%m%d")
    url = f"{NSIDC}/{d:%Y}/{d:%m_%b}/SNODAS_{date_str}.tar"
    sys.stderr.write(f"fetching {url}\n")
    with urllib.request.urlopen(url, timeout=180) as r:
        return r.read()


def latest_tar():
    """Try today back to 5 days ago; return (date_str, tar_bytes) for the newest available."""
    today = dt.date.today()
    for back in range(0, 6):
        ds = (today - dt.timedelta(days=back)).strftime("%Y%m%d")
        try:
            return ds, fetch_tar(ds)
        except Exception as e:  # noqa: BLE001 — keep trying older days
            sys.stderr.write(f"  {ds} not available ({e})\n")
    raise SystemExit("no SNODAS tar available in the last 6 days")


def member(tar, code, suffix):
    """Find the .dat.gz / .txt.gz member for a product code."""
    for m in tar.getmembers():
        if code in m.name and m.name.endswith(suffix):
            return m
    raise KeyError(f"{code}{suffix} not found in tar")


def parse_header(text):
    """Pull grid geometry from a SNODAS .txt header."""
    def num(key):
        m = re.search(rf"{key}:\s*(-?[\d.]+)", text)
        return float(m.group(1)) if m else None
    return {
        "ncols": int(num("Number of columns")),
        "nrows": int(num("Number of rows")),
        "minx": num("Minimum x-axis coordinate"),   # left edge
        "maxy": num("Maximum y-axis coordinate"),   # top edge
        "res": num("X-axis resolution"),
        "nodata": int(num("No data value")),
    }


def read_grid(tar, code):
    """Return (header, big-endian-decoded array('h')) for a product."""
    hdr = parse_header(gzip.decompress(tar.extractfile(member(tar, code, ".txt.gz")).read()).decode("latin-1"))
    raw = gzip.decompress(tar.extractfile(member(tar, code, ".dat.gz")).read())
    g = array("h")
    g.frombytes(raw)
    if sys.byteorder == "little":  # SNODAS .dat is big-endian
        g.byteswap()
    return hdr, g


def crop(hdr, g):
    """Crop the full grid to Colorado; return (ncols, nrows, west, north, array)."""
    res, minx, maxy = hdr["res"], hdr["minx"], hdr["maxy"]
    nc = hdr["ncols"]
    c0 = int((CO_W - minx) / res)
    c1 = int((CO_E - minx) / res) + 1
    r0 = int((maxy - CO_N) / res)
    r1 = int((maxy - CO_S) / res) + 1
    out = array("h")
    for r in range(r0, r1):
        base = r * nc
        out.extend(g[base + c0: base + c1])
    return {
        "ncols": c1 - c0,
        "nrows": r1 - r0,
        "west": minx + c0 * res,    # left edge of cropped col 0
        "north": maxy - r0 * res,   # top edge of cropped row 0
        "cellsize": res,
        "data": out,
    }


def write_bin(name, arr):
    if sys.byteorder == "big":  # emit little-endian for the browser
        arr = array("h", arr)
        arr.byteswap()
    path = os.path.join(OUT_DIR, name)
    with gzip.open(path, "wb", compresslevel=9) as f:
        f.write(arr.tobytes())
    return os.path.getsize(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tar")
    ap.add_argument("--date")
    args = ap.parse_args()

    if args.tar:
        date_str, tar_bytes = None, open(args.tar, "rb").read()
    elif args.date:
        date_str, tar_bytes = args.date, fetch_tar(args.date)
    else:
        date_str, tar_bytes = latest_tar()

    os.makedirs(OUT_DIR, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(tar_bytes)) as tar:
        if not date_str:  # derive the analysis date from a member name (…TS2026050105HP001…)
            m = re.search(r"TS(\d{8})\d{2}", tar.getnames()[0])
            date_str = m.group(1) if m else "00000000"
        meta = None
        out_files = {}
        for label, code in PRODUCTS.items():
            hdr, g = read_grid(tar, code)
            c = crop(hdr, g)
            sz = write_bin(f"snodas-co-{label}.bin.gz", c["data"])
            out_files[label] = f"snodas-co-{label}.bin.gz"
            meta = c  # geometry identical across products
            sys.stderr.write(f"{label}: {c['ncols']}x{c['nrows']} -> {sz//1024} KB\n")

    iso = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
    info = {
        "date": iso,
        "updated": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "ncols": meta["ncols"], "nrows": meta["nrows"],
        "west": round(meta["west"], 6), "north": round(meta["north"], 6),
        "cellsize": meta["cellsize"], "nodata": -9999, "units": "mm",
        "products": out_files,
    }
    with open(os.path.join(OUT_DIR, "snodas-co.json"), "w") as f:
        json.dump(info, f, indent=2)
    sys.stderr.write(f"wrote snodas-co.json ({iso})\n")


if __name__ == "__main__":
    main()
