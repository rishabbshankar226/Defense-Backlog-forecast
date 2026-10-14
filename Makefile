PY ?= .venv/bin/python
AS_OF := 2026-10-13
RUN := PYTHONPATH=src $(PY) -m dbf

.PHONY: data model workbook charts report site all test a11y

data:
	$(RUN) data --as-of $(AS_OF)

model:
	$(RUN) model --as-of $(AS_OF)

workbook:
	$(RUN) workbook --as-of $(AS_OF)

charts:
	$(RUN) charts --as-of $(AS_OF)

report:
	$(RUN) report --as-of $(AS_OF)

site:
	$(RUN) site --as-of $(AS_OF)

all: data model workbook charts report site

test:
	PYTHONPATH=src $(PY) -m pytest -q --tb=short tests

a11y:
	PYTHONPATH=src $(PY) -m pytest -q --tb=short tests/test_site_a11y.py
