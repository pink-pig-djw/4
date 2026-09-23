# FAU Campus 3D · Südgelände

First-person 3D walkthrough of the Friedrich-Alexander-Universität Erlangen-Nürnberg **Südgelände**
(technical & natural-sciences campus, Erlangen), built from real OpenStreetMap data.

*Work in progress — this branch is updated milestone by milestone.*

- Building footprints, heights, roads, trees, benches, bike parking, lamps, bus stops, entrances: OpenStreetMap
- Facades are stylised; interiors (Mensa, Hörsaalgebäude, RRZE, Felix-Klein-Gebäude/Mathematik) and all people are fictional
- Unofficial fan project, not affiliated with FAU

## Run (development)

```bash
npm install
npm run dev        # http://localhost:5173
```

## Rebuild the map data

```bash
npm run fetch      # download OSM data (Overpass API) → data/raw/
npm run world      # convert → data/world/suedgelaende.json
npm test           # walk-bot: walks every path, staircase and door, checks for falling / getting stuck
```

Map data © OpenStreetMap contributors, available under the Open Database License (ODbL).
