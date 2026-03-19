"""
SQLAlchemy event-based soft-delete filter.

Rather than a complex SQLAlchemy event hook (which can cause recursive issues),
this module provides a simple utility function ``apply_soft_delete_filter`` that
can be called explicitly on any Query to append ``WHERE deleted_at IS NULL`` for
models that carry a ``deleted_at`` column.

Usage
-----
from .middleware.soft_delete import apply_soft_delete_filter

# Wrap any query before executing:
query = apply_soft_delete_filter(db.query(MyModel))
results = query.all()
"""

from sqlalchemy.orm import Query
from sqlalchemy import inspect as sa_inspect


def apply_soft_delete_filter(query: Query) -> Query:
    """Append ``deleted_at IS NULL`` to any query whose entity has that column.

    Works with single-entity queries as well as multi-entity / joined queries.
    Entities that do not have ``deleted_at`` are silently skipped.
    """
    for desc in query.column_descriptions:
        entity = desc.get("entity")
        if entity is None:
            continue
        try:
            mapper = sa_inspect(entity)
        except Exception:
            continue
        try:
            table = mapper.persist_selectable
        except AttributeError:
            continue
        if hasattr(table.c, "deleted_at"):
            query = query.filter(entity.deleted_at.is_(None))
    return query
