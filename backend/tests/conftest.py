import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, StaticPool
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.services.template_loader import load_templates

engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
load_templates()


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    return TestClient(app)


TEST_PASSWORD = "testpassword123"


@pytest.fixture
def setup_complete(client):
    """Run onboarding setup — creates admin user and system config."""
    response = client.post("/api/setup/complete", json={
        "auth_mode": "single_password",
        "admin_password": TEST_PASSWORD,
    })
    assert response.status_code == 200
    return response.json()


@pytest.fixture
def auth_headers(client, setup_complete):
    response = client.post("/api/auth/login", json={"password": TEST_PASSWORD})
    assert response.status_code == 200
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def multi_user_headers(client):
    """Setup multi_user mode and return admin auth headers."""
    r = client.post("/api/setup/complete", json={
        "auth_mode": "multi_user",
        "admin_username": "admin",
        "admin_password": "adminpass",
    })
    assert r.status_code == 200
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def db_session():
    """Provide a database session for direct DB tests (e.g. template sync)."""
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
