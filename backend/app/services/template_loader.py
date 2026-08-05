import hashlib
import logging
import os
import re
from pathlib import Path

import yaml

from app.config import settings
from app.schemas.template import CardTemplateOut, TemplateVersionDetail, TemplateVersionSummary


logger = logging.getLogger(__name__)

_templates: dict[str, CardTemplateOut] = {}
_image_paths: dict[str, Path] = {}
_image_file_paths: dict[str, dict[str, Path]] = {}
_old_versions: dict[str, dict[str, TemplateVersionDetail]] = {}
_old_image_paths: dict[str, dict[str, Path]] = {}
_load_errors: list[str] = []

_last_fingerprint: str = ""

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")
_TRACKED_EXTENSIONS = IMAGE_EXTENSIONS + (".yaml", ".yml")


def _find_image(card_dir: Path) -> Path | None:
    for ext in IMAGE_EXTENSIONS:
        img = card_dir / f"card{ext}"
        if img.exists():
            return img
    return None


def _find_all_images(card_dir: Path) -> dict[str, Path]:
    """Find all image files in a template directory and its old/ subdirectory.

    Returns {filename: Path} with card.{ext} first, then alphabetical.
    Top-level files win on filename conflicts with old/.
    """
    images: dict[str, Path] = {}
    default_name: str | None = None

    # Scan card_dir for all image files
    for f in sorted(card_dir.iterdir()):
        if not f.is_file() or f.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        if ":Zone.Identifier" in f.name:
            continue
        images[f.name] = f
        if f.stem.lower() == "card":
            default_name = f.name

    # Scan old/ subdirectory
    old_dir = card_dir / "old"
    if old_dir.exists() and old_dir.is_dir():
        for f in sorted(old_dir.iterdir()):
            if not f.is_file() or f.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            if ":Zone.Identifier" in f.name:
                continue
            if f.name not in images:  # top-level wins on conflict
                images[f.name] = f

    # Ensure card.{ext} is first (it's the default)
    if default_name:
        ordered: dict[str, Path] = {default_name: images.pop(default_name)}
        for k in sorted(images):
            ordered[k] = images[k]
        return ordered

    return dict(sorted(images.items()))


def _load_old_versions(
    card_dir: Path,
    template_id: str,
    old_vers: dict[str, dict[str, TemplateVersionDetail]],
    old_imgs: dict[str, dict[str, Path]],
    errors: list[str],
) -> None:
    """Scan old/ subdirectory for versioned YAML files and their images.

    Old versions are validated into models HERE rather than being stored as raw
    dicts and constructed per-request. A malformed community file (a blank
    `name:`, a YAML list instead of a mapping) would otherwise raise on every
    call to `get_template_versions` — which `create_card` goes through — turning
    a load-time skip into a 500 on the app's primary write path.
    """
    old_dir = card_dir / "old"
    if not old_dir.exists() or not old_dir.is_dir():
        return

    versions: dict[str, TemplateVersionDetail] = {}
    image_paths: dict[str, Path] = {}

    for f in sorted(old_dir.iterdir()):
        if not f.is_file() or f.suffix not in (".yaml", ".yml"):
            continue
        # Expected: card_<version_id>.yaml
        match = re.match(r"^card_(.+)\.ya?ml$", f.name)
        if not match:
            continue
        version_id = match.group(1)
        try:
            with open(f) as fh:
                data = yaml.safe_load(fh)
        except Exception as exc:
            errors.append(f"{template_id}/old/{f.name}: failed to parse YAML: {exc}")
            logger.warning("Skipping old version %s/%s: %s", template_id, version_id, exc)
            continue
        if not isinstance(data, dict):
            if data is not None:
                errors.append(f"{template_id}/old/{f.name}: expected a mapping at the top level")
                logger.warning(
                    "Skipping old version %s/%s: expected a mapping, got %s",
                    template_id, version_id, type(data).__name__,
                )
            continue

        # Resolve the image first — has_image is part of the validated model.
        image_path: Path | None = None
        for ext in IMAGE_EXTENSIONS:
            img = old_dir / f"card_{version_id}{ext}"
            if img.exists():
                image_path = img
                break

        try:
            versions[version_id] = TemplateVersionDetail(
                version_id=version_id,
                name=data.get("name") or version_id,
                issuer=data.get("issuer") or "",
                network=data.get("network"),
                annual_fee=data.get("annual_fee"),
                currency=data.get("currency"),
                benefits=data.get("benefits"),
                notes=data.get("notes"),
                tags=data.get("tags"),
                has_image=image_path is not None,
                is_current=False,
            )
        except Exception as exc:
            errors.append(f"{template_id}/old/{f.name}: validation error: {exc}")
            logger.warning(
                "Skipping old version %s/%s: validation error: %s", template_id, version_id, exc
            )
            continue

        if image_path is not None:
            image_paths[version_id] = image_path

    if versions:
        old_vers[template_id] = versions
    if image_paths:
        old_imgs[template_id] = image_paths


