# Taxi-LIB bundled visual asset notices

The following assets are dedicated to the public domain under **CC0 1.0 Universal**. They are bundled locally; the running game does not contact these sources.

## Citizens and locomotion

- **MakeHuman Community system assets** — citizen meshes, clothing, hair and textures. License: CC0 1.0. https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html
- **Quaternius, Universal Animation Library** — idle, walk and sprint clips embedded in the citizen files. License: CC0 1.0. https://quaternius.itch.io/universal-animation-library
- Taxi-LIB derivatives combine the fully clothed `civ_m1` / `civ_f1` geometry with the dark-skin textures from `civ_m2` / `civ_f2`. Runtime color, headwear, normalization and animation setup are additional modifications.

## Vehicles

Original unbranded models by **Innerscene**, released CC0 1.0:

- White four-door sedan: https://www.innerscene.com/tools/library/3d-parts/white-four-door-sedan-1f271353
- Silver five-door compact hatchback: https://www.innerscene.com/tools/library/3d-parts/silver-five-door-compact-hatchback-6bf4a878
- Passenger van with side windows: https://www.innerscene.com/tools/library/3d-parts/passenger-van-with-side-windows-474dd4a2
- Library license terms: https://www.innerscene.com/tools/library/terms

The optimized distributions retain separate wheel assemblies and vehicle materials. Taxi-LIB adds paint choices, taxi signs, plates, normalization, steering and wheel motion.

## Reviewed distribution mirror

The exact source GLBs and civilian animation embedding were reviewed from `mohammedemara48-code/police-command` at commit `db6a7ba31e4071db4aa7ec5d7ea0349d1343bd93`: https://github.com/mohammedemara48-code/police-command/tree/db6a7ba31e4071db4aa7ec5d7ea0349d1343bd93

Upstream authorship and CC0 status are recorded above rather than inferred from the mirror repository's own software license. Source and output SHA-256 hashes are in `asset-manifest.json`; `scripts/prepare-visual-assets.py` reproduces the derivatives.

CC0 legal text: https://creativecommons.org/publicdomain/zero/1.0/legalcode

All district geometry, modern Mesurado Aero/Farmington Cross vehicle geometry, UI icons, signs, weather effects and procedural audio remain original Taxi-LIB source. The world is fictionalized and compressed, not a verified map or an official Liberian product.
