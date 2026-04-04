from __future__ import annotations

import logging
import shutil
import tempfile
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse

import boto3

from app.config import settings

logger = logging.getLogger(__name__)


class StorageError(RuntimeError):
    pass


def _build_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.storage_endpoint_url,
        region_name=settings.storage_region,
        aws_access_key_id=settings.storage_access_key_id,
        aws_secret_access_key=settings.storage_secret_access_key,
    )


class StorageService:
    def __init__(self) -> None:
        self._s3_client = None

    @property
    def s3_client(self):
        if self._s3_client is None:
            self._s3_client = _build_s3_client()
        return self._s3_client

    def save_file(self, source_path: Path, *, user_id: int, filename: str, content_type: str) -> str:
        if settings.storage_backend == "local":
            user_dir = settings.uploads_path / str(user_id)
            user_dir.mkdir(parents=True, exist_ok=True)
            destination_path = user_dir / filename
            shutil.move(str(source_path), destination_path)
            return f"{settings.static_upload_prefix}/{user_id}/{filename}"

        object_key = f"voice-tweets/{user_id}/{filename}"
        try:
            with source_path.open("rb") as file_handle:
                self.s3_client.upload_fileobj(
                    file_handle,
                    settings.storage_bucket,
                    object_key,
                    ExtraArgs={"ContentType": content_type},
                )
        except Exception as exc:
            logger.exception("Failed to upload media to object storage", extra={"object_key": object_key})
            raise StorageError("Failed to upload media to object storage.") from exc
        finally:
            source_path.unlink(missing_ok=True)

        return f"s3://{settings.storage_bucket}/{object_key}"

    def delete(self, reference: str) -> None:
        if reference.startswith("s3://"):
            bucket, object_key = self._parse_s3_reference(reference)
            try:
                self.s3_client.delete_object(Bucket=bucket, Key=object_key)
            except Exception:
                logger.exception("Failed to delete object storage media", extra={"object_key": object_key})
            return

        relative_path = reference.removeprefix(f"{settings.static_upload_prefix}/")
        local_path = settings.uploads_path / relative_path
        local_path.unlink(missing_ok=True)

    def resolve_public_url(self, reference: str) -> str:
        if not reference:
            return ""
        if reference.startswith("http://") or reference.startswith("https://"):
            return reference
        if reference.startswith("s3://"):
            bucket, object_key = self._parse_s3_reference(reference)
            return self.s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": object_key},
                ExpiresIn=settings.storage_presign_expire_seconds,
            )
        return reference

    @contextmanager
    def processing_path(self, reference: str):
        if reference.startswith("s3://"):
            bucket, object_key = self._parse_s3_reference(reference)
            suffix = Path(object_key).suffix
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
                temp_path = Path(temp_file.name)
            try:
                self.s3_client.download_file(bucket, object_key, str(temp_path))
                yield temp_path
            finally:
                temp_path.unlink(missing_ok=True)
            return

        relative_path = reference.removeprefix(f"{settings.static_upload_prefix}/")
        local_path = settings.uploads_path / relative_path
        yield local_path

    def healthcheck(self) -> tuple[bool, str]:
        if settings.storage_backend == "local":
            try:
                settings.uploads_path.mkdir(parents=True, exist_ok=True)
                return True, "local-ok"
            except Exception as exc:
                return False, str(exc)

        try:
            self.s3_client.head_bucket(Bucket=settings.storage_bucket)
            return True, "s3-ok"
        except Exception as exc:
            return False, str(exc)

    @staticmethod
    def _parse_s3_reference(reference: str) -> tuple[str, str]:
        parsed_reference = urlparse(reference)
        if parsed_reference.scheme != "s3" or not parsed_reference.netloc or not parsed_reference.path:
            raise StorageError("Invalid S3 media reference.")
        return parsed_reference.netloc, parsed_reference.path.lstrip("/")


storage = StorageService()
