# HPLC Analyzer Documentation
*v1.2.x · A tool for reading a specific TDMS file with HPLC data, finds peaks, fits them, and exports the results*

The analyzer takes a National Instruments TDMS file containing one or more chromatograms, lets you pick which traces to analyze, and produces a peak list with retention time, area, and a fit-quality score for each peak. Everything runs locally in your browser.

## 01 Workflow
A typical session looks like this:
1. Drag-and-drop a `.tdms` file onto the dropzone (or click to browse).
2. The tool auto-detects which TDMS groups are signal traces (time + UV-like channel) and selects the ones that look like real chromatograms by default.
3. An initial fit runs automatically. You see the chromatograms, the baseline, the fitted peaks, and the peak table.
4. Adjust smoothing, threshold, baseline, or peak shape — the fit re-runs with a 250 ms debounce.
5. Use the chart and the table to curate peaks: click a peak to remove it, or click the `×` button on its table row.
6. Export results as CSV (raw + fitted curves + peak summary) or PDF (cover + per-group page with chart and peak table).

## 02 Interface

### Header
- **↓ TDMS CSV** — exports raw TDMS channels (legacy, for non-HPLC use).
- **⌥ Inspect raw** — switches to the original TDMS tree+tabs viewer for power users (properties, raw values, channel info).
- **↓ CSV** — exports selected chromatograms with raw signal, baseline, corrected signal, smoothed signal, fit sum, and a peak summary block.
- **↓ PDF report** — multi-page report: cover with overview, then one page per analyzed group with chart and peak table.
- **?** — opens this page.
- **🌙 / ☀️** — toggles light/dark mode.

### Left panel — Chromatograms
Lists the signal groups detected in your TDMS file. The dropdown at the top filters by category: *Signals only* (default), *Pressure*, *Stabilization*, or *All*. The *All / None / Invert* buttons act on the currently visible category only. Click a row to toggle its selection. The gear icon (`⚙`) on each row lets you override which channel is the time axis and which is the signal — useful when auto-detection picks the wrong one.

The `×` button on each row **removes that chromatogram from the in-memory list**. The TDMS file on disk is never modified — if you want the signal back, re-open the file. Useful for hiding pressure or stabilization traces you don't need.

### Right panel — Chromatogram view
Shows the raw signal (faded), the estimated baseline (dashed), and each fitted peak (solid) with its retention time labeled at the top. The toolbar above the chart controls the analysis parameters; changes auto-trigger a re-fit.

## 03 Mouse & keyboard
The chart supports panning, axis-restricted zooming, and direct peak editing.

- `drag` - Pan the view in both axes.
- `wheel` - Zoom around the cursor. Honors the **XY / X / Y** mode toggle in the chart's top-left.
- `shift` + `wheel` - Force X-axis-only zoom (ignores the mode toggle).
- `ctrl` / `⌘` + `wheel` - Force Y-axis-only zoom.
- `shift` + `drag` - Box zoom. The selection respects the **XY / X / Y** mode: in X-only mode the selection becomes a vertical band that zooms only the X-axis (and similarly for Y-only).
- `double-click` - Reset the view to fit all selected data.

The three buttons next to the mode toggle are `+` step zoom in, `−` step zoom out, and `⤢` reset. All three honor the active X / Y / XY mode.

To remove a peak from the result, hover its row in the peak table and click the `×` button on the right. The chart and the Area % column update immediately. The fit itself isn't recomputed; you are curating the output.

## 04 Signal extraction
For each TDMS group, the analyzer needs one channel for the time axis and one for the signal. Auto-detection prefers channels named:

| Role | Recognized names (case-insensitive) |
| :--- | :--- |
| time | time, t, temps, sec, seconds, min, minutes |
| signal | DC, signal, UV, AU, mAU, absorb, absorbance, response, intensity, y |

Groups whose name suggests pressure (`P_…`, `Pressure`, `bar`) are categorized as *Pressure* rather than *Signal*. Names containing `stabilization` go into *Stabilization*. You can always switch the filter and analyze any of these — the categorization just controls what's pre-selected.

## 05 Baseline correction
HPLC baselines drift slowly over a run (column equilibration, mobile-phase composition changes, detector lamp warm-up). The analyzer applies a **smart rolling-ball baseline** automatically — there is no toggle. The algorithm:

1. Detect rough local maxima of the lightly smoothed signal and measure each one's full-width above its half-maximum.
2. Pick a ball radius equal to ≈ `2 ×` the widest peak's half-max width. This guarantees no real peak fits entirely under the ball — so peaks are never eroded — while the ball is still small enough to track slow baseline drift.
3. Apply morphological opening: a running minimum (erosion) over a window of radius `r`, followed by a running maximum (dilation) over the same window. The result is the lower envelope of the signal.
4. Smooth the envelope with a window of `r/4` samples to make the baseline curve continuous rather than piecewise-constant.

