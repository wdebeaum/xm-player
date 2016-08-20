#!/usr/bin/perl

# xm2txt.pl - read a .xm file from STDIN and write a text description of it to STDOUT
# 2016-08-19
# William de Beaumont

use bytes;

use strict vars;

sub read_and_unpack {
  my ($length, $template) = @_;
  #print "read_and_unpack($length, '$template')\n";
  my $buf;
  my $ret = read(STDIN, $buf, $length);
  die "read error: $!" unless (defined($ret));
  die "short read: expected $length bytes but got $ret"
    unless ($ret == $length);
  #my @ret = unpack($template, $buf);
  #print "unpacked " . scalar(@ret) . " items\n";
  return unpack($template, $buf);
}

my @note_letters = qw(C- C# D- D# E- F- F# G- G# A- A# B-);
sub note_number_to_name {
  my $num = shift;
  if ($num == 97) {
    return 'off';
  } elsif ($num == 0) {
    return '---';
  } elsif ($num > 97) {
    return 'err';
  } else {
    $num--;
    return $note_letters[$num % 12] . int($num / 12);
  }
}

sub print_volume_panning {
  my (
    $points_for_envelope,
    $number_of_points,
    $sustain_point,
    $loop_start_point,
    $loop_end_point,
    $type
  ) = @_;
  #print "      On: " . (($type & 1) ? 'yes' : 'no') . "\n";
  if ($type & 1) {
    print "      Envelope points: ";
    for (my $i = 0; $i < $number_of_points; $i++) {
      printf("(%04x, %04x), ", $points_for_envelope->[$i*2], $points_for_envelope->[$i*2+1]);
    }
    print "\n";
    #print "        Sustain: " . (($type & 2) ? 'yes' : 'no') . "\n";
    if ($type & 2) {
      printf("      Sustain point: %02x\n", $sustain_point);
    }
    #print "        Loop: " . (($type & 4) ? 'yes' : 'no') . "\n";
    if ($type & 4) {
      print "      Loop:\n";
      printf("        Start point: %02x\n", $loop_start_point);
      printf("        End point: %02x\n", $loop_end_point);
    }
  }
}

my $id_text = read_and_unpack(17, 'Z[17]');
$id_text eq 'Extended Module: ' or die "wrong ID text: $id_text";
my $module_name = read_and_unpack(20, 'Z[20]');
print "Module name: $module_name\n";
my $magic = read_and_unpack(1, 'C');
$magic == 0x1a or die "wrong magic byte: " . sprintf("%02x", $magic);
my $tracker_name = read_and_unpack(20, 'Z[20]');
print "Tracker name: $tracker_name\n";
my $version_number = read_and_unpack(2, 'v');
$version_number == 0x0104 or die "wrong version number: " . sprintf("%04x", $version_number);
my $header_size = read_and_unpack(4, 'V');
#print "Header size: $header_size\n";
print "WARNING: header size should be 276\n" unless ($header_size == 276);
my $song_length = read_and_unpack(2, 'v');
print "Song length: $song_length\n";
my $restart_position = read_and_unpack(2, 'v');
print "Restart position: $restart_position\n";
my $number_of_channels = read_and_unpack(2, 'v');
print "Number of channels: $number_of_channels\n";
print "WARNING: odd number of channels\n" if ($number_of_channels % 2);
print "WARNING: large number of channels\n" if ($number_of_channels > 32);
print "WARNING: no channels\n" if ($number_of_channels == 0);
my $number_of_patterns = read_and_unpack(2, 'v');
print "Number of patterns: $number_of_patterns\n";
print "WARNING: large number of patterns\n" if ($number_of_patterns > 256);
my $number_of_instruments = read_and_unpack(2, 'v');
print "Number of instruments: $number_of_instruments\n";
print "WARNING: large number of instruments\n" if ($number_of_instruments > 128);
my $flags = read_and_unpack(2, 'v');
if (($flags & 1) == 0) {
  print "Amiga frequency table\n";
} else {
  print "Linear frequency table\n";
}
print "WARNING: extra flags: " . sprintf("%016b", $flags) . "\n" if (($flags & 0xFFFE) != 0);
my $default_tempo = read_and_unpack(2, 'v');
print "Default tempo: $default_tempo\n";
my $default_bpm = read_and_unpack(2, 'v');
print "Default BPM: $default_bpm\n";
my @pattern_order_table = read_and_unpack(256, 'C[256]');
print "Pattern order table:\n";
for (my $y = 0; $y < 16; $y++) {
  for (my $x = 0; $x < 16; $x++) {
    printf("%02x ", $pattern_order_table[$x + $y*16]);
  }
  print "\n";
}

print "Patterns:\n";
for (my $pi = 0; $pi < $number_of_patterns; $pi++) {
  print "  Pattern $pi:\n";
  my $pattern_header_length = read_and_unpack(4, 'V');
  print "    WARNING: pattern header length should be 9\n" unless ($pattern_header_length == 9);
  my $packing_type = read_and_unpack(1, 'C');
  $packing_type == 0 or die "wrong packing type";
  my $number_of_rows = read_and_unpack(2, 'v');
  print "    WARNING: no rows" if ($number_of_rows == 0);
  print "    WARNING: too many rows" if ($number_of_rows > 256);
  print "    Number of rows: $number_of_rows\n";
  my $packed_patterndata_size = read_and_unpack(2, 'v');
  print "    Packed patterndata size: $packed_patterndata_size\n";
  my @packed_patterndata = read_and_unpack($packed_patterndata_size, "C[$packed_patterndata_size]");
  print "    Pattern data:\n";
  print "      " . ("Not In Vl ET EP |"x$number_of_channels) . "\n";
  my $pdi = 0;
  my $ci = 0;
  my $actual_number_of_rows = 0;
  while ($pdi < @packed_patterndata) {
    print "      " if ($ci == 0);
    if ($packed_patterndata[$pdi] & 0x80) {
      my $col = $packed_patterndata[$pdi++];
      if (($col & 1) > 0) {
	print note_number_to_name($packed_patterndata[$pdi++]) . ' ';
      } else {
	print '--- ';
      }
      for (my $x = 1; $x < 5; $x++) {
	if (($col & (1 << $x)) > 0) {
	  printf("%02x ", $packed_patterndata[$pdi++]);
	} else {
	  print '-- ';
	}
      }
    } else {
      print note_number_to_name($packed_patterndata[$pdi++]) . ' ';
      for (my $x = 1; $x < 5; $x++, $pdi++) {
	printf("%02x ", $packed_patterndata[$pdi]);
      }
    }
    print "|";
    $ci++;
    if ($ci == $number_of_channels) {
      $ci = 0;
      print "\n";
      $actual_number_of_rows++;
    }
  }
  print "    WARNING: wrong number of rows: $actual_number_of_rows\n"
    if ($actual_number_of_rows > 0 && # blank patterns are omitted
        $actual_number_of_rows != $number_of_rows);
  print "    WARNING: number of notes not divisible by number of channels\n"
    if ($ci != 0);
}

print "Instruments:\n";
for (my $ii = 0; $ii < $number_of_instruments; $ii++) {
  print "  Instrument " . ($ii+1) . ":\n"; # instruments are 1-based in pattern?
  my $instrument_header_size = read_and_unpack(4, 'V');
  print "    Instrument header size: $instrument_header_size\n";
  print "    WARNING: instrument header size too small: $instrument_header_size\n" if ($instrument_header_size < 29);
  my $instrument_name = read_and_unpack(22, 'Z[22]');
  print "    Instrument name: $instrument_name\n";
  my $instrument_type = read_and_unpack(1, 'C');
  print "    WARNING: nonzero instrument type\n" if ($instrument_type != 0);
  my $number_of_samples = read_and_unpack(2, 'v');
  print "    Number of samples: $number_of_samples\n";
  if ($instrument_header_size >= 243) {
    my $sample_header_size = read_and_unpack(4, 'V');
    print "    Sample header size: $sample_header_size\n";
    my @sample_number_for_all_notes = read_and_unpack(96, 'C[96]');
    print "    Sample number for all notes:\n";
    print "      " . join(' ', map { sprintf("%02x", $_) } @sample_number_for_all_notes) . "\n";
    my @points_for_volume_envelope = read_and_unpack(48, 'v[24]');
    my @points_for_panning_envelope = read_and_unpack(48, 'v[24]');
    my $number_of_volume_points = read_and_unpack(1, 'C');
    my $number_of_panning_points = read_and_unpack(1, 'C');
    my $volume_sustain_point = read_and_unpack(1, 'C');
    my $volume_loop_start_point = read_and_unpack(1, 'C');
    my $volume_loop_end_point = read_and_unpack(1, 'C');
    my $panning_sustain_point = read_and_unpack(1, 'C');
    my $panning_loop_start_point = read_and_unpack(1, 'C');
    my $panning_loop_end_point = read_and_unpack(1, 'C');
    my $volume_type = read_and_unpack(1, 'C');
    my $panning_type = read_and_unpack(1, 'C');
    print "    Volume:\n";
    print_volume_panning(
      \@points_for_volume_envelope,
      $number_of_volume_points,
      $volume_sustain_point,
      $volume_loop_start_point,
      $volume_loop_end_point,
      $volume_type
    );
    print "    Panning:\n";
    print_volume_panning(
      \@points_for_panning_envelope,
      $number_of_panning_points,
      $panning_sustain_point,
      $panning_loop_start_point,
      $panning_loop_end_point,
      $panning_type
    );
    print "    Vibrato:\n";
    my $vibrato_type = read_and_unpack(1, 'C');
    my $vibrato_sweep = read_and_unpack(1, 'C');
    my $vibrato_depth = read_and_unpack(1, 'C');
    my $vibrato_rate = read_and_unpack(1, 'C');
    if ($vibrato_type or $vibrato_sweep or $vibrato_depth or $vibrato_rate) {
      # authors of docs aren't sure how this works (!)
      my @vts = ('sine', 'square', 'saw down', 'saw up');
      print "      Type: $vts[$vibrato_type]\n";
      print "      Sweep: $vibrato_sweep\n";
      print "      Depth: $vibrato_depth\n";
      print "      Rate: $vibrato_rate\n";
    }
    my $volume_fadeout = read_and_unpack(2, 'v');
    print "    Volume fadeout: $volume_fadeout\n";
    my $reserved = read_and_unpack(2, 'v');
    if ($instrument_header_size > 243) {
      read_and_unpack($instrument_header_size - 243, 'C');
    }
  } elsif ($instrument_header_size > 29) {
    read_and_unpack($instrument_header_size - 29, 'C');
  }
  my @sample_lengths = ();
  my @sample_bytes_per_sample = ();
  print "    Samples:\n";
  for (my $si = 0; $si < $number_of_samples; $si++) {
    print "      Sample $si:\n";
    my $sample_length = read_and_unpack(4, 'V');
    print "        Sample length: $sample_length\n";
    push @sample_lengths, $sample_length;
    my $sample_loop_start = read_and_unpack(4, 'V');
    my $sample_loop_length = read_and_unpack(4, 'V');
    my $volume = read_and_unpack(1, 'C');
    print "        Volume: $volume\n";
    my $finetune = read_and_unpack(1, 'c'); # signed
    print "        Finetune: $finetune\n";
    my $type = read_and_unpack(1, 'C');
    #printf("        Type: %08b\n", $type);
    my @lts = ('none', 'forward', 'ping-pong');
    my $loop_type = ($type & 3);
    if ($loop_type) {
      print "        Loop: $lts[$loop_type]\n";
      print "          Start: $sample_loop_start\n";
      print "          Length: $sample_loop_length\n";
    }
    print "        Bits per sample: " . (($type & (1<<4)) ? 16 : 8) . "\n";
    push @sample_bytes_per_sample, (($type & (1<<4)) ? 2 : 1);
    my $panning = read_and_unpack(1, 'C');
    print "        Panning: $panning\n";
    my $relative_note_number = read_and_unpack(1, 'c'); # signed
    print "        Relative note number: $relative_note_number\n";
    my $reserved = read_and_unpack(1, 'C');
    my $sample_name = read_and_unpack(22, 'Z[22]');
    print "        Sample name: $sample_name\n";
  }
  print "    Sample waveforms:\n";
  for (my $si = 0; $si < $number_of_samples; $si++) {
    print "      Sample $si:\n";
    my @deltas =
      read_and_unpack(
        $sample_lengths[$si],
        (($sample_bytes_per_sample[$si] == 2) ? 'v!' : 'c') . '[' . ($sample_lengths[$si] / $sample_bytes_per_sample[$si]) . ']'
      );
    #print "read " . scalar(@deltas) . " deltas\n";
    my @values = ();
    my $old = 0;
    for (@deltas) {
      my $new = $old + $_;
      push @values, $new;
      $old = $new;
    }
    print((' 'x39) . "0\n");
    my ($c, $min, $max) = (0, 80, 0);
    for (@values) {
      my $scaled = 39 + $_ * 39 / 32768;
      $min = $scaled if ($scaled < $min);
      $max = $scaled if ($scaled > $max);
      if (++$c >= 20) {
	print((' 'x$min) . ('#'x($max-$min+1)) . "\n");
	($c, $min, $max) = (0, 80, 0);
      }
    }
  }
}
