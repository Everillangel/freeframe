import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.asset import Asset
from ..models.metadata import AssetMetadata, Collection, CollectionShare, MetadataField
from ..models.project import ProjectRole
from ..models.user import User
from ..schemas.asset import AssetResponse
from ..schemas.metadata import (
    AssetMetadataResponse,
    AssetMetadataSet,
    CollectionCreate,
    CollectionResponse,
    CollectionShareCreate,
    MetadataFieldCreate,
    MetadataFieldResponse,
)
from ..services.permissions import require_project_role

router = APIRouter(tags=["metadata"])


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_project_for_asset(db: Session, asset_id: uuid.UUID) -> uuid.UUID:
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.deleted_at.is_(None)).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset.project_id


def _apply_smart_filter(db: Session, project_id: uuid.UUID, rules: dict):
    q = db.query(Asset).filter(
        Asset.project_id == project_id,
        Asset.deleted_at.is_(None),
    )
    if rules and "status" in rules:
        q = q.filter(Asset.status == rules["status"])
    if rules and "asset_type" in rules:
        q = q.filter(Asset.asset_type == rules["asset_type"])
    if rules and "name_contains" in rules:
        q = q.filter(Asset.name.ilike(f"%{rules['name_contains']}%"))
    return q


def _collection_asset_count(db: Session, collection: Collection) -> int:
    if not collection.is_smart:
        return 0
    return _apply_smart_filter(db, collection.project_id, collection.filter_rules or {}).count()


# ── Metadata Fields ────────────────────────────────────────────────────────────