The fitter then operates on the corrected signal (`raw − baseline`). The estimated baseline is drawn as a dashed line on the chart so you can see exactly what was subtracted.

### Why no toggle anymore
An earlier version had a "Subtract baseline" checkbox. The toggle existed because the previous baseline algorithm (a Gaussian-smoother variant of ALS) failed on very wide peaks: a peak whose width exceeded the smoother's scale would be treated as drift and partially subtracted. Rolling ball with auto-radius doesn't have that failure mode — its scale adapts to the data. Benchmarks across seven scenarios (flat baseline, constant offset, linear drift, gradient hump, pre-corrected data, wide single peak, low SNR) show rolling ball matching or beating the old algorithm in every case. The toggle was redundant UI.

### Audit column in CSV and PDF
Even with a robust algorithm, baseline subtraction always changes the reported peak area — usually by a small amount. For full transparency, the CSV peak summary and the PDF peak table both include an `area_no_baseline` column showing what each peak's area would have been if no baseline were subtracted at all. Comparing the two columns lets you sanity-check borderline cases: if rolling-ball area and no-baseline area agree closely, the baseline subtraction is doing its job; if they differ a lot, look at the chart to verify the dashed baseline curve looks reasonable.

The audit fit is computed lazily — only when you export. It can take a few seconds on long traces with messy raw signal because peak detection on the un-corrected signal is intrinsically harder. You'll see a brief "Computing no-baseline audit fit" toast during export.

## 06 Smoothing
A boxcar (moving-average) smoother with a user-set window (default 5 points) is applied before peak detection. The window must be **odd** — a centered moving average needs the same number of points on each side of the center sample, which only works for odd window sizes. If you type an even value, the field snaps it up to the next odd when you leave the field. This reduces noise spikes that would otherwise be flagged as peaks. Smoothing is used *only* for detection and seed-parameter estimation — the actual fit runs on the unsmoothed (but baseline-corrected) signal.

## 07 Peak detection
A point is a peak candidate if all of these hold:

1. It's a local maximum: `y[i−1] < y[i] ≥ y[i+1]`.
2. Its height is at least **min height %** of the trace maximum (default 2 %).
3. It rises at least **5 σ** above the noise floor, where σ is estimated from the median absolute deviation of the corrected signal.
4. Its **prominence** (height above the highest valley separating it from a taller neighbor) is at least `4 σ` of the noise. This filters wiggles that sit on top of larger features.
5. Within ±**min separation** time units, it is the tallest local maximum (window-max rule).

The min-separation rule prevents a single noisy peak top from being flagged multiple times. The prominence rule prevents shoulders of one peak from being detected as separate peaks of their own.

### Adding peaks the auto-detector misses
Real chromatograms sometimes contain genuine peaks that the auto-detector skips — typically small peaks sitting close to the noise floor, or shoulders that fail the prominence rule. The **+ peak** button on the chart toolbar enters a manual-add mode: click anywhere on the chart, near a peak you can see, and the analyzer fits an EMG (or Gaussian) seeded at that location.

- The click position is snapped to the nearest local maximum within ±5 samples — you don't need to click exactly on the peak top.
- Manual peaks bypass the valley-boundary rule, so they can be placed close to existing peaks if needed.
- The fit-quality threshold is more permissive than for auto-detection (R² ≥ 0.3 instead of 0.5), since the user is asserting a peak is here.
- Manual peaks integrate into the same peak list as auto-detected ones — same Area %, same `×` delete button, same export columns. They're flagged internally as `manual` but treated identically in the report.
- Re-fitting (changing any parameter) discards manual peaks along with auto-detected ones — they're a curation step, not a permanent annotation. Add them last.

## 08 Peak fitting

### Window selection
Each detected peak gets its own *fit window*. The window expands outward from the peak's position until the smoothed signal drops below 1 % of the peak's height — but it never crosses the valley to a neighboring peak. Bounding by the inter-peak valleys is what stops one peak's tail from swallowing its neighbors and producing degenerate, over-wide fits.

### X-range restriction
The **↻ Re-Fit** button fits peaks *only within the current X range* visible on the chart. This lets you focus the analysis on a region of interest: pan or zoom the chart to frame the time window you care about, then click Re-Fit. Data outside the view boundaries is excluded from peak detection, baseline estimation, and curve fitting.

Zooming and panning are purely visual — they never trigger a fit on their own. The fit is always an explicit action (clicking Re-Fit, or changing a parameter which auto-refits). To fit the entire trace again, double-click the chart (or press the **⤢** reset button) to restore the full view, then Re-Fit.

### Models
Two peak shapes are available. **EMG** is the default and recommended for HPLC because real column peaks tail.

