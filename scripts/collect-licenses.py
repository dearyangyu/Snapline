"""Collect locked, locally cached dependency licenses without network requests.

Run after npm ci and Cargo dependency fetching. Optional --cargo-metadata accepts
the output of cargo metadata --locked --filter-platform x86_64-pc-windows-msvc.
Supplement entries are explicit, hash-verified files; this script never fetches
their URLs. Missing license texts produce exit 2, not a successful audit claim.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tomllib
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
LICENSE_NAME = re.compile(r"^(?:licen[cs]e|copying|notice|copyright|unlicense)(?:$|[._-])", re.I)
IGNORE = {".git", "node_modules", "target", ".cargo-ok"}
SOURCE_EXTENSIONS = {".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".rs", ".py", ".c", ".h", ".cpp", ".map", ".svg", ".png", ".webp"}


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest().upper()


def package_files(base: Path) -> list[Path]:
    return sorted((p for p in base.rglob("*") if p.is_file()
                   and not (set(p.relative_to(base).parts) & IGNORE)
                   and p.suffix.lower() not in SOURCE_EXTENSIONS
                   and LICENSE_NAME.match(p.name)), key=lambda p: p.relative_to(base).as_posix())


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cargo-metadata", type=Path)
    parser.add_argument("--supplements", type=Path, default=ROOT / "licenses/supplements.json",
                        help="Local manifest of verified supplemental license files")
    parser.add_argument("--output", type=Path, default=ROOT / "licenses")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    previous = load(output / "dependencies.json") if (output / "dependencies.json").exists() else {"packages": []}
    if args.cargo_metadata:
        metadata = load(args.cargo_metadata)
    else:
        result = subprocess.run(["cargo", "metadata", "--manifest-path", str(ROOT / "src-tauri/Cargo.toml"),
                                 "--locked", "--offline", "--filter-platform", "x86_64-pc-windows-msvc",
                                 "--format-version", "1"], check=True, capture_output=True, text=True, encoding="utf-8")
        metadata = json.loads(result.stdout)
    if "\ufffd" in json.dumps(metadata, ensure_ascii=False):
        raise ValueError("Cargo metadata contains Unicode replacement characters; regenerate it with UTF-8 output or omit --cargo-metadata")
    lock = load(ROOT / "package-lock.json")
    cargo_lock = tomllib.loads((ROOT / "src-tauri/Cargo.lock").read_text(encoding="utf-8"))
    cargo_locked = {(p["name"], p["version"]) for p in cargo_lock["package"]}
    nodes = {n["id"]: n for n in metadata["resolve"]["nodes"]}
    root_id = metadata["resolve"]["root"]
    reachable, pending = set(), [root_id]
    while pending:
        package_id = pending.pop()
        if package_id in reachable:
            continue
        reachable.add(package_id)
        pending.extend(nodes[package_id]["dependencies"])
    packages = {p["name"] + "@" + p["version"]: p for p in metadata["packages"] if p["id"] in reachable and p["id"] != root_id}
    supplements = load(args.supplements) if args.supplements.exists() else {"entries": []}
    supplement_base = args.supplements.resolve().parent
    entries, missing, review = [], [], []

    def collect(ecosystem: str, name: str, version: str, expression: str,
                base: Path, upstream: str, files: list[Path], authors: list[str],
                fallback: dict | None = None):
        directory = Path("dependencies") / f"{ecosystem}-{safe_name(name)}-{version}"
        destination = output / directory
        destination.mkdir(parents=True, exist_ok=True)
        copied = []
        for file in files:
            relative = file.relative_to(base)
            data = file.read_bytes()
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            copied.append({"file": (directory / relative).as_posix(), "sha256": digest(data),
                           "origin": f"{ecosystem}:{name}@{version}/{relative.as_posix()}"})
        for extra in supplements["entries"]:
            if extra["ecosystem"] != ecosystem or extra["name"] != name or extra["version"] != version:
                continue
            for source in extra["files"]:
                data = (supplement_base / source["path"]).read_bytes()
                if digest(data) != source["sha256"].upper():
                    raise ValueError(f"Supplement hash mismatch for {name}@{version}")
                filename = safe_name(source["filename"])
                (destination / filename).write_bytes(data)
                copied.append({"file": (directory / filename).as_posix(), "sha256": digest(data),
                               "origin": source["url"], "note": source.get("note", "Verified supplemental upstream text")})
        if not copied and fallback:
            donor = packages[fallback["donor"]]
            donor_base = Path(donor["manifest_path"]).parent
            if fallback.get("sameRepository") and donor.get("repository") != upstream:
                raise ValueError(f"Fallback repository mismatch for {name}")
            for filename in fallback["files"]:
                data = (donor_base / filename).read_bytes()
                target = "UPSTREAM-" + safe_name(filename)
                (destination / target).write_bytes(data)
                copied.append({"file": (directory / target).as_posix(), "sha256": digest(data),
                               "origin": f"cargo:{fallback['donor']}/{filename}", "note": fallback["note"]})
        record = {"ecosystem": ecosystem, "name": name, "version": version, "declaredLicense": expression,
                  "upstream": upstream, "declaredAuthors": authors, "licenseFiles": copied}
        if ecosystem == "cargo":
            record["sourceArchive"] = f"https://crates.io/api/v1/crates/{quote(name)}/{quote(version)}/download"
        if not copied:
            missing.append(f"{ecosystem}:{name}@{version}")
        if "MPL-2.0" in expression:
            review.append(f"{ecosystem}:{name}@{version}: MPL-covered dependency files retain MPL-2.0; exact source archive linked.")
        entries.append(record)

    for path, package in sorted(lock["packages"].items()):
        if not path or package.get("dev"):
            continue
        base = ROOT / path
        installed = load(base / "package.json")
        if installed["version"] != package["version"]:
            raise ValueError(f"Installed npm version differs from package-lock: {path}")
        name = installed["name"]
        repo = installed.get("repository", "")
        if isinstance(repo, dict):
            repo = repo.get("url", "")
        repo = repo.removeprefix("git+")
        if repo.startswith("github:"):
            repo = "https://github.com/" + repo.removeprefix("github:")
        elif repo and ":" not in repo and re.fullmatch(r"[^/]+/[^/]+", repo):
            repo = "https://github.com/" + repo
        if repo.startswith("git://github.com/"):
            repo = "https://github.com/" + repo.removeprefix("git://github.com/")
        collect("npm", name, package["version"], package.get("license", "UNDECLARED"),
                base, repo, package_files(base), [])

    fallbacks = {
        "alloc-stdlib": {"donor": "alloc-no-stdlib@3.0.0", "files": ["LICENSE"], "sameRepository": True,
                         "note": "Same declared repository and authors; alloc-stdlib's crate omits the repository BSD license."},
        "clipboard-win": {"donor": "error-code@3.4.0", "files": ["LICENSE"],
                          "note": "Standard unmodified BSL-1.0 text from a locally cached crate; clipboard-win declares BSL-1.0. No substitute copyright statement is invented."},
        "selectors": {"donor": "cssparser@0.37.0", "files": ["LICENSE"],
                      "note": "Standard MPL-2.0 text; selectors source files explicitly state MPL-2.0, but its crate omits the full license."},
        "tauri-plugin": {"donor": "tauri@2.12.5", "files": ["LICENSE-APACHE-2.0", "LICENSE-MIT"], "sameRepository": True,
                         "note": "Repository license texts from the locally cached Tauri package; tauri-plugin declares the same dual license and repository."},
    }
    for package in sorted(packages.values(), key=lambda p: (p["name"], p["version"])):
        if (package["name"], package["version"]) not in cargo_locked:
            raise ValueError(f"Metadata not present in Cargo.lock: {package['name']}")
        base = Path(package["manifest_path"]).parent
        files = package_files(base)
        explicit = package.get("license_file")
        if explicit:
            explicit_path = Path(explicit)
            if not explicit_path.is_absolute():
                explicit_path = base / explicit_path
            if explicit_path not in files:
                explicit_path.relative_to(base)
                files.append(explicit_path)
        collect("cargo", package["name"], package["version"], package.get("license") or "UNDECLARED",
                base, package.get("repository") or "", files, package.get("authors", []), fallbacks.get(package["name"]))

    for extra in supplements["entries"]:
        if extra["ecosystem"] == "sdk":
            collect("sdk", extra["name"], extra["version"], extra["declaredLicense"],
                    supplement_base, extra["upstream"], [], [])

    manifest = {"schema": 1, "platform": "x86_64-pc-windows-msvc", "networkUsedByCollector": False,
                "scope": "Production npm dependencies; Windows Cargo resolved graph including normal/build/dev dependencies conservatively.",
                "lockSha256": {"package-lock.json": digest((ROOT / "package-lock.json").read_bytes()),
                               "src-tauri/Cargo.lock": digest((ROOT / "src-tauri/Cargo.lock").read_bytes())},
                "packages": entries, "missingLicenseTexts": missing, "additionalObligations": review}
    (output / "dependencies.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = ["# Dependency licenses", "", "This inventory does not relicense dependencies under the project's MIT license.", "",
             "Scope: production npm packages and the locked Windows x64 MSVC Cargo graph. Build and test dependencies are included conservatively.",
             "License files are copied from installed packages/local Cargo source caches; every supplemental or same-repository fallback is identified in [dependencies.json](dependencies.json). No network request is made by the collector.", "",
             "Reproduce with Python 3.11+ after installing/fetching the locked dependencies:", "", "```sh", "python scripts/collect-licenses.py", "```", "",
             "Use `--cargo-metadata FILE` for an already captured Windows-filtered metadata file, and `--supplements FILE` for an explicit hash-verified local supplement manifest.", "",
             "MPL-2.0 dependencies retain their file-level license. Their exact original source archives are linked below; local project code is separately licensed. Keep this inventory and license texts with redistributions. Dual-license choices and AND expressions are not silently replaced by MIT.", "",
             "The Microsoft WebView2 SDK license/notice is listed separately from its Rust bindings. The matched static loader is distributed under those SDK terms; an installed WebView2 browser runtime is a separate component. User-supplied artwork is outside this dependency inventory.", ""]
    if missing:
        lines += ["## Unresolved license text", "", "The collector is incomplete for the following packages; do not treat this as final publication approval:", ""] + [f"- `{item}`" for item in missing] + [""]
    lines += ["## Packages", "", "| Package | License declared upstream | Texts | Source |", "| --- | --- | --- | --- |"]
    for entry in entries:
        texts = ", ".join(f"[{Path(f['file']).name}]({quote(f['file'], safe='/')})" for f in entry["licenseFiles"]) or "MISSING"
        source = f"[crate source]({entry['sourceArchive']})" if "sourceArchive" in entry else f"[upstream]({entry['upstream']})"
        lines.append(f"| `{entry['ecosystem']}:{entry['name']}@{entry['version']}` | {entry['declaredLicense']} | {texts} | {source} |")
    (output / "DEPENDENCIES.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    expected = {text["file"] for entry in entries for text in entry["licenseFiles"]}
    for old in previous["packages"]:
        for text in old["licenseFiles"]:
            if text["file"] in expected:
                continue
            obsolete = (output / text["file"]).resolve()
            # Only remove our previous, byte-unchanged generated text files.
            # Never recurse, remove a package source, or delete unlisted files.
            obsolete.relative_to(output / "dependencies")
            if obsolete.is_file() and digest(obsolete.read_bytes()) == text["sha256"]:
                obsolete.unlink()
    print(json.dumps({"packages": len(entries), "texts": sum(len(e['licenseFiles']) for e in entries), "missing": missing, "mplPackages": len(review)}))
    return 2 if missing else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f"License collection failed: {error}", file=sys.stderr)
        sys.exit(1)
