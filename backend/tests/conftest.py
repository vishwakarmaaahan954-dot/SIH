import os
import sys
import pytest
from fastapi.testclient import TestClient

# Ensure backend directory is in sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from main import app, init_db
import seed

@pytest.fixture(autouse=True)
def reset_database():
    """Reset and re-seed the SQLite database before each test to ensure state isolation."""
    init_db()
    seed.seed_master_data()
    yield

@pytest.fixture
def client():
    """Provide a FastAPI TestClient instance."""
    return TestClient(app)
