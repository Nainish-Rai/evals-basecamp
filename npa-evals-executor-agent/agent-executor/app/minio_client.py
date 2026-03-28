from __future__ import annotations

import mimetypes
import os
from pathlib import Path
from urllib.parse import urlparse

import boto3
from botocore.exceptions import ClientError
from botocore.config import Config


def get_minio_client():
    return boto3.client(
        "s3",
        endpoint_url=os.getenv("MINIO_ENDPOINT", "http://minio:9000"),
        aws_access_key_id=os.getenv("MINIO_ACCESS_KEY", "minioadmin"),
        aws_secret_access_key=os.getenv("MINIO_SECRET_KEY", "minioadmin123"),
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )


def get_minio_public_endpoint() -> str:
    return os.getenv("MINIO_PUBLIC_ENDPOINT", os.getenv("MINIO_ENDPOINT", "http://minio:9000")).rstrip("/")


def build_object_url(bucket_name: str, object_key: str) -> str:
    endpoint = get_minio_public_endpoint()
    return f"{endpoint}/{bucket_name}/{object_key}"


def parse_minio_url(file_url: str) -> tuple[str, str]:
    parsed = urlparse(file_url)
    path = parsed.path
    if path.startswith("/storage/"):
        path = path[len("/storage/") :]
    parts = path.lstrip("/").split("/", 1)
    if len(parts) != 2:
        raise ValueError(f"Invalid MinIO URL: {file_url}")
    return parts[0], parts[1]


def download_from_minio(file_url: str, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    bucket, key = parse_minio_url(file_url)
    client = get_minio_client()
    client.download_file(bucket, key, str(destination))
    return destination


def ensure_bucket(bucket_name: str) -> None:
    client = get_minio_client()
    try:
        client.head_bucket(Bucket=bucket_name)
        return
    except ClientError as exc:
        error_code = str(exc.response.get("Error", {}).get("Code", ""))
        if error_code in {"404", "NoSuchBucket", "NotFound"}:
            client.create_bucket(Bucket=bucket_name)
            return
        raise


def upload_artifact(file_path: Path, bucket_name: str, object_key: str) -> str:
    client = get_minio_client()
    content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    with file_path.open("rb") as handle:
        client.put_object(
            Bucket=bucket_name,
            Key=object_key,
            Body=handle,
            ContentType=content_type,
            ACL="public-read",
        )
    return build_object_url(bucket_name, object_key)


def upload_private_object(file_path: Path, bucket_name: str, object_key: str) -> str:
    client = get_minio_client()
    content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    with file_path.open("rb") as handle:
        client.put_object(
            Bucket=bucket_name,
            Key=object_key,
            Body=handle,
            ContentType=content_type,
        )
    return build_object_url(bucket_name, object_key)
