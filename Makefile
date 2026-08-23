.PHONY: all test lint install

all: test lint

install:
	npm install

test:
	npm test

lint:
	npm run lint