def _compute_fingerprint() -> str:
    """Fingerprint the templates directory: a hash over (path, mtime, size).

    Deliberately not `count:max_mtime` — that misses in-place edits made by
    anything that preserves timestamps and file count (`tar -x`, `rsync -a`,
    `cp -p`, restoring a backup over the bind mount), so hot-reload would never
    fire until a container restart.
    """
    templates_dir = Path(settings.card_templates_dir)
    if not templates_dir.exists():
        return ""
    digest = hashlib.sha256()
    entries: list[tuple[str, float, int]] = []
    for root, dirs, files in os.walk(templates_dir):
        # Skip hidden directories
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for name in files:
            if not any(name.lower().endswith(ext) for ext in _TRACKED_EXTENSIONS):
                continue
            path = os.path.join(root, name)
            try:
                st = os.stat(path)
            except OSError:
                continue
            entries.append((path, st.st_mtime, st.st_size))
    for path, mtime, size in sorted(entries):
        digest.update(f"{path}:{mtime}:{size}\n".encode())
    return digest.hexdigest()


def load_templates() -> None:
    """Load all YAML card templates from the templates directory.

    Builds new dicts locally and swaps globals atomically for thread safety.
    """
    global _templates, _image_paths, _image_file_paths
    global _old_versions, _old_image_paths, _last_fingerprint, _load_errors

    new_templates: dict[str, CardTemplateOut] = {}
    new_image_paths: dict[str, Path] = {}
    new_image_file_paths: dict[str, dict[str, Path]] = {}
    new_old_versions: dict[str, dict[str, TemplateVersionDetail]] = {}
    new_old_image_paths: dict[str, dict[str, Path]] = {}
    new_errors: list[str] = []

    templates_dir = Path(settings.card_templates_dir)
    if not templates_dir.exists():
        # Do NOT clear the loaded templates: a bind mount that momentarily
        # disappears would otherwise make every card's template unresolvable.
        logger.warning(
            "Card templates directory %s does not exist; keeping %d already-loaded templates",
            templates_dir, len(_templates),
        )
        return

    for issuer_dir in sorted(templates_dir.iterdir()):
        if not issuer_dir.is_dir() or issuer_dir.name.startswith("."):
            continue
        for card_dir in sorted(issuer_dir.iterdir()):
            if not card_dir.is_dir() or card_dir.name.startswith("."):
                continue
            yaml_file = card_dir / "card.yaml"
            if not yaml_file.exists():
                continue
            template_id = f"{issuer_dir.name}/{card_dir.name}"
            try:
                with open(yaml_file) as f:
                    data = yaml.safe_load(f)
            except Exception as exc:
                new_errors.append(f"{template_id}: failed to parse YAML: {exc}")
                logger.warning("Skipping template %s: failed to parse YAML: %s", template_id, exc)
                continue
            if not isinstance(data, dict):
                if data is not None:
                    new_errors.append(f"{template_id}: expected a mapping at the top level")
                    logger.warning(
                        "Skipping template %s: expected a mapping, got %s",
                        template_id, type(data).__name__,
                    )
                continue

            # Validate required fields exist
            if not data.get("name"):
                data["name"] = card_dir.name
            if not data.get("issuer"):
                data["issuer"] = issuer_dir.name

            image_path = _find_image(card_dir)
            if image_path:
                new_image_paths[template_id] = image_path

            image_map = _find_all_images(card_dir)
            images = list(image_map.keys())
            if image_map:
                new_image_file_paths[template_id] = image_map

            try:
                new_templates[template_id] = CardTemplateOut(
                    id=template_id,
                    name=data.get("name", card_dir.name),
                    issuer=data.get("issuer", issuer_dir.name),
                    network=data.get("network"),
                    annual_fee=data.get("annual_fee"),
                    currency=data.get("currency"),
                    benefits=data.get("benefits"),
                    notes=data.get("notes"),
                    tags=data.get("tags"),
                    has_image=image_path is not None,
                    version_id=data.get("version_id"),
                    images=images,
                )
            except Exception as exc:
                new_errors.append(f"{template_id}: validation error: {exc}")
                logger.warning("Skipping template %s: validation error: %s", template_id, exc)
                continue

            _load_old_versions(
                card_dir, template_id, new_old_versions, new_old_image_paths, new_errors
            )

    # Atomic swap
    _templates = new_templates
    _image_paths = new_image_paths
    _image_file_paths = new_image_file_paths
    _old_versions = new_old_versions
    _old_image_paths = new_old_image_paths
    _load_errors = new_errors
    _last_fingerprint = _compute_fingerprint()
    logger.info(
        "Loaded %d templates (%d with images, %d file(s) skipped due to errors)",
        len(new_templates), len(new_image_paths), len(new_errors),
    )
    for err in new_errors:
        logger.warning("Template error: %s", err)


