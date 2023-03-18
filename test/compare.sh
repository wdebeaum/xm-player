#!/bin/sh
# use FT2 png as red channel and XMP as green and blue channels, so that places
# where they agree are greyscale and places where they disagree are colorful
convert FT2/$1.png XMP/$1.png XMP/$1.png \
  -combine -set colorspace sRGB \
  cmp/$1.png
