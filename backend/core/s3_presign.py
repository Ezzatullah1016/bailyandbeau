"""Presigned GET URLs for private S3 objects (media)."""

from __future__ import annotations

import boto3
from botocore.config import Config
from django.conf import settings


def s3_client_for_media():
    """
    Credential chain compatible with IAM instance roles — only inject static keys when both are set.

    Forces the regional endpoint + SigV4 + virtual-hosted addressing so presigned URLs point at
    e.g. https://<bucket>.s3.<region>.amazonaws.com/... . Without this, boto3 may sign against the
    global endpoint (s3.amazonaws.com); for buckets outside us-east-1 that triggers a 301 region
    redirect whose response carries no CORS headers, so browsers (pdf.js) block the request.
    """
    kw: dict = {}
    region = (getattr(settings, "AWS_S3_REGION_NAME", "") or "").strip()
    if region:
        kw["region_name"] = region
        kw["endpoint_url"] = f"https://s3.{region}.amazonaws.com"
    ak = (getattr(settings, "AWS_ACCESS_KEY_ID", "") or "").strip()
    sk = (getattr(settings, "AWS_SECRET_ACCESS_KEY", "") or "").strip()
    if ak and sk:
        kw["aws_access_key_id"] = ak
        kw["aws_secret_access_key"] = sk
    kw["config"] = Config(signature_version="s3v4", s3={"addressing_style": "virtual"})
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
