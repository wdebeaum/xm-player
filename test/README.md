Files:

 - `README.md` - this file
 - `input/*.xm` - XM files testing specific features (effects, or combinations)
 - `FT2/*.wav` - corresponding wav output of FastTracker 2, at amplification 8 (not committed, too big)
 - `FT2/*.png` - spectrograms of the corresponding `.wav` files
 - `XMP/*.wav`, `XMP/*.png` - the same for xm-player (should be generated during testing, not committed)
 - `cmp/*.png` - combination of the `.png`s from `FT2/` and `XMP/` for visual comparison (see below; again, generated during testing, not committed)
 - `compare.sh` - script for combining a `FT2/*.png` and a `XMP/*.png`.
 - `saw.xi` - tiny instrument used by many tests
 - `spectrogram.html` - tool for making `.png` spectrograms from `.wav` audio

Test procedure:

 - Install [ImageMagick](https://www.imagemagick.org/) (`compare.sh` uses its `convert` command).
 - Ensure `XMP/` and `cmp/` exist: `mkdir -p XMP cmp`.
 - For each `input/$TEST.xm`:
   - Load it in `../xm-player.html`.
   - Render and save .wav file `XMP/$TEST.wav`.
   - Load `XMP/$TEST.wav` in `spectrogram.html` and save `XMP/$TEST.png`.
   - Run `./compare.sh $TEST`, which creates `cmp/$TEST.png` from `FT2/$TEST.png` (red channel) and `XMP/$TEST.png` (blue and green channels).
   - Look at `cmp/$TEST.png`. Differences will appear red or cyan; samenesses will appear greyscale. Some fringing on the higher overtones (right side of the image), and some noise (horizontal lines), are expected.

Alternatively, you can make `FT2/$TEST.wav` and `XMP/$TEST.wav`, load them into separate tracks in an audio editor like [Audacity](https://www.audacityteam.org/) or [Tenacity](https://tenacityaudio.org/), and either visually compare the waveforms, or invert one of them and then mix them (what remains will be the difference between the two). At present this is the only way I have of testing panning features (the spectrograms are mono). But the mixing technique is overly sensitive to minor differences in phase and filtering, so for most things I prefer comparing the spectrograms.
