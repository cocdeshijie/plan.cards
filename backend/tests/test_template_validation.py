"""Validate every shipped card template against the schema.

Templates are community-contributed and loaded at startup with per-file
try/except, so an invalid one is *skipped with a log warning* rather than
failing loudly. That is the right runtime behaviour and a terrible CI
behaviour — `frequency: yearly` sat in 27 credits across 8 files and broke
profile export with a 500 for anyone holding those cards. This suite makes a
bad template fail the build instead.
"""
import re
from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from app.config import settings
from app.schemas.template import CardTemplateOut, TemplateVersionDetail

TEMPLATES_DIR = Path(settings.card_templates_dir)

# Documented in card_templates/TEMPLATE_REFERENCE.yaml.
VERSION_ID_RE = re.compile(r"^[a-z0-9]+(?:_[a-z0-9]+)*_\d{4}_\d+$")


def _card_files() -> list[Path]:
    return sorted(TEMPLATES_DIR.glob("*/*/card.yaml"))


def _old_files() -> list[Path]:
    return sorted(TEMPLATES_DIR.glob("*/*/old/card_*.yaml"))


def _template_id(path: Path) -> str:
    return f"{path.parent.parent.name}/{path.parent.name}"


def _load(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def test_templates_directory_exists():
    assert TEMPLATES_DIR.is_dir(), f"card templates dir not found: {TEMPLATES_DIR}"
    assert _card_files(), "no card.yaml files found"


@pytest.mark.parametrize("path", _card_files(), ids=_template_id)
def test_card_template_validates(path: Path):
    data = _load(path)
    assert isinstance(data, dict), "template must be a YAML mapping at the top level"
    try:
        CardTemplateOut(
            id=_template_id(path),
            name=data.get("name") or path.parent.name,
            issuer=data.get("issuer") or path.parent.parent.name,
            network=data.get("network"),
            annual_fee=data.get("annual_fee"),
            currency=data.get("currency"),
            benefits=data.get("benefits"),
            notes=data.get("notes"),
            tags=data.get("tags"),
            version_id=data.get("version_id"),
        )
    except ValidationError as e:
        pytest.fail(f"{path.relative_to(TEMPLATES_DIR)} does not validate:\n{e}")


@pytest.mark.parametrize(
    "path", _old_files(), ids=lambda p: f"{_template_id(p.parent)}/{p.stem}"
)
def test_old_version_template_validates(path: Path):
    """Old versions are reachable from `POST /api/cards` via the fee timeline,
    so a malformed one is a 500 on the primary write path."""
    data = _load(path)
    assert isinstance(data, dict), "old version must be a YAML mapping at the top level"
    version_id = re.sub(r"^card_", "", path.stem)
    try:
        TemplateVersionDetail(
            version_id=version_id,
            name=data.get("name") or version_id,
            issuer=data.get("issuer") or "",
            network=data.get("network"),
            annual_fee=data.get("annual_fee"),
            currency=data.get("currency"),
            benefits=data.get("benefits"),
            notes=data.get("notes"),
            tags=data.get("tags"),
        )
    except ValidationError as e:
        pytest.fail(f"{path.relative_to(TEMPLATES_DIR)} does not validate:\n{e}")


def test_every_template_has_a_name_and_issuer():
    missing = [
        str(p.relative_to(TEMPLATES_DIR))
        for p in _card_files()
        if not (_load(p) or {}).get("name") or not (_load(p) or {}).get("issuer")
    ]
    assert not missing, f"templates missing an explicit name/issuer: {missing}"


def test_version_ids_are_unique_and_well_formed():
    """A duplicate version_id makes `_build_fee_timeline` ambiguous and lets one
    card's historical annual fee overwrite another's."""
    seen: dict[str, str] = {}
    malformed: list[str] = []

    for path in _card_files() + _old_files():
        data = _load(path) or {}
        rel = str(path.relative_to(TEMPLATES_DIR))
        version_id = (
            data.get("version_id")
            if path.name == "card.yaml"
            else re.sub(r"^card_", "", path.stem)
        )
        if not version_id:
            continue
        if not VERSION_ID_RE.match(version_id):
            malformed.append(f"{rel}: {version_id!r}")
        if version_id in seen:
            pytest.fail(
                f"duplicate version_id {version_id!r} in {rel} and {seen[version_id]}"
            )
        seen[version_id] = rel

    assert not malformed, (
        "version_id must be <issuer>_<card>_<year>_<seq> "
        f"(see TEMPLATE_REFERENCE.yaml):\n" + "\n".join(malformed)
    )


def test_old_versions_belong_to_a_current_template():
    """An old/ directory with no card.yaml beside it is never loaded."""
    orphans = [
        str(p.relative_to(TEMPLATES_DIR))
        for p in _old_files()
        if not (p.parent.parent / "card.yaml").exists()
    ]
    assert not orphans, f"old versions with no current card.yaml: {orphans}"


def test_loader_reports_no_errors():
    """End-to-end: the real loader must skip nothing in the shipped corpus."""
    from app.services import template_loader

    template_loader.load_templates()
    errors = template_loader.get_load_errors()
    assert not errors, "template loader skipped files:\n" + "\n".join(errors)
    assert len(template_loader.get_all_templates()) == len(_card_files())
