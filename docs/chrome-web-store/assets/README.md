# Store asset sources

`promo-small-source.svg` is an editable, code-native source and its PNG is mechanically rendered
from it. Screenshots must be recaptured from the production UI template for each store submission;
never retouch transaction or account content into a screenshot.

`icon-source.png` is the exception: the Bramble mark arrived as a 128×128 raster, so it is the master
and the four extension icons are downscaled from it with

```bash
for size in 16 32 48 128; do
  sips -s format png -z "$size" "$size" docs/chrome-web-store/assets/icon-source.png \
    --out "apps/extension/public/icons/icon-$size.png"
done
```

A vector source would be better — the mark loses its silhouette at 16px, which no resampling can fix
— so replacing `icon-source.png` with an SVG and re-rendering is worthwhile when one exists.

Expected upload dimensions:

- `icon-source.png` / `icon-128.png`: 128×128
- `promo-small-440x280.png`: 440×280
- `screenshot-*-1280x800.png`: 1280×800
