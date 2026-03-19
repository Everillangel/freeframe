"""Dev seed script — creates demo org, users, and project."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import uuid
from passlib.context import CryptContext
from apps.api.database import SessionLocal
from apps.api.models import *

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def seed():
    db = SessionLocal()
    try:
        # Create org
        org = Organization(name="Demo Org", slug="demo-org")
        db.add(org)
        db.flush()

        # Create admin user
        admin = User(
            email="admin@demo.com",
            name="Admin User",
            password_hash=pwd_context.hash("password123"),
            status=UserStatus.active,
        )
        db.add(admin)
        db.flush()

        # Add admin to org
        member = OrgMember(org_id=org.id, user_id=admin.id, role=OrgRole.owner)
        db.add(member)

        # Create demo project
        project = Project(
            org_id=org.id,
            name="Demo Project",
            project_type=ProjectType.personal,
            created_by=admin.id,
        )
        db.add(project)
        db.flush()

        # Add admin as project owner
        pm = ProjectMember(project_id=project.id, user_id=admin.id, role=ProjectRole.owner)
        db.add(pm)

        db.commit()
        print(f"Seeded: org={org.id}, admin={admin.id}, project={project.id}")
    finally:
        db.close()

if __name__ == "__main__":
    seed()
