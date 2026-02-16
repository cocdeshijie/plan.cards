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
_old_versions: dict[str, dict[str, dict]] = {}
_old_image_paths: dict[str, dict[str, Path]] = {}

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
    old_vers: dict[str, dict[str, dict]],
    old_imgs: dict[str, dict[str, Path]],
) -> None:
    """Scan old/ subdirectory for versioned YAML files and their images."""
    old_dir = card_dir / "old"
    if not old_dir.exists() or not old_dir.is_dir():
        return

    versions: dict[str, dict] = {}
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
            logger.warning("Skipping old version %s/%s: %s", template_id, version_id, exc)
            continue
        if data:
            versions[version_id] = data

        # Check for matching image
        for ext in IMAGE_EXTENSIONS:
            img = old_dir / f"card_{version_id}{ext}"
            if img.exists():
                image_paths[version_id] = img
                break

    if versions:
        old_vers[template_id] = versions
    if image_paths:
        old_imgs[template_id] = image_paths


def _compute_fingerprint() -> str:
    """Compute a fingerprint of the templates directory based on file mtimes."""
    templates_dir = Path(settings.card_templates_dir)
    if not templates_dir.exists():
        return ""
    max_mtime = 0.0
    count = 0
    for root, dirs, files in os.walk(templates_dir):
        # Skip hidden directories
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for name in files:
            if not any(name.lower().endswith(ext) for ext in _TRACKED_EXTENSIONS):
                continue
            try:
                st = os.stat(os.path.join(root, name))
                if st.st_mtime > max_mtime:
                    max_mtime = st.st_mtime
                count += 1
            except OSError:
                continue
    return f"{count}:{max_mtime}"


def load_templates() -> None:
    """Load all YAML card templates from the templates directory.

    Builds new dicts locally and swaps globals atomically for thread safety.
    """
    global _templates, _image_paths, _image_file_paths
    global _old_versions, _old_image_paths, _last_fingerprint

    new_templates: dict[str, CardTemplateOut] = {}
    new_image_paths: dict[str, Path] = {}
    new_image_file_paths: dict[str, dict[str, Path]] = {}
    new_old_versions: dict[str, dict[str, dict]] = {}
    new_old_image_paths: dict[str, dict[str, Path]] = {}

    templates_dir = Path(settings.card_templates_dir)
    if not templates_dir.exists():
        _templates = new_templates
        _image_paths = new_image_paths
        _image_file_paths = new_image_file_paths
        _old_versions = new_old_versions
        _old_image_paths = new_old_image_paths
        _last_fingerprint = ""
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
                logger.warning("Skipping template %s: failed to parse YAML: %s", template_id, exc)
                continue
            if data is None:
                continue

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
                _load_old_versions(card_dir, template_id, new_old_versions, new_old_image_paths)
            except Exception as exc:
                logger.warning("Skipping template %s: validation error: %s", template_id, exc)
                continue

    # Atomic swap
    _templates = new_templates
    _image_paths = new_image_paths
    _image_file_paths = new_image_file_paths
    _old_versions = new_old_versions
    _old_image_paths = new_old_image_paths
    _last_fingerprint = _compute_fingerprint()


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
    if not str(resolved).startswith(str(templates_dir)):
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
    for vid, data in old.items():
        result.append(TemplateVersionSummary(
            version_id=vid,
            name=data.get("name", ""),
            annual_fee=data.get("annual_fee"),
            is_current=False,
        ))

    return result


def get_old_version(template_id: str, version_id: str) -> TemplateVersionDetail | None:
    """Get a specific old version's full detail."""
    old = _old_versions.get(template_id, {})
    data = old.get(version_id)
    if not data:
        return None
    old_imgs = _old_image_paths.get(template_id, {})
    return TemplateVersionDetail(
        version_id=version_id,
        name=data.get("name", ""),
        issuer=data.get("issuer", ""),
        network=data.get("network"),
        annual_fee=data.get("annual_fee"),
        currency=data.get("currency"),
        benefits=data.get("benefits"),
        notes=data.get("notes"),
        tags=data.get("tags"),
        has_image=version_id in old_imgs,
        is_current=False,
    )


def get_old_version_image_path(template_id: str, version_id: str) -> Path | None:
    return _old_image_paths.get(template_id, {}).get(version_id)


def get_placeholder_image_path() -> Path | None:
    path = Path(settings.card_templates_dir) / "placeholder.png"
    return path if path.exists() else None
