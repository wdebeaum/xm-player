<style>table, th, td { border: 1px solid black; border-collapse: collapse; }</style>
FT2 = FastTracker 2  
MT = MilkyTracker  
XMP = xm-player  
3-4-digit commands go in the effects column, 2-digit in the volume column.  
code = hexadecimal of how it's coded in the file  
type = how you type it in FT2/MT  
disp = how it appears on the screen  
✖ = not implemented  
~ = partial/buggy implementation  
✔ = fully/correctly implemented, I think

| FT2 | MT | XMP | code | type | disp | description |
|:---:|:--:|:---:| ----:| ----:| ----:| ----------- |
|  ✔  | ✔  |  ✔  |   xx |   xx |   xx | Set note volume (for xx in [0x10,0x60) )
|  ✔  | ✔  |  ~  |   6x |   +x |   +x | Volume slide up
|  ✔  | ✔  |  ~  |   7x |   -x |   -x | Volume slide down
|  ✔  | ✔  |  ~  |   8x |   Dx |   ▼x | Fine volume slide down
|  ✔  | ✔  |  ~  |   9x |   Ux |   ▲x | Fine volume slide up
|  ✔  | ✔  |  ✔  |   Ax |   Sx |   Sx | Set vibrato speed
|  ✔  | ✔  |  ✔  |   Bx |   Vx |   Vx | Perform vibrato and set depth
|  ✔  | ✔  |  ✔  |   Cx |   Px |   Px | Set note panning position
|  ✔  | ✔  |  ✖  |   Dx |   Lx |   ◀x | Panning slide left
|  ✔  | ✔  |  ✖  |   Ex |   Rx |   ▶x | Panning slide right
|  ✔  | ✔  |  ~  |   Fx |   Mx |   Mx | Portamento towards note
|  ✔  | ✔  |  ✔  |  0xy |  0xy |  0xy | Arpeggio
|  ✔  | ✔  |  ~  |  1xx |  1xx |  1xx | Portamento up
|  ✔  | ✔  |  ~  |  2xx |  2xx |  2xx | Portamento down
|  ✔  | ✔  |  ~  |  3xx |  3xx |  3xx | Portamento towards note
|  ✔  | ✔  |  ✔  |  4xy |  4xy |  4xy | Vibrato
|  ✔  | ✔  |  ~  |  5xy |  5xy |  5xy | Portamento towards note and volume slide
|  ✔  | ✔  |  ~  |  6xy |  6xy |  6xy | Vibrato and volume slide
|  ✔  | ✔  |  ✖  |  7xy |  7xy |  7xy | Tremolo
|  ✔  | ✔  |  ✔  |  8xx |  8xx |  8xx | Set note panning position
|  ✔  | ✔  |  ✔  |  9xx |  9xx |  9xx | Sample offset
|  ✔  | ✔  |  ~  |  Axy |  Axy |  Axy | Volume slide
|  ✔  | ✔  |  ✔  |  Bxx |  Bxx |  Bxx | Jump to song position
|  ✔  | ✔  |  ✔  |  Cxx |  Cxx |  Cxx | Set note volume
|  ✔  | ✔  |  ✔  |  Dxx |  Dxx |  Dxx | Jump to row in next pattern
|  ✖  | ✖  |  ✖  |  E0x |  E0x |  E0x | Amiga LED Filter toggle
|  ✔  | ✔  |  ~  |  E1x |  E1x |  E1x | Fine portamento up
|  ✔  | ✔  |  ~  |  E2x |  E2x |  E2x | Fine portamento down
|  ✔  | ✖  |  ✖  |  E3x |  E3x |  E3x | Glissando control
|  ✔  | ✖  |  ✖  |  E4x |  E4x |  E4x | Vibrato control
|  ✔  | ✔  |  ✖  |  E5x |  E5x |  E5x | Set note fine-tune
|  ✔  | ✔  |  ✖  |  E6x |  E6x |  E6x | Pattern loop
|  ✔  | ✖  |  ✖  |  E7x |  E7x |  E7x | Tremolo control
|  ✖  | ✖  |  ✖  |  E8x |  E8x |  E8x | Set note panning position OR Sync
|  ✔  | ✔  |  ✔  |  E9x |  E9x |  E9x | Re-trigger note
|  ✔  | ✔  |  ~  |  EAx |  EAx |  EAx | Fine volume slide up
|  ✔  | ✔  |  ~  |  EBx |  EBx |  EBx | Fine volume slide down
|  ✔  | ✔  |  ~  |  ECx |  ECx |  ECx | Note cut
|  ✔  | ✔  |  ✔  |  EDx |  EDx |  EDx | Delay note
|  ✔  | ✔  |  ✖  |  EEx |  EEx |  EEx | Delay pattern
|  ✖  | ✖  |  ✖  |  EFx |  EFx |  EFx | "Funk it!" (is this a joke?)
|  ✔  | ✔  |  ~  |  Fxx |  Fxx |  Fxx | Set song speed/BPM
|  ✔  | ✔  |  ✔  | 10xx |  Gxx |  Gxx | Set global volume
|  ✔  | ✔  |  ~  | 11xy |  Hxy |  Hxy | Global volume slide
|  ✔  | ✔  |  ✔  | 14xx |  Kxx |  Kxx | Release note on tick (not in FT2.DOC!)
|  ✔  | ✔  |  ✖  | 15xx |  Lxx |  Lxx | Volume envelope jump
|  ✔  | ✔  |  ✖  | 19xy |  Pxy |  Pxy | Panning slide
|  ✔  | ✔  |  ✖  | 1Bxy |  Rxy |  Rxy | Re-trigger note with volume slide
|  ✔  | ✔  |  ✖  | 1Dxy |  Txy |  Txy | Tremor
|  ✖  | ✖  |  ✖  | 20xx |  Wxx |  Wxx | Sync
|  ✔  | ✔  |  ~  | 211x |  X1x |  X1x | Extra fine portamento up
|  ✔  | ✔  |  ~  | 212x |  X2x |  X2x | Extra fine portamento down
