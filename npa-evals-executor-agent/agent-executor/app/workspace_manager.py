from __future__ import annotations

import mimetypes
import shutil
from dataclasses import dataclass
from pathlib import Path

from .schemas import ArtifactMetadata


ARTIFACT_EXTENSIONS = {
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".svg": "image",
    ".csv": "csv",
    ".tsv": "csv",
    ".xlsx": "xlsx",
    ".xls": "xlsx",
    ".json": "json",
    ".html": "html",
    ".txt": "text",
    ".md": "text",
    ".pptx": "presentation",
    ".ppt": "presentation",
    ".pdf": "pdf",
    ".docx": "document",
    ".doc": "document",
    ".py": "code",
    ".js": "code",
    ".jsx": "code",
    ".ts": "code",
    ".tsx": "code",
    ".sql": "code",
    ".r": "code",
    ".ipynb": "code",
    ".sh": "code",
    ".bash": "code",
    ".zsh": "code",
    ".yaml": "code",
    ".yml": "code",
    ".toml": "code",
    ".ini": "code",
    ".cfg": "code",
    ".xml": "code",
}


@dataclass(frozen=True)
class WorkspacePaths:
    thread_root: Path
    shared_root: Path
    shared_input_dir: Path
    shared_profiles_dir: Path
    shared_cache_dir: Path
    root: Path
    input_dir: Path
    profiles_dir: Path
    cache_dir: Path
    prior_artifacts_dir: Path
    analysis_dir: Path
    artifacts_dir: Path
    logs_dir: Path
    metadata_dir: Path


class WorkspaceManager:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def create(self, thread_id: str, run_id: str) -> WorkspacePaths:
        thread_root = self.root / thread_id
        shared_root = thread_root / "_shared"
        run_root = thread_root / "runs" / run_id
        paths = WorkspacePaths(
            thread_root=thread_root,
            shared_root=shared_root,
            shared_input_dir=shared_root / "input",
            shared_profiles_dir=shared_root / "profiles",
            shared_cache_dir=shared_root / "cache",
            root=run_root,
            input_dir=run_root / "input",
            profiles_dir=run_root / "profiles",
            cache_dir=run_root / "cache",
            prior_artifacts_dir=run_root / "cache" / "prior_artifacts",
            analysis_dir=run_root / "analysis",
            artifacts_dir=run_root / "artifacts",
            logs_dir=run_root / "logs",
            metadata_dir=run_root / "metadata",
        )
        for path in paths.__dict__.values():
            path.mkdir(parents=True, exist_ok=True)
        return paths

    def delete(self, thread_id: str, run_id: str) -> None:
        shutil.rmtree(self.root / thread_id / "runs" / run_id, ignore_errors=True)

    def log_path(self, thread_id: str, run_id: str) -> Path:
        return self.root / thread_id / "runs" / run_id / "logs" / "run.log"

    def sync_into_run(self, source: Path, destination: Path) -> Path:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        return destination

    def discover_artifacts(self, workspace: WorkspacePaths) -> list[ArtifactMetadata]:
        discovered: list[ArtifactMetadata] = []
        for base in (workspace.artifacts_dir, workspace.analysis_dir):
            if not base.exists():
                continue
            for path in sorted(base.rglob("*")):
                if not path.is_file():
                    continue
                artifact_type = ARTIFACT_EXTENSIONS.get(path.suffix.lower(), "file")
                discovered.append(
                    ArtifactMetadata(
                        name=path.name,
                        workspace_path=str(path.relative_to(workspace.root)),
                        artifact_type=artifact_type,
                        url="",
                        mime_type=mimetypes.guess_type(str(path))[0],
                        size_bytes=path.stat().st_size,
                        local_path=str(path),
                    )
                )
        return discovered