def reload_if_changed() -> bool:
    """Reload templates if the directory contents have changed.

    Returns True if templates were reloaded.
    """
    fp = _compute_fingerprint()
    if fp == _last_fingerprint:
        return False
    logger.info("Template directory changed, reloading...")
    load_templates()
    return True


def get_all_templates() -> list[CardTemplateOut]:
    return list(_templates.values())


def get_template(template_id: str) -> CardTemplateOut | None:
    return _templates.get(template_id)


def get_templates_by_issuer(issuer: str) -> list[CardTemplateOut]:
    return [t for t in _templates.values() if t.issuer.lower() == issuer.lower()]


def get_template_image_path(template_id: str) -> Path | None:
    if ".." in template_id or template_id.startswith("/"):
        return None
    return _image_paths.get(template_id)


def get_template_image_path_by_filename(template_id: str, filename: str) -> Path | None:
    """Get a specific image variant by filename."""
    if ".." in template_id or template_id.startswith("/"):
        return None
    if ".." in filename or "/" in filename or "\\" in filename:
        return None
    file_paths = _image_file_paths.get(template_id, {})
    path = file_paths.get(filename)
    if not path:
        return None
    templates_dir = Path(settings.card_templates_dir).resolve()
    resolved = path.resolve()
    if not resolved.is_relative_to(templates_dir):
        return None
    return resolved if resolved.exists() else None


def get_template_versions(template_id: str) -> list[TemplateVersionSummary]:
    """Get current + old versions for a template."""
    result: list[TemplateVersionSummary] = []
    current = _templates.get(template_id)
    if current and current.version_id:
        result.append(TemplateVersionSummary(
            version_id=current.version_id,
            name=current.name,
            annual_fee=current.annual_fee,
            is_current=True,
        ))

    old = _old_versions.get(template_id, {})
    for vid, detail in old.items():
        result.append(TemplateVersionSummary(
            version_id=vid,
            name=detail.name,
            annual_fee=detail.annual_fee,
            is_current=False,
        ))

    return result


def get_old_version(template_id: str, version_id: str) -> TemplateVersionDetail | None:
    """Get a specific old version's full detail (validated at load time)."""
    return _old_versions.get(template_id, {}).get(version_id)


def get_load_errors() -> list[str]:
    """Per-file errors from the last load, so the admin reload endpoint can
    report which community templates were silently skipped."""
    return list(_load_errors)


def get_placeholder_image_path() -> Path | None:
    path = Path(settings.card_templates_dir) / "placeholder.png"
    return path if path.exists() else None