**EMG** (Exponentially Modified Gaussian)
`f(t) = (A / 2τ) · exp(σ² / 2τ² − (t − μ) / τ) · erfc(z)`
`z = (σ/τ − (t − μ)/σ) / √2`
*Where: A = peak area · μ = Gaussian centre · σ = Gaussian width · τ = exponential decay (column tailing)*

**Gaussian**
`f(t) = A · exp(−(t − μ)² / 2σ²)`

The implementation uses a numerically stable form of the EMG that switches between direct-erfc and erfcx-asymptotic branches depending on the magnitude of `z`, with explicit zero-clamping for the deep tails to avoid `0 × ∞` situations.

### Algorithm
Levenberg-Marquardt non-linear least squares with box constraints. Bounds:

| Parameter | Lower | Upper |
| :--- | :--- | :--- |
| A | 0 | +∞ |
| μ | t<sub>lo</sub> | t<sub>hi</sub> |
| σ | dt / 2 | window width |
| τ | 0 | window width |

Bounds on σ and τ enforce physically meaningful values. `τ > 0` means peaks can only tail (right-skewed), not lead — which is what real chromatographic peaks do.

## 09 Metrics

| Symbol | Meaning |
| :--- | :--- |
| tR | Retention time. The location of the maximum of the fitted curve. For an EMG it sits to the right of μ by approximately τ. |
| Height | Maximum value of the fitted curve. |
| Area | Integrated area under the fitted curve. For EMG, this equals the parameter A directly. For Gaussian: `A · σ · √(2π)`. |
| Area % | Peak's share of the total area for that group, in percent. The values within a group sum to 100. |
| FWHM | Full width at half maximum, computed numerically on the fitted curve. |
| σ | Gaussian width parameter from the fit. |
| τ | Exponential decay parameter (EMG only). Larger τ ⇒ stronger tailing. |
| Asym | USP asymmetry factor at 10 % peak height: `b/a`, where `a` is the leading half-width and `b` is the trailing half-width. |
| R² | Coefficient of determination of the fit. 1.000 = perfect fit. |

The on-screen table shows tR, Height, Area, Area %, and R². The CSV and PDF exports include the full set including σ, τ, FWHM, and Asym.

## 10 Rejection rules
A fitted peak is discarded — it doesn't appear in the table or chart — if any of these hold:

- R² < 0.5 (fit is incoherent with the data).
- σ < 1.2 · dt (the peak is narrower than two samples — almost certainly a noise spike).
- height ≤ 0 or non-finite (degenerate fit).

An additional safety net runs after fitting: if two fitted peaks happen to converge to retention times within *min separation* of each other, the one with the worse R² is dropped.

## 11 Interpretation guide

| Symptom | Likely cause |
| :--- | :--- |
| Asym > 1.5 | Significant peak tailing. Often column ageing, dead volume, secondary interactions, or overloading. |
| Asym < 0.9 | Peak fronting. Usually column overload or void formation at the inlet. |
| R² < 0.95 | The peak shape doesn't match the model. Most often: co-elution with a neighbor, distorted peak from an injection problem, or an EMG peak being fit with a Gaussian. |
| Many spurious peaks | Try increasing *min height %* or smoothing window. Real peaks should be clearly above the noise floor — the 5σ rule should suppress most noise but very noisy data may still trigger. |
| Real peaks missed | Lower the *min height %*, or check whether baseline correction is over-subtracting. Disable the baseline option to confirm. |
| Two peaks merged into one | Reduce *min separation*, or look at the chart — the inter-peak valley may be too shallow for the prominence filter to keep both. |

## 12 CSV & PDF exports

### CSV
One column block per selected group, plus a peak summary appended at the bottom. Each block contains:
- `group/time` — the time axis
- `group/<signal channel>` — the raw signal
- `group/baseline` — the estimated baseline
- `group/corrected` — raw minus baseline
- `group/smoothed` — the smoothed corrected signal
- `group/fit_sum` — the sum of all fitted curves at each sample

The peak summary table at the end has columns `group, peak_n, tR, height, area, area_no_baseline, fwhm, sigma, tau, asymmetry, r2`. The locale-appropriate separator is detected automatically (semicolon for European locales that use comma as decimal mark, comma elsewhere).

### PDF
Cover page with file metadata and an overview chart of all selected groups, then one page per analyzed group with that group's chart, the per-peak table (#, tR, Height, Area, Area (no BL), Area %, FWHM, sigma, tau, Asym, R2), and a summary (peak count, total area, mean R², mean asymmetry).

## 13 Privacy
The application is a single HTML file that runs entirely in your browser. No data leaves your machine — not the TDMS file, not the fit results, not the exported CSV or PDF. There is no telemetry, no analytics, no remote calls. You can open the file from your local filesystem and use it offline.

---
*NitaD, Univ Paris-Saclay · v1.2.x · 30 April 2026*
