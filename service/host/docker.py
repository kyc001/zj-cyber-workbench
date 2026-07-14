"""Compatibility names for the removed Docker host adapter.

Portable ZJ deliberately does not import or communicate with Docker. Host
image endpoints remain available for migrated clients and report that no
external image store is configured.
"""

from schema.host.hosts import ManagedHostImageSchema, PullManagedHostImageResultSchema


def list_host_images_sync(host) -> list[ManagedHostImageSchema]:
    del host
    return []


def pull_host_images_sync(host, image_names: list[str]) -> list[PullManagedHostImageResultSchema]:
    del host
    return [PullManagedHostImageResultSchema(image_name=name, success=False, message="Docker is disabled in portable mode") for name in image_names]


def remove_host_image_sync(host, image_id: str, force: bool = False) -> None:
    del host, image_id, force
    raise RuntimeError("Docker is disabled in portable mode")
