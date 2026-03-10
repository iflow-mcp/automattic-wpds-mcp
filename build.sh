#!/bin/bash
npm run build:tsup
sed -i '1d' dist/server.js
sed -i '1s/^/#!\/usr\/bin\/env node\n/' dist/server.js