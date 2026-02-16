from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.rate_limit import limiter
from app.schemas.setup import SetupStatusResponse, SetupCompleteRequest, SetupCompleteResponse
from app.services.setup_service import is_setup_complete, has_existing_data, complete_setup

router = APIRouter(prefix="/api/setup", tags=["setup"])


@router.get("/status", response_model=SetupStatusResponse)
def get_setup_status(db: Session = Depends(get_db)):
    return SetupStatusResponse(
        setup_complete=is_setup_complete(db),
        has_existing_data=has_existing_data(db),
    )


@router.post("/complete", response_model=SetupCompleteResponse)
@limiter.limit("5/minute")
def complete_setup_endpoint(request: Request, data: SetupCompleteRequest, db: Session = Depends(get_db)):
    if is_setup_complete(db):
        raise HTTPException(status_code=400, detail="Setup already completed")
    try:
        user, token = complete_setup(db, data)
    except IntegrityError:
        raise HTTPException(status_code=400, detail="Setup already completed")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return SetupCompleteResponse(
        success=True,
        auth_mode=data.auth_mode,
        access_token=token,
    )
