"""Presigned GET URLs for private S3 objects (media)."""

from __future__ import annotations

import boto3
from django.conf import settings


def s3_client_for_media():
    """
    Credential chain compatible with IAM instance roles — only inject static keys when both are set.
    """
    kw: dict = {}
    region = (getattr(settings, "AWS_S3_REGION_NAME", "") or "").strip()
    if region:
        kw["region_name"] = region
    ak = (getattr(settings, "AWS_ACCESS_KEY_ID", "") or "").strip()
    sk = (getattr(settings, "AWS_SECRET_ACCESS_KEY", "") or "").strip()
    if ak and sk:
        kw["aws_access_key_id"] = ak
        kw["aws_secret_access_key"] = sk
    return boto3.client("s3", **kw)


def presigned_get_object_url(key: str) -> str | None:
    """
    Single-object presigned HTTPS URL or None when misconfigured.

    Prefer this for staff-only downloads (PDFs): unsigned virtual-hosted URLs fail with AccessDenied when
    the bucket/objects are private.
    """
    bucket = (getattr(settings, "AWS_STORAGE_BUCKET_NAME", "") or "").strip()
    clean_key = (key or "").strip().lstrip("/")
    if not bucket or not clean_key:
        return None
    try:
        return s3_client_for_media().generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": clean_key},
            ExpiresIn=max(60, int(getattr(settings, "AWS_QUERYSTRING_EXPIRE", 3600))),
        )
    except Exception:
        return None
