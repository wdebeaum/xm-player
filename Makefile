all: lint README.html jsdoc

README.html: md2html.sh README.md
	if ./$+ >$@ ; \
	then true ; \
	else \
	  rm -f $@ ; \
	  echo ; \
	  echo "Making README.html failed, but that's OK, everything else will still work. If you really want README.html, make sure you have commonmarker installed." ; \
	fi

jsdoc: node_modules/jsdoc/package.json README.md *.js
	./node_modules/jsdoc/jsdoc.js -d jsdoc README.md *.js

lint: node_modules/eslint/package.json node_modules/eslint-plugin-jsdoc/package.json
	./node_modules/eslint/bin/eslint.js .

node_modules/%/package.json:
	npm install $*

clean:
	rm -rf README.html jsdoc
