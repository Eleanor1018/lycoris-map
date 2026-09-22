# Map source thumbnails

These 160×160 WebP previews were cropped from real map screenshots captured
with Computer Use in Chrome on 2026-09-17. They illustrate the providers' map
appearance; they are not tiles or a substitute for their map APIs.

- `osm.webp`: OpenStreetMap streets near People's Square, Shanghai, shown by
  the local Lycoris map. © OpenStreetMap contributors, ODbL.
  Source: <https://www.openstreetmap.org/copyright>.
- `tianditu.webp`: public Shanghai city map from <https://map.tianditu.gov.cn/>,
  after searching for 上海人民广场. The source credits 自然资源部 & NavInfo,
  GS（2025）1508号.

The picker displays linked provider attribution underneath the thumbnails.
`tencent.png` is an unmodified 160×160 image returned by Tencent's official
Static Map API v2 on 2026-09-20, centered at GCJ-02 31.228457,121.478224,
zoom 14. © Tencent. The source is https://lbs.qq.com/service/staticV2/staticGuide/staticOverview.
The browser key is supplied only during generation and is not stored in this asset.
Full browser screenshots remain outside the repository; only public map crops
are bundled. No account details, browser chrome or real user location appear
in the thumbnails. OSM is the default base map. Tianditu becomes selectable
when `VITE_TIANDITU_API_KEY` is configured and uses its vector and Chinese
annotation WMTS layers. Google Maps is not offered in the source picker.
