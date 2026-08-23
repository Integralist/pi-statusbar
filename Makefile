.PHONY: all test lint install build

all: test lint

install:
	npm install

build:
	npm run lint

test:
	npm test

lint:
	npm run lint
