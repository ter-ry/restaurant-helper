"""Convenience wrapper for the non-secret production configuration preflight."""
from bootstrap_postgres import main


if __name__ == "__main__":
    raise SystemExit(main(["--phase", "preflight"]))
