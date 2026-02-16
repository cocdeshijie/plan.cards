import mimetypes

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.schemas.template import CardTemplateOut, TemplateVersionDetail, TemplateVersionSummary
from app.services.template_loader import (
    get_all_templates,
    get_old_version,
    get_old_version_image_path,
    get_placeholder_image_path,
    get_template,
    get_template_image_path,
    get_template_image_path_by_filename,
    get_template_versions,
    get_templates_by_issuer,
)

router = APIRouter(prefix="/api/templates", tags=["templates"])


@router.get("", response_model=list[CardTemplateOut])
def list_templates(issuer: str | None = None):
    if issuer:
        return get_templates_by_issuer(issuer)
    return get_all_templates()


@router.get("/placeholder-image")
def get_placeholder_image():
    image_path = get_placeholder_image_path()
    if not image_path:
        raise HTTPException(status_code=404, detail="Placeholder image not found")
    return FileResponse(image_path, media_type="image/png")


@router.get("/{issuer}/{card_name}", response_model=CardTemplateOut)
def get_template_endpoint(issuer: str, card_name: str):
    template = get_template(f"{issuer}/{card_name}")
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.get("/{issuer}/{card_name}/image")
def get_template_image(issuer: str, card_name: str):
    image_path = get_template_image_path(f"{issuer}/{card_name}")
    if not image_path:
        raise HTTPException(status_code=404, detail="Image not found")
    media_type = mimetypes.guess_type(str(image_path))[0] or "image/png"
    return FileResponse(image_path, media_type=media_type)


@router.get("/{issuer}/{card_name}/image/{filename}")
def get_template_image_variant(issuer: str, card_name: str, filename: str):
    image_path = get_template_image_path_by_filename(f"{issuer}/{card_name}", filename)
    if not image_path:
        raise HTTPException(status_code=404, detail="Image variant not found")
    media_type = mimetypes.guess_type(str(image_path))[0] or "image/png"
    return FileResponse(image_path, media_type=media_type)


@router.get(
    "/{issuer}/{card_name}/versions",
    response_model=list[TemplateVersionSummary],
)
def list_template_versions(issuer: str, card_name: str):
    template_id = f"{issuer}/{card_name}"
    template = get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return get_template_versions(template_id)


@router.get(
    "/{issuer}/{card_name}/versions/{version_id}",
    response_model=TemplateVersionDetail,
)
def get_template_version(issuer: str, card_name: str, version_id: str):
    template_id = f"{issuer}/{card_name}"
    template = get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # Check if requesting current version
    if template.version_id == version_id:
        return TemplateVersionDetail(
            version_id=template.version_id,
            name=template.name,
            issuer=template.issuer,
            network=template.network,
            annual_fee=template.annual_fee,
            currency=template.currency,
            benefits=template.benefits,
            notes=template.notes,
            tags=template.tags,
            has_image=template.has_image,
            is_current=True,
        )

    detail = get_old_version(template_id, version_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Version not found")
    return detail
