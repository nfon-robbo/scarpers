Race estimate: fix weights, race-pace conversion, and walking filter

All changes in src/components/RaceTimeEstimate.tsx.

1. Weights → 60 / 30 / 10 when extraction succeeded

* When extractedRuns.length >= 1 AND tVo2 != null:

   * VO2 max: 60%

   * Extracted tempo (median extracted pace → race pace): 30%

   * Easy pace (median of any remaining usedClean runs, or extracted as fallback): 10%

* Otherwise keep existing logic (70/30 VO2 + clean, or 100% of whichever is available).

2. Race-pace conversion for extracted segments

Currently tClean = (median − 15 s/km) × km, which barely shifts pace.

* For the extracted-tempo component: subtract 65 s/km from the median extracted pace before multiplying by km, with a floor (e.g. never faster than vo2Pace − 20) to stop the estimate going faster than VO2 fitness allows.

* For the easy-pace 10% slice: subtract 60 s/km from the median easy pace (same floor).

* For the legacy clean-run path (no extraction), keep the existing −15 s/km adjustment unchanged.

Rationale for -65 s/km: The extracted segments are genuine Z2 easy pace runs (HR 132-154 bpm filtered by extraction). For beginners with VO2 max 35-42, the difference between easy pace and race pace is typically 60-70 s/km. Using -65 s/km keeps the extracted tempo prediction aligned with VO2 max predictions (won't predict faster than fitness allows). The floor cap provides additional safety.

3. Filter walking / treadmill out of extraction candidates

In the candidate-build loop (around line 172–185):

* Skip any linked activity where act.activity_type === 'walking' or 'walk'.

* Skip when title contains walk only (e.g. recovery walks) and no GPS — keep walk/run interval runs.

4. Clearer debug reason for GPS-less activities

In extractRunFromGps (line 102), change:

* "no gps_track data" → "no GPS recorded (indoor / treadmill / manual entry)"

Expected output for your current data

* VO2 max 38: 33:34 @ 6:43/km (60%)

* Extracted tempo: 12min @ 7:29/km → 6:24/km race pace → 32:00 (30%)

* Easy pace: from extracted → 6:44/km → 33:40 (10%)

* Weighted: 33:34 × 60% + 32:00 × 30% + 33:40 × 10% ≈ 32:54

* Final estimate: 32:30-33:30

* 2 contaminated continuous runs excluded

* Walking activities no longer appear in the debug failure list

This aligns extracted tempo prediction with VO2 max prediction instead of predicting faster than VO2 max allows.