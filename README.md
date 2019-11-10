# XM Player

A tool for reading and playing FastTracker 2 XM music files in a web browser.

Written in 2016 by William de Beaumont

To the extent possible under law, the author(s) have dedicated all copyright and related and neighboring rights to this software to the public domain worldwide. This software is distributed without any warranty.

You should have received a copy of the CC0 Public Domain Dedication along with this software. If not, see http://creativecommons.org/publicdomain/zero/1.0/ .

## Introduction

This is a tool for reading and playing music files in the [XM format](https://en.wikipedia.org/wiki/XM_%28file_format%29) in a web browser. XM is the format originally used by the DOS program FastTracker 2, and is based on the older MOD format. Years ago I used SoundTracker (a Unix clone of FT2) to write a bunch of music in this format. I wanted to write a web-based player to use on [my website](http://www.uofr.net/~willdb/music/) to play my old music, and to document the format itself more thoroughly than I'd seen elsewhere.

[online demo](http://www.uofr.net/~willdb/music/xm-player.html)

## Features

 - Load from local file or from a URL. The URL must be served from the same domain as the player, or the target of the URL must explicitly allow CORS requests. You can use this to load files from [The Mod Archive](https://modarchive.org/), for example.
 - Display practically all the information in the XM file as HTML, with units. Even the effects columns in the pattern have tooltips explaining each effect (even if the player doesn't implement that effect).
 - Play most XM files recognizably (if not completely accurately).
 - Optionally scroll to the currently playing pattern row (if the "Show patterns" checkbox is checked before loading the file).
 - Play individual patterns, instruments, and samples.
 - Loop songs and individual patterns.
 - Click the stop button at the top right to stop playing any sound.
 - Tested in Firefox and Chrome. May also work in Safari, Opera, and Edge (not IE, or Opera Mini). I'm going by [caniuse](http://caniuse.com/#feat=audio-api).

## Bugs

 - Loading large files can be very slow (10s of seconds), mostly due to layout of the pattern tables. Uncheck the "show patterns" checkbox to speed it up.
 - Slight lag between patterns, especially noticeable in songs that make extensive use of jumps to make the pattern display do [crazy](http://www.uofr.net/~willdb/music/xm-player.html#https://api.modarchive.org/downloads.php?moduleid=46653) [things](http://www.uofr.net/~willdb/music/xm-player.html#https://api.modarchive.org/downloads.php?moduleid=160630).
 - Occasional larger hiccups in the middle of patterns, especially in songs with many channels playing at once.
 - Rarely, releasing a note with a looping envelope causes stack overflow, making the song get stuck completely.
 - The Fxx effect sets the tempo/BPM for events yet to be scheduled, but doesn't update previously-scheduled future events whose timing depends on these parameters (e.g. volume/panning envelopes).
 - The ECx "note cut" effect actually cuts the note, when it should just set the volume to 0 so the note can be resurrected by later commands (such as a "new" note with a tone porta)

## Unimplemented XM features

 - Amiga frequency table (linear used instead, and makes esp. portamentos sound wrong in songs set to use Amiga table)
 - Ping-pong loops (forward loops used instead)
 - Effects:
   - 7xy Tremolo (oscillating volume)
   - E3x Glissando (discrete pitch slide)
   - E4x Set vibrato (oscillating pitch) waveform (it stays at the instrument's setting)
   - E5x Set note finetune (ditto)
   - E6x Pattern loop
   - E7x Set tremolo (oscillating volume) waveform
   - E8x either "set note panning position" (like 8xx) or "sync" (like Wxx)
   - E9x Retrigger note
   - EDx Note delay
   - EEx Pattern delay
   - Lxx Set volume envelope position
   - Pxy Panning slide
   - Rxy Retrigger + volume slide
   - Txy Tremor (interrupting volume)
   - Wxx Sync

## Some other ways to play XM files

 - [MikMod](http://mikmod.sourceforge.net/): cross-platform, plays many formats
 - In a web browser:
   - [jsxm](https://github.com/a1k0n/jsxm/): very similar to mine, but:
     - sounds more faithful to FT2
     - displays less information from the file (just the title, the patterns as they play, and the instrument names and waveforms)
     - uses the Web Audio API merely as a place to stuff PCM samples into, rather than taking full advantage of its relevant features (perhaps that was the right decision, given the results)
     - requires drag-and-drop to open local files, rather than an "open" dialog window

   - [chiptune2.js](https://github.com/deskjet/chiptune2.js): emscripten port of the library behind OpenMPT

 - Editors:
   - [FastTracker 2](http://www.pouet.net/prod.php?which=13350): DOS, the original
   - [MilkyTracker](http://milkytracker.github.io/): cross-platform
   - [SoundTracker](http://www.soundtracker.org/): Unix, no longer maintained
   - [OpenMPT](https://openmpt.org/): Windows-only

## XM format resources

 - FT2.DOC from the FastTracker 2 download above, documents usage of FT2 as well as the list of effects, but not their representation in the file format.
 - The XM 2.04 format documentation (ftp://ftp.modland.com/pub/documents/format%5fdocumentation/FastTracker%202%20v2.04%20%28.xm%29.html) documents the file format, but has fewer details about the effects. It's also written by one of the authors of FT2, but was then extended and corrected (!) by others.
 - [The MilkyTracker Manual](http://milkytracker.github.io/docs/MilkyTracker.html) is similar in spirit to FT2.DOC, but goes into a little more detail (but still frustratingly lacks units on many of the effect parameters).
 - [A1k0n's blog post on writing jsxm](https://www.a1k0n.net/2015/11/09/javascript-ft2-player.html) has the most useful explanation of ticks, rows, note periods/frequencies, speed/tempo, and BPM (units!). These things are defined half-heartedly, if at all, in the other documents, and can be confusing (e.g. a beat is four rows, except when it isn't...). It also has a reasonable introduction to other basic tracker concepts I was already familiar with. It deliberately has almost no information on specific effects, though.
 - One of the XM files I had lying around used an effect not documented in any of the above documentation: `Wxx`. I found out it's not supported by FT2 at all, but is supported by the BASS player, and is used to trigger a synchronization callback. It's documented in these places:
   - [The BASS changelog](https://github.com/azuisleet/gmodmodules/blob/master/gm_bass/bass/bass.txt#L1688), which is how I found it.
   - [The documentation for `BASSMOD_MusicSetSync`](http://wingzone.tripod.com/bassmod/BASSMOD_MusicSetSync.html), which sets up the callback (`Wxx` is buried in the text).

