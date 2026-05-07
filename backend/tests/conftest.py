"""Shared pytest fixtures.

Adds the backend/ directory to sys.path so tests can import top-level
modules (`store`, `sse`, `routers.*`) without a package install.
"""

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
