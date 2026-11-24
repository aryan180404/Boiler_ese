# Boiler outlet steam temperature forecast

Live page: https://boiler-ese.webflow.io/

A static web page that shows forecasts of a coal-fired boiler's outlet steam temperature 1, 5 and 10 minutes ahead. It uses unseen test moments from a published dataset. B.Tech end-semester project by Aryan Agarwal (612309003).

Start the animated boiler, then step through random test moments. Switch between the 1, 5 and 10 minute forecasts to see:
- the forecast and the actual value
- a 90% prediction interval
- the selected model and how it compares with linear regression and with assuming no change
- every reading the forecast used.

## Results (test period, scored once)

| Horizon | Selected model | Mean absolute error | Linear regression | Persistence | Skill |
|---|---|---|---|---|---|
| 1 minute | Linear regression + tuned Random Forest correction | 0.085 °C | 0.091 °C | 0.534 °C | 0.84 |
| 5 minutes | 0.90 × linear regression + 0.10 × tuned LightGBM | 0.781 °C | 0.790 °C | 2.323 °C | 0.66 |
| 10 minutes | 0.90 × linear regression + 0.10 × tuned LightGBM | 2.171 °C | 2.189 °C | 3.442 °C | 0.37 |

**Skill** is 1 minus the model's MAE divided by the MAE of persistence (assuming the temperature stays as it is now).

**How the models were tested:**
- **Split:** the five days of readings (one every 5 seconds) are split in time order into training (70%), validation (10%) and test (20%), with gaps so no label crosses into the next part.
- **Validation:** sensors, inputs, settings, hybrid weights and the selected model are all chosen on validation.
- **Test:** the test day is scored once.
- **Is the gain real?** A one-hour block bootstrap shows the gain over linear regression is real at 1 and 5 minutes, and within noise at 10 minutes.

## Files

| File | What it is |
|---|---|
| `index.html` | Page structure and the boiler drawing |
| `styles.css` | Styles |
| `app.js` | Animation, chart, tables and the horizon switch |
| `data.js` | The data: 400 test moments with their readings and forecasts, and each horizon's scores. Written by the notebook `Boiler_steam_temperature_hybrid.ipynb` (section 16) |
| `CHANGES.md` | What changed in each version |

To run it locally, serve the folder with any static server, for example `python -m http.server`, and open http://localhost:8000.

## Data source

Hu, W., Jiang, A., Chen, K., Zheng, J., Shang, W. and Cao, Z. A long-tailed distribution time-series dataset in boiler equipment. *Scientific Data* 12, 742 (2025). https://doi.org/10.1038/s41597-025-05096-4
