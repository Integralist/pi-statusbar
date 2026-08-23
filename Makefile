.PHONY: all test lint install build try

all: test lint

install:
	npm install

build:
	npm run lint

test:
	npm test

lint:
	npm run lint

try:
	pi -e ./extensions/pi-statusbar.ts
