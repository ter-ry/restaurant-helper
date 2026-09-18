# Repeatable fixture results

These numbers are from the disposable seeded SQLite fixture used by `scripts/benchmark_operational.py` (five warm runs on the optimized revision). They are included so the PR evidence is reviewable without access to a customer database. The live Render baseline is documented separately because this branch was not deployed.

| Endpoint | SQL before | SQL after | Optimized median | Optimized max |
| --- | ---: | ---: | ---: | ---: |
| Square status | 56 | 22 | 23.4 ms | 25.8 ms |
| Menu costing | 62 | 12 | 34.2 ms | 51.4 ms |
| Catalog mappings | 101 | 29 | 84.9 ms | 98.3 ms |
| Usage / Variance | 200 | 44 | 168.5 ms | 176.0 ms |
| Stock Counts | 14 | 14 | 37.0 ms | 55.4 ms |
| Dashboard | 19 | 19 | 82.6 ms | 86.1 ms |
| Inventory | 19 | 19 | 79.2 ms | 92.1 ms |
| Suppliers | 10 | 10 | 32.7 ms | 37.1 ms |

Authentication and health medians were 9.2 ms and 1.5 ms locally. The optional concurrent fixture probe completed health in 24.5 ms, auth in 45.8 ms, and mappings in 84.5 ms. It is explicitly an in-process Flask test-client probe and does not model Gunicorn worker scheduling or Render capacity.

All benchmarked response snapshots matched before and after. The fixture contains seeded demo records only; no deployed or customer data is present in these measurements.