@router.post(
    "/projects/{project_id}/metadata-fields",
    response_model=MetadataFieldResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_metadata_field(
    project_id: uuid.UUID,
    body: MetadataFieldCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_project_role(db, project_id, current_user, ProjectRole.editor)

    # Check for duplicate name (active fields only)
    existing = db.query(MetadataField).filter(
        MetadataField.project_id == project_id,
        MetadataField.name == body.name,
        MetadataField.deleted_at.is_(None),
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="A metadata field with this name already exists")

    field = MetadataField(
        project_id=project_id,
        name=body.name,
        field_type=body.field_type,
        options=body.options,
        required=body.required,
    )
    db.add(field)
    db.commit()
    db.refresh(field)
    return field


@router.get(
    "/projects/{project_id}/metadata-fields",
    response_model=list[MetadataFieldResponse],
)
def list_metadata_fields(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_project_role(db, project_id, current_user, ProjectRole.viewer)
    fields = db.query(MetadataField).filter(
        MetadataField.project_id == project_id,
        MetadataField.deleted_at.is_(None),
    ).all()
    return fields


@router.delete(
    "/projects/{project_id}/metadata-fields/{field_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_metadata_field(
    project_id: uuid.UUID,
    field_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_project_role(db, project_id, current_user, ProjectRole.editor)
    field = db.query(MetadataField).filter(
        MetadataField.id == field_id,
        MetadataField.project_id == project_id,
        MetadataField.deleted_at.is_(None),
    ).first()
    if not field:
        raise HTTPException(status_code=404, detail="Metadata field not found")
    field.deleted_at = datetime.now(timezone.utc)
    db.commit()


# ── Asset Metadata ─────────────────────────────────────────────────────────────

@router.put(
    "/assets/{asset_id}/metadata",
    response_model=list[AssetMetadataResponse],
)
def set_asset_metadata(
    asset_id: uuid.UUID,
    body: list[AssetMetadataSet],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project_id = _get_project_for_asset(db, asset_id)
    require_project_role(db, project_id, current_user, ProjectRole.editor)

    for item in body:
        # Validate field exists and belongs to this project
        field = db.query(MetadataField).filter(
            MetadataField.id == item.field_id,
            MetadataField.project_id == project_id,
            MetadataField.deleted_at.is_(None),
        ).first()
        if not field:
            raise HTTPException(
                status_code=404,
                detail=f"Metadata field {item.field_id} not found in this project",
            )

        existing = db.query(AssetMetadata).filter(
            AssetMetadata.asset_id == asset_id,
            AssetMetadata.field_id == item.field_id,
        ).first()
        if existing:
            existing.value = item.value
        else:
            db.add(AssetMetadata(
                asset_id=asset_id,
                field_id=item.field_id,
                value=item.value,
            ))

    db.commit()

    # Return current metadata with field names
    return _get_asset_metadata_responses(db, asset_id)


@router.get(
    "/assets/{asset_id}/metadata",
    response_model=list[AssetMetadataResponse],
)
def get_asset_metadata(
    asset_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project_id = _get_project_for_asset(db, asset_id)
    require_project_role(db, project_id, current_user, ProjectRole.viewer)
    return _get_asset_metadata_responses(db, asset_id)


def _get_asset_metadata_responses(db: Session, asset_id: uuid.UUID) -> list[AssetMetadataResponse]:
    rows = (
        db.query(AssetMetadata, MetadataField)
        .join(MetadataField, AssetMetadata.field_id == MetadataField.id)
        .filter(
            AssetMetadata.asset_id == asset_id,
            MetadataField.deleted_at.is_(None),
        )
        .all()
    )
    return [
        AssetMetadataResponse(
            field_id=meta.field_id,
            field_name=field.name,
            field_type=field.field_type,
            value=meta.value,
        )
        for meta, field in rows
    ]


# ── Collections ────────────────────────────────────────────────────────────────

@router.post(
    "/projects/{project_id}/collections",
    response_model=CollectionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_collection(
    project_id: uuid.UUID,
    body: CollectionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_project_role(db, project_id, current_user, ProjectRole.editor)
    collection = Collection(
        project_id=project_id,
        name=body.name,
        filter_rules=body.filter_rules or {},
        created_by=current_user.id,
    )
    db.add(collection)
    db.commit()
    db.refresh(collection)
    asset_count = _collection_asset_count(db, collection)
    resp = CollectionResponse.model_validate(collection)
    resp.asset_count = asset_count
    resp.is_smart = bool(body.is_smart)
    resp.filter_rules = collection.filter_rules
    return resp


@router.get(
    "/projects/{project_id}/collections",
    response_model=list[CollectionResponse],
)
def list_collections(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_project_role(db, project_id, current_user, ProjectRole.viewer)
    collections = db.query(Collection).filter(
        Collection.project_id == project_id,
        Collection.deleted_at.is_(None),
    ).all()

    result = []
    for col in collections:
        asset_count = _collection_asset_count(db, col)
        resp = CollectionResponse.model_validate(col)
        resp.asset_count = asset_count
        result.append(resp)
    return result


@router.get(
    "/projects/{project_id}/collections/{collection_id}",
    response_model=CollectionResponse,
)
def get_collection(
    project_id: uuid.UUID,
    collection_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_project_role(db, project_id, current_user, ProjectRole.viewer)
    collection = db.query(Collection).filter(
        Collection.id == collection_id,
        Collection.project_id == project_id,
        Collection.deleted_at.is_(None),
    ).first()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    asset_count = _collection_asset_count(db, collection)
    resp = CollectionResponse.model_validate(collection)
    resp.asset_count = asset_count
    return resp


@router.delete(
    "/projects/{project_id}/collections/{collection_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_collection(
    project_id: uuid.UUID,
    collection_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_project_role(db, project_id, current_user, ProjectRole.editor)
    collection = db.query(Collection).filter(
        Collection.id == collection_id,
        Collection.project_id == project_id,
        Collection.deleted_at.is_(None),
    ).first()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    collection.deleted_at = datetime.now(timezone.utc)
    db.commit()


# ── Collection Sharing ─────────────────────────────────────────────────────────

@router.post(
    "/projects/{project_id}/collections/{collection_id}/share",
    status_code=status.HTTP_201_CREATED,
)
def share_collection(
    project_id: uuid.UUID,
    collection_id: uuid.UUID,
    body: CollectionShareCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_project_role(db, project_id, current_user, ProjectRole.editor)
    collection = db.query(Collection).filter(
        Collection.id == collection_id,
        Collection.project_id == project_id,
        Collection.deleted_at.is_(None),
    ).first()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    # Upsert: generate a token for this share if not already exists
    # Since CollectionShare uses token-based sharing in the model, generate a unique token
    existing = db.query(CollectionShare).filter(
        CollectionShare.collection_id == collection_id,
    ).first()
    if existing:
        return {"message": "Already shared", "token": existing.token}

    token = secrets.token_urlsafe(32)
    share = CollectionShare(
        collection_id=collection_id,
        token=token,
        created_by=current_user.id,
    )
    db.add(share)
    db.commit()
    db.refresh(share)
    return {"token": share.token, "collection_id": str(collection_id)}


@router.delete(
    "/projects/{project_id}/collections/{collection_id}/share/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_collection_share(
    project_id: uuid.UUID,
    collection_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_project_role(db, project_id, current_user, ProjectRole.editor)
    collection = db.query(Collection).filter(
        Collection.id == collection_id,
        Collection.project_id == project_id,
        Collection.deleted_at.is_(None),
    ).first()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    share = db.query(CollectionShare).filter(
        CollectionShare.collection_id == collection_id,
        CollectionShare.created_by == user_id,
    ).first()
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
    db.delete(share)
    db.commit()
