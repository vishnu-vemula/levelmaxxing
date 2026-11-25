"""Parse database drafts without importing a database driver or opening a database."""
from pathlib import Path

from pglast import parse_plpgsql, parse_sql


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    drafts = sorted((root / "backend" / "database" / "drafts").glob("*.sql"))
    if not drafts:
        raise SystemExit("There are no SQL drafts to validate.")
    for draft in drafts:
        source = draft.read_text(encoding="utf-8")
        statements = parse_sql(source)
        bodies = parse_plpgsql(source)
        print(f"{draft.name}: {len(statements)} SQL statements, {len(bodies)} function bodies parsed.")


if __name__ == "__main__":
    main()
