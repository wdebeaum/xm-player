#!/bin/sh
set -eu
cat <<EOH
<!DOCTYPE html>
<html>
<meta charset="utf-8">
<link rel="stylesheet" type="text/css" href="doc.css">
EOH
commonmarker --to=html --render-option=UNSAFE "$1"
echo "</html>"
