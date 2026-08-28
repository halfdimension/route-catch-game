# Screenshot Guide

## Status of Existing Captures

The repository currently contains:

```text
gameplay.png
stats-drawer.png
leaderboard.png
```

All three are 2000×1125 Leaflet SOLO captures from an older UI checkpoint.
They remain useful historical/product illustrations, but they predate the
current PR #18 Mobility & Travel Foundation.

Specifically, they do **not** demonstrate or verify:

- the current `CAR` / `MOTORCYCLE` / `WALKING` selector;
- Valhalla-backed motorcycle or walking routes;
- immutable `activeTravelMode` or reconciliation-time next-round selection;
- SOLO recovery checkpoint schema v2;
- MapLibre `OVERVIEW` / `FOLLOW` / `FREE` behavior;
- current multiplayer authoritative movement/shared gameplay; or
- durable completed multiplayer results and personal match history.

Observed content:

- `gameplay.png` shows an active older Leaflet SOLO chase, targets, route, HUD,
  high simulation speed, and backend session totals. The setup panel has no
  TravelMode control.
- `stats-drawer.png` shows older SOLO session history and persisted catches.
- `leaderboard.png` shows the older SOLO completed-session leaderboard.

Do not caption these files as proof of current Valhalla, MapLibre, recovery-v2,
or multiplayer behavior.

## Recommended Future Capture Set

Keep the existing filenames for historical continuity unless the README is
updated at the same time. For a refreshed evidence set, capture populated
states such as:

```text
solo-car-leaflet.png
solo-motorcycle-leaflet.png
solo-walking-leaflet.png
solo-recovery-v2.png
solo-maplibre-follow.png
multiplayer-running.png
multiplayer-results.png
multiplayer-history.png
```

Useful evidence per image:

- All three Leaflet mode captures: selected mode visible, active route, target,
  and provider-compatible movement state.
- Recovery capture: the same round/mode after refresh with timer and movement
  continuity visible.
- MapLibre capture: clearly label it opt-in SOLO and show the current camera
  mode; do not imply multiplayer support.
- Multiplayer running capture: two authenticated participants, shared creature,
  and authoritative movement/score state.
- Result/history captures: completed ranking, personal catch details, and the
  persisted current-user history entry.

Screenshots cannot by themselves prove provider selection or durability. Pair
them with API/log/database evidence when those claims matter.

## Capture Quality

- Use a consistent desktop viewport and populated state.
- Avoid unrelated desktop content, tokens, passwords, emails, or private data.
- Use clearly fictional/demo identities.
- Record the renderer and travel mode in the caption.
- State when a capture is historical rather than current verification.
- Update the root README captions and links whenever filenames change.
